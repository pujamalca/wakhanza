import { getSetting, getSettingBool, getSettingNumber, setSetting, logAudit } from '@/models';
import { rekapResepHarian } from '@/khanza/farmasiStaf';
import {
  gabungRekapResep,
  formatRincianCaraBayarResep,
  formatRincianDokter,
  JAM_REKAP_RESEP_BAWAAN,
  type RingkasRekapResep,
} from '@/core/resepRekap';
import { bacaJamRekap, hariRekap } from '@/core/rekapJadwal';
import { formatJumlah, formatRupiah, formatTanggalDokumen } from '@/core/notaBarang';
import { jatuhTempoHarian, tanggalLokal } from '@/core/bpjs';
import { buildIdempotencyKey } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { muatTargetAktif } from './farmasiRunner';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * REKAP HARIAN RESEP -- satu pesan sehari berisi jumlah resep yang ditulis
 * dokter hari itu, pada jam yang disetel staf.
 *
 * ==========================================================================
 * Kelas pemicunya WAKTU, dan itu membuatnya berbeda dari tetangganya
 * ==========================================================================
 *
 * `farmasiRunner.ts` (FARMASI_VALIDASI dan FARMASI_PENYERAHAN) adalah kelas
 * SISIP: watermark maju, dan yang memicu pesan adalah BARIS yang melewati
 * kursornya. Yang ini tidak punya baris pemicu sama sekali -- yang memicunya
 * adalah jam dinding melewati waktu yang disetel staf, lalu keadaan hari itu
 * dibaca apa adanya. Kelasnya sama dengan REKAP PENJUALAN, DARURAT STOK, dan
 * pengingat kontrol.
 *
 * Akibat langsungnya: tidak ada watermark dan tidak ada yang bisa "tertinggal".
 * Rekap yang terlewat sehari memang hilang -- dan itu benar, karena rekap kemarin
 * yang dikirim hari ini cuma membingungkan.
 *
 * ==========================================================================
 * Sakelarnya BERDIRI SENDIRI dari `farmasi.enabled`
 * ==========================================================================
 *
 * Ini bagian yang paling gampang "dirapikan" ke arah yang salah, dan di sini
 * taruhannya lebih tinggi daripada di rekap penjualan. `farmasi.enabled`
 * menyalakan pesan yang memuat NAMA PASIEN, NOMOR REKAM MEDIS, dan POLI ke sebuah
 * grup WhatsApp -- keputusan privasi paling berat di halaman Farmasi.
 * Menjadikan rekap ini bertingkat di bawahnya akan memaksa RS mengambil keputusan
 * privasi itu hanya untuk mendapatkan satu pesan berisi ANGKA. Lihat
 * migrations/042.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak ada pasien yang disebut
 * ==========================================================================
 *
 *   tujuan         `is_active` yang SAMA dengan notifikasi resep per kejadian --
 *                  keduanya kabar tentang resep ke apotek yang sama. Tidak ada
 *                  kolom baru di `farmasi_target`, sama seperti rekap penjualan
 *                  yang memakai ulang `terima_penjualan`.
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *   jam tenang     DILEWATI, karena jamnya dipilih staf sendiri lewat
 *                  `farmasi.resep_rekap_jam`. Menundukkannya pada jam tenang
 *                  berarti diam-diam mengabaikan setelan yang baru saja mereka
 *                  buat -- dan dengan jam bawaan 22:00 melawan jam tenang bawaan
 *                  yang mulai 21:00, rekapnya akan SELALU tertahan sampai pukul
 *                  07:00 keesokan hari. Alasan yang sama persis dengan
 *                  FARMASI_STOK_DARURAT dan FARMASI_PENJUALAN_REKAP.
 *   poli sensitif  tidak relevan; isinya agregat, dan `reg_periksa` tidak pernah
 *                  disentuh sehingga tidak ada poli yang bisa dibaca.
 *
 * Isinya angka plus nama DOKTER -- staf, bukan pasien. Tidak satu pun baris
 * resep, nama obat, atau identitas pasien pernah meninggalkan SQL; lihat pagar
 * di kepala `khanza/farmasiStaf.ts`.
 */

export const TRIGGER_RESEP_REKAP = 'FARMASI_RESEP_REKAP';
const AKTOR = 'system:resep_rekap';
const KUNCI_PENANDA = 'farmasi.resep_rekap_last_run';

/**
 * Satu ringkasan jadi satu set variabel.
 *
 * Diekspor supaya PRATINJAU di `/farmasi?tab=resep` dan `npm run dryrun:resep`
 * memakai fungsi yang SAMA dipakai worker saat benar-benar mengirim -- pelajaran
 * yang sudah dibayar di kotak uji balasan otomatis, balasan stok, dan darurat
 * stok.
 *
 * `{jumlah_belum_serah}` datang dari `ringkas.jmlBelumSerah`, yang DITURUNKAN
 * `jmlResep - jmlSerah` di `gabungRekapResep()` -- bukan dari query tersendiri.
 * Itu yang menjamin ketiganya berjumlah secara aritmetika, sehingga pembaca bisa
 * menjumlahkannya sendiri di layar tanpa membuka Khanza.
 *
 * `{nilai_obat}` mengikuti aturan yang sama: ia dijumlahkan dari baris per dokter,
 * jadi angka di kepala pesan selalu cocok dengan kolom rupiah di `{rincian_dokter}`
 * di bawahnya.
 */
export function susunVarsRekapResep(
  ringkas: RingkasRekapResep,
  tanggalRekap: string,
  sekarang: Date,
): Partial<Record<TemplateVariable, string>> {
  return {
    tanggal_rekap: formatTanggalDokumen(tanggalRekap),
    jumlah_resep: formatJumlah(ringkas.jmlResep),
    jumlah_item: formatJumlah(ringkas.jmlBaris),
    jumlah_obat: formatJumlah(ringkas.jmlObat),
    jumlah_racikan: formatJumlah(ringkas.jmlRacikan),
    jumlah_diserahkan: formatJumlah(ringkas.jmlSerah),
    jumlah_belum_serah: formatJumlah(ringkas.jmlBelumSerah),
    nilai_obat: formatRupiah(ringkas.nilaiObat),
    rincian_dokter: formatRincianDokter(ringkas.perDokter),
    /**
     * Pecahan per cara bayar (migrations/049) -- BPJS berupa PIUTANG, umum
     * berupa KAS. Tanpa ini `{nilai_obat}` di atasnya adalah satu angka yang
     * mencampur uang yang sudah masuk dengan uang yang belum.
     */
    rincian_cara_bayar: formatRincianCaraBayarResep(ringkas.perCaraBayar),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };
}

export interface HasilRekapResep {
  ringkas: RingkasRekapResep;
  tanggalRekap: string;
  /** Teks yang benar-benar dirender, atau null bila memilih diam. */
  body: string | null;
  vars: Partial<Record<TemplateVariable, string>>;
}

/**
 * Membaca `sik` lalu menyusun isi pesannya -- tanpa mengirim apa pun.
 *
 * Dipisahkan dari pengirimannya dan diekspor supaya pratinjau dashboard dan
 * `npm run dryrun:resep` memakai jalur yang sama dengan worker.
 */
export async function susunRekapResepHarian(
  tanggalRekap: string,
  sekarang: Date,
): Promise<HasilRekapResep> {
  const { header, item, racikan, nilai, caraBayar } = await rekapResepHarian(tanggalRekap);
  const ringkas = gabungRekapResep(header, item, racikan, nilai, caraBayar);

  const [bodyAda, bodyKosong] = await Promise.all([
    getSetting('farmasi.template_resep_rekap', ''),
    getSetting('farmasi.template_resep_rekap_kosong', ''),
  ]);

  /**
   * Template kosong = DIAM, bukan mengirim pesan hampa.
   *
   * Berlaku HANYA pada cabang "hari itu tidak ada resep"; hari yang ada resepnya
   * dengan template utama kosong tetap menghasilkan pesan kosong, dan itu benar
   * -- staf yang mengosongkan template utama sedang mematikan fiturnya lewat cara
   * yang salah, dan pesan hampa yang terlihat di `/antrean` jauh lebih mudah
   * ditelusuri daripada kanal yang diam tanpa sebab.
   */
  const body = ringkas.kosong
    ? (bodyKosong ?? '').trim()
      ? (bodyKosong ?? '')
      : null
    : (bodyAda ?? '');

  return { ringkas, tanggalRekap, body, vars: susunVarsRekapResep(ringkas, tanggalRekap, sekarang) };
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelar dan JAM KIRIM dibaca ULANG tiap kali, bukan sekali saat worker mulai.
 * Bedanya menentukan: staf yang mengubah jamnya di dashboard harus berlaku hari
 * itu juga, bukan menunggu worker dimulai ulang oleh orang yang tidak tahu ia
 * perlu melakukannya. Itu perbaikan yang disengaja atas pola `startScheduler()`
 * milik BOOK_REMIND, dan pola yang sama sudah dipakai `runBpjsKontrolIfDue()`
 * serta `runPenjualanRekapIfDue()`.
 */
export async function runResepRekapIfDue(): Promise<void> {
  if (!(await getSettingBool('farmasi.resep_rekap_enabled', false))) return;

  const [jamRaw, offset, penanda] = await Promise.all([
    getSetting('farmasi.resep_rekap_jam', '22:00'),
    getSettingNumber('farmasi.resep_rekap_offset_hari', 0),
    getSetting(KUNCI_PENANDA, ''),
  ]);

  /**
   * Jam yang tidak terbaca jatuh ke bawaan, TIDAK mendiamkan rekapnya.
   *
   * Server action menolak jam yang salah bentuk di depan orang yang bisa
   * memperbaikinya; di sini, pukul sepuluh malam tanpa siapa-siapa untuk diberi
   * tahu, menolak diam berarti rekapnya berhenti selamanya tanpa satu pun tanda
   * -- kegagalan senyap yang sama jenisnya dengan sakelar menyala tanpa tujuan.
   */
  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    logger.warn(
      { jam: jamRaw, dipakai: `${JAM_REKAP_RESEP_BAWAAN.jam}:00` },
      'farmasi.resep_rekap_jam tidak terbaca sebagai HH:MM, memakai jam bawaan',
    );
  }
  const jamKirim = jam ?? JAM_REKAP_RESEP_BAWAAN;

  const sekarang = new Date();
  if (!jatuhTempoHarian(sekarang, jamKirim.jam, penanda ?? '', jamKirim.menit)) return;

  /**
   * Tujuan diperiksa SEBELUM `sik` disentuh, dan penandanya sengaja TIDAK
   * dimajukan di cabang ini.
   *
   * Berbeda dari cabang "hari ini memang tidak ada resep" di bawah: yang ini
   * keadaan salah setel yang bisa diperbaiki dalam hitungan detik lewat satu
   * centang, dan memajukan penandanya berarti rekap hari itu hilang begitu saja.
   * Biayanya satu query ringan tiap siklus sampai ada yang membetulkannya --
   * `sik` belum disentuh sama sekali karena pemeriksaan ini di depan.
   */
  const tujuan = await muatTargetAktif();
  if (tujuan.length === 0) {
    logger.warn({}, 'rekap resep jatuh tempo tapi belum ada tujuan farmasi yang aktif');
    return;
  }

  const tanggalRekap = hariRekap(sekarang, offset);

  let hasil: HasilRekapResep;
  try {
    hasil = await susunRekapResepHarian(tanggalRekap, sekarang);
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
    logger.error({ tanggalRekap, ...safeError(err) }, 'gagal membaca rekap resep harian');
    return;
  }

  if (hasil.body === null) {
    logger.info(
      { tanggalRekap },
      'rekap resep: tidak ada resep hari itu dan pesan kosong tidak diisi, lewati',
    );
  } else {
    const ctx = await loadFarmasiContext(TRIGGER_RESEP_REKAP, hasil.body, hasil.body);
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
           * paling banyak satu baris per DOKTER, dan `resep_obat.kd_dokter` cuma
           * punya SATU nilai berbeda sepanjang 12.422 baris di instalasi ini.
           * Pesannya ratusan karakter, bukan belasan ribu. Apotek yang punya
           * puluhan dokter tetap jauh di bawah batas pesan WhatsApp yang terukur
           * 13.035 karakter (lihat migrations/022).
           */
          idempotencyKey: buildIdempotencyKey(TRIGGER_RESEP_REKAP, tanggalRekap, t.chatId),
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
        resep: hasil.ringkas.jmlResep,
        belumSerah: hasil.ringkas.jmlBelumSerah,
        nilaiObat: hasil.ringkas.nilaiObat,
        dokter: hasil.ringkas.perDokter.length,
        tujuan: tujuan.length,
      },
      'rekap resep terkirim',
    );
    await logAudit(
      AKTOR,
      'resep_rekap_kirim',
      tanggalRekap,
      `${hasil.ringkas.jmlResep} resep, ${hasil.ringkas.jmlBelumSerah} belum diserahkan, ` +
        `${formatRupiah(hasil.ringkas.nilaiObat)}, ${tujuan.length} tujuan`,
    );
  }

  /**
   * Penanda dimajukan SESUDAH pekerjaannya berhasil -- termasuk saat "berhasil"
   * berarti sengaja diam.
   *
   * Diam karena hari itu memang tidak ada resep adalah keputusan yang SUDAH
   * diambil dengan benar, dan itu bukan keadaan langka di sini: terukur, hari
   * Minggu nol resep pada seluruh 90 hari terakhir. Mengulanginya tiap lima menit
   * sampai tengah malam cuma membaca `sik` sia-sia. Bandingkan cabang "belum ada
   * tujuan" di atas, yang sengaja TIDAK memajukannya karena ia keadaan salah
   * setel, bukan keputusan.
   */
  await setSetting(KUNCI_PENANDA, tanggalLokal(sekarang));
}
