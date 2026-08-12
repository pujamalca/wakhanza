import { getSetting, getSettingBool, getSettingNumber, setSetting, logAudit } from '@/models';
import { rekapPenjualanHarian } from '@/khanza/penjualan';
import {
  gabungRekap,
  formatRincianJenis,
  bacaJamRekap,
  hariRekap,
  JAM_REKAP_BAWAAN,
  type RingkasRekap,
} from '@/core/penjualanRekap';
import { formatRupiah, formatJumlah, formatTanggalDokumen } from '@/core/notaBarang';
import { jatuhTempoHarian, tanggalLokal } from '@/core/bpjs';
import { buildIdempotencyKey } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { muatTujuanPenjualan } from './penjualanRunner';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * REKAP HARIAN PENJUALAN -- satu pesan sehari berisi totalnya, pada jam yang
 * disetel staf.
 *
 * ==========================================================================
 * Kelas pemicunya WAKTU, dan itu membuatnya berbeda dari tetangganya
 * ==========================================================================
 *
 * `penjualanRunner.ts` (dan pengadaan/pemesanan/hibah) adalah kelas PINDAI:
 * jendela dibaca ulang tiap siklus, dan yang memicu pesan adalah BARIS BARU yang
 * muncul di `sik`. Yang ini tidak punya baris pemicu sama sekali -- yang
 * memicunya adalah jam dinding melewati waktu yang disetel staf, lalu keadaan
 * hari itu dibaca apa adanya. Kelasnya sama dengan DARURAT STOK dan pengingat
 * kontrol.
 *
 * Akibat langsungnya: tidak ada watermark, tidak ada buku pantau, dan tidak ada
 * yang bisa "tertinggal". Rekap yang terlewat sehari memang hilang -- dan itu
 * benar, karena rekap kemarin yang dikirim hari ini cuma membingungkan.
 *
 * ==========================================================================
 * Sakelarnya BERDIRI SENDIRI dari `farmasi.penjualan_enabled`
 * ==========================================================================
 *
 * Ini bagian yang paling gampang "dirapikan" ke arah yang salah. Rekap adalah
 * ALTERNATIF dari kabar per nota, bukan tambahannya: RS yang cuma ingin satu
 * pesan sehari harus bisa mendapatkannya TANPA lebih dulu menyalakan 16-46 pesan
 * sehari yang justru ingin dihindarinya. Menjadikannya bertingkat memaksa persis
 * kebalikan dari yang diminta. Lihat migrations/041.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak ada pembeli yang disebut
 * ==========================================================================
 *
 *   tujuan         `terima_penjualan` yang SAMA dengan nota per-nota -- diminta
 *                  begitu, dan benar begitu: keduanya kabar tentang penjualan ke
 *                  gudang/apotek yang sama. Tidak ada kolom baru di
 *                  `farmasi_target`.
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *   jam tenang     DILEWATI, dan di sini itu SYARAT bukan kenyamanan: jam
 *                  bawaannya 21:00 dan jam tenang bawaan mulai pukul 21:00, jadi
 *                  tanpa pengecualian ini rekapnya akan ditahan sampai pukul
 *                  07:00 keesokan hari -- diam-diam mengabaikan setelan yang baru
 *                  saja dibuat staf. Alasan yang sama persis dengan
 *                  FARMASI_STOK_DARURAT, yang jamnya juga dipilih staf.
 *   poli sensitif  tidak relevan; tidak ada poli pada sebuah penjualan.
 *
 * Isinya agregat -- COUNT dan SUM per `jns_jual` -- jadi tidak satu pun baris
 * transaksi, apalagi identitas pembeli, pernah meninggalkan SQL. Lihat komentar
 * pembuka `khanza/penjualan.ts`.
 */

export const TRIGGER_PENJUALAN_REKAP = 'FARMASI_PENJUALAN_REKAP';
const AKTOR = 'system:penjualan_rekap';
const KUNCI_PENANDA = 'farmasi.penjualan_rekap_last_run';

/**
 * Satu ringkasan jadi satu set variabel.
 *
 * Diekspor supaya PRATINJAU di `/farmasi` memakai fungsi yang SAMA dipakai worker
 * saat benar-benar mengirim -- pelajaran yang sudah dibayar di kotak uji balasan
 * otomatis, balasan stok, dan darurat stok.
 *
 * `{penyesuaian}` menggantikan nama `{ongkir}` yang dipakai nota per-nota, dan
 * itu disengaja: pada satu nota, angkanya menamai kolom Khanza yang mengisinya
 * sehingga bisa ditelusuri; pada rekap ia sudah JUMLAH dari ratusan nota dan
 * tidak lagi menunjuk satu kolom pun. Terukur, isinya campuran pembulatan,
 * potongan harga (sampai -Rp21.000), dan ongkos kirim -- lihat migrations/041.
 */
export function susunVarsRekap(
  ringkas: RingkasRekap,
  tanggalRekap: string,
  sekarang: Date,
): Partial<Record<TemplateVariable, string>> {
  return {
    tanggal_rekap: formatTanggalDokumen(tanggalRekap),
    jumlah_nota: formatJumlah(ringkas.jmlNota),
    jumlah_item: formatJumlah(ringkas.jmlBaris),
    jumlah_barang: formatJumlah(ringkas.jmlBarang),
    subtotal: formatRupiah(ringkas.subtotal),
    penyesuaian: formatRupiah(ringkas.penyesuaian),
    ppn: formatRupiah(ringkas.ppn),
    total: formatRupiah(ringkas.total),
    rincian_jenis: formatRincianJenis(ringkas.perJenis),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };
}

export interface HasilRekap {
  ringkas: RingkasRekap;
  tanggalRekap: string;
  /** Teks yang benar-benar dirender, atau null bila memilih diam. */
  body: string | null;
  vars: Partial<Record<TemplateVariable, string>>;
}

/**
 * Membaca `sik` lalu menyusun isi pesannya -- tanpa mengirim apa pun.
 *
 * Dipisahkan dari pengirimannya dan diekspor supaya pratinjau dashboard dan
 * `npm run dryrun:penjualan` memakai jalur yang sama dengan worker.
 */
export async function susunRekapHarian(tanggalRekap: string, sekarang: Date): Promise<HasilRekap> {
  const { header, item } = await rekapPenjualanHarian(tanggalRekap);
  const ringkas = gabungRekap(header, item);

  const [bodyAda, bodyKosong] = await Promise.all([
    getSetting('farmasi.template_penjualan_rekap', ''),
    getSetting('farmasi.template_penjualan_rekap_kosong', ''),
  ]);

  /**
   * Template kosong = DIAM, bukan mengirim pesan hampa.
   *
   * Berlaku HANYA pada cabang "hari itu tidak ada penjualan"; hari yang ada
   * penjualannya dengan template utama kosong tetap menghasilkan pesan kosong,
   * dan itu benar -- staf yang mengosongkan template utama sedang mematikan
   * fiturnya lewat cara yang salah, dan pesan hampa yang terlihat di `/antrean`
   * jauh lebih mudah ditelusuri daripada kanal yang diam tanpa sebab.
   */
  const body = ringkas.kosong
    ? (bodyKosong ?? '').trim()
      ? (bodyKosong ?? '')
      : null
    : (bodyAda ?? '');

  return { ringkas, tanggalRekap, body, vars: susunVarsRekap(ringkas, tanggalRekap, sekarang) };
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelar dan JAM KIRIM dibaca ULANG tiap kali, bukan sekali saat worker mulai.
 * Bedanya menentukan: staf yang mengubah jamnya di dashboard harus berlaku hari
 * itu juga, bukan menunggu worker dimulai ulang oleh orang yang tidak tahu ia
 * perlu melakukannya. Itu perbaikan yang disengaja atas pola `startScheduler()`
 * milik BOOK_REMIND, dan pola yang sama sudah dipakai `runBpjsKontrolIfDue()`.
 */
export async function runPenjualanRekapIfDue(): Promise<void> {
  if (!(await getSettingBool('farmasi.penjualan_rekap_enabled', false))) return;

  const [jamRaw, offset, penanda] = await Promise.all([
    getSetting('farmasi.penjualan_rekap_jam', '21:00'),
    getSettingNumber('farmasi.penjualan_rekap_offset_hari', 0),
    getSetting(KUNCI_PENANDA, ''),
  ]);

  /**
   * Jam yang tidak terbaca jatuh ke bawaan, TIDAK mendiamkan rekapnya.
   *
   * Server action menolak jam yang salah bentuk di depan orang yang bisa
   * memperbaikinya; di sini, tengah malam tanpa siapa-siapa untuk diberi tahu,
   * menolak diam berarti rekapnya berhenti selamanya tanpa satu pun tanda --
   * kegagalan senyap yang sama jenisnya dengan sakelar menyala tanpa tujuan.
   */
  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    logger.warn(
      { jam: jamRaw, dipakai: `${JAM_REKAP_BAWAAN.jam}:00` },
      'farmasi.penjualan_rekap_jam tidak terbaca sebagai HH:MM, memakai jam bawaan',
    );
  }
  const jamKirim = jam ?? JAM_REKAP_BAWAAN;

  const sekarang = new Date();
  if (!jatuhTempoHarian(sekarang, jamKirim.jam, penanda ?? '', jamKirim.menit)) return;

  /**
   * Tujuan diperiksa SEBELUM `sik` disentuh, dan penandanya sengaja TIDAK
   * dimajukan di cabang ini.
   *
   * Berbeda dari cabang "hari ini memang tidak ada penjualan" di bawah: yang ini
   * keadaan salah setel yang bisa diperbaiki dalam hitungan detik lewat satu
   * centang, dan memajukan penandanya berarti rekap hari itu hilang begitu saja.
   * Biayanya satu query ringan tiap siklus sampai ada yang membetulkannya --
   * `sik` belum disentuh sama sekali karena pemeriksaan ini di depan.
   */
  const tujuan = await muatTujuanPenjualan();
  if (tujuan.length === 0) {
    logger.warn({}, 'rekap penjualan jatuh tempo tapi belum ada tujuan yang mencentang "terima penjualan"');
    return;
  }

  const tanggalRekap = hariRekap(sekarang, offset);

  let hasil: HasilRekap;
  try {
    hasil = await susunRekapHarian(tanggalRekap, sekarang);
  } catch (err) {
    /**
     * Penanda TIDAK dimajukan, dan kegagalannya tidak ditelan diam-diam.
     *
     * Pelajaran `bpjs.kontrol_last_run`: menulis penanda lebih dulu terasa lebih
     * aman, tapi satu kegagalan sesaat -- MariaDB sedang terkunci SIMRS, jaringan
     * berkedip -- lalu menghapus rekap SEHARIAN tanpa percobaan kedua. Siklus
     * berikutnya mencobanya lagi; `uq_idem` yang menahan kiriman ganda, bukan
     * penanda ini.
     */
    logger.error({ tanggalRekap, ...safeError(err) }, 'gagal membaca rekap penjualan harian');
    return;
  }

  if (hasil.body === null) {
    logger.info(
      { tanggalRekap },
      'rekap penjualan: tidak ada penjualan hari itu dan pesan kosong tidak diisi, lewati',
    );
  } else {
    const ctx = await loadFarmasiContext(TRIGGER_PENJUALAN_REKAP, hasil.body, hasil.body);
    for (const t of tujuan) {
      await enqueueMessage(
        {
          /**
           * Kuncinya memuat TANGGAL YANG DIREKAP, bukan `sekarang`.
           *
           * `sekarang` berbeda tiap siklus, jadi kegagalan menulis penanda akan
           * membuat rekap terkirim ulang tiap lima menit sampai tengah malam dan
           * tiap kunci dianggap baru. Tanggal rekapnya tetap sama sepanjang hari,
           * sehingga `uq_idem` menahan kiriman kedua di mesin database.
           *
           * `chatId` WAJIB ikut, dengan alasan yang sudah dibayar di notifikasi
           * farmasi: tanpa itu tujuan KEDUA dan seterusnya ditolak sebagai
           * duplikat dan hanya satu grup yang pernah menerima apa pun -- tanpa
           * satu pun galat, karena INSERT-nya memang `ignoreDuplicates`.
           *
           * TANPA pemecahan bagian, dan itu diukur bukan diasumsikan: isinya
           * paling banyak satu baris per `jns_jual`, dan `jns_jual` cuma punya
           * ENAM nilai berbeda sepanjang 2,5 tahun (16.793 nota). Pesannya
           * ratusan karakter, bukan belasan ribu.
           */
          idempotencyKey: buildIdempotencyKey(TRIGGER_PENJUALAN_REKAP, tanggalRekap, t.chatId),
          noRkmMedis: null,
          rawPhone: null,
          chatId: t.chatId,
          eventAt: sekarang,
          vars: hasil.vars,
        },
        ctx,
      );
    }
    logger.info(
      {
        tanggalRekap,
        nota: hasil.ringkas.jmlNota,
        jenis: hasil.ringkas.perJenis.length,
        tujuan: tujuan.length,
      },
      'rekap penjualan terkirim',
    );
    await logAudit(
      AKTOR,
      'penjualan_rekap_kirim',
      tanggalRekap,
      `${hasil.ringkas.jmlNota} nota, ${hasil.ringkas.perJenis.length} jenis, ${tujuan.length} tujuan`,
    );
  }

  /**
   * Penanda dimajukan SESUDAH pekerjaannya berhasil -- termasuk saat "berhasil"
   * berarti sengaja diam.
   *
   * Diam karena hari itu memang tidak ada penjualan adalah keputusan yang SUDAH
   * diambil dengan benar; mengulanginya tiap lima menit sampai tengah malam cuma
   * membaca `sik` sia-sia. Bandingkan cabang "belum ada tujuan" di atas, yang
   * sengaja TIDAK memajukannya karena ia keadaan salah setel, bukan keputusan.
   */
  await setSetting(KUNCI_PENANDA, tanggalLokal(sekarang));
}
