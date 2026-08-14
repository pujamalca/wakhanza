import { FarmasiTarget, getSetting, getSettingBool, setSetting, logAudit } from '@/models';
import { rekapFarmasiBulanan } from '@/khanza/farmasiBulanan';
import {
  gabungBulanan,
  formatRincianBarang,
  formatRincianMutu,
  judulBulan,
  type RingkasBulanan,
} from '@/core/farmasiBulanan';
import {
  bacaTanggalKirim,
  bulanJatuhTempo,
  labelBulan,
  JAM_REKAP_BULANAN_BAWAAN,
  TANGGAL_KIRIM_BAWAAN,
} from '@/core/rekapBulan';
/**
 * Jamnya dibaca `bacaJamRekap()` yang SAMA dipakai ketiga rekap harian, bukan
 * penurunan tersendiri. "Pukul berapa" adalah pertanyaan yang benar-benar sama di
 * kedua tempat, dan dua penurunan untuknya adalah dua kesempatan berbeda tafsir
 * soal apakah `24:00` sah -- bentuk kegagalan yang sudah berkali-kali dibayar di
 * proyek ini.
 */
import { bacaJamRekap } from '@/core/rekapJadwal';
import { formatJumlah, formatRupiah } from '@/core/notaBarang';
import { buildIdempotencyKey } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import type { TargetAktif } from './farmasiRunner';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * REKAP BULANAN FARMASI -- satu pesan sebulan berisi seluruh kegiatan farmasi
 * bulan yang baru lewat, pada tanggal dan jam yang disetel staf.
 *
 * ==========================================================================
 * Kelas WAKTU, periodenya BULAN -- dan itu yang membedakannya dari tetangganya
 * ==========================================================================
 *
 * Ketiga rekap yang sudah ada berbunyi HARIAN dan penandanya menyimpan tanggal.
 * Yang ini menyimpan BULAN, dan matematikanya berdiri sendiri di
 * `core/rekapBulan.ts` -- alasan lengkapnya ada di kepala berkas itu.
 *
 * Satu perbedaan PERILAKU yang menempel, dan arahnya berlawanan dari rekap
 * harian: rekap bulanan yang terlewat DIKEJAR. Isinya bulan yang sudah tutup,
 * jadi angkanya sama persis apakah dikirim tanggal 3 atau tanggal 20 -- dan
 * membuangnya berarti sebulan penuh data hilang tanpa satu pun cara
 * mendapatkannya kembali.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak satu pun pasien disebut
 * ==========================================================================
 *
 *   tujuan         `terima_bulanan` -- kolom TERSENDIRI, bukan `is_active`.
 *                  Isinya bacaan MANAJEMEN (omzet, belanja, angka mutu), bukan
 *                  bacaan shift. Alasan lengkapnya di `models/FarmasiTarget.ts`.
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *   jam tenang     DILEWATI, karena jam DAN tanggalnya dipilih staf sendiri.
 *                  Menundukkannya pada jam tenang berarti diam-diam mengabaikan
 *                  setelan yang baru saja mereka buat. Alasan yang sama persis
 *                  dengan FARMASI_STOK_DARURAT, FARMASI_PENJUALAN_REKAP, dan
 *                  FARMASI_RESEP_REKAP.
 *   poli sensitif  tidak relevan; isinya agregat, dan satu-satunya sentuhan ke
 *                  `reg_periksa` adalah `COUNT(DISTINCT no_rkm_medis)` yang
 *                  tidak membaca poli sama sekali.
 *
 * Isinya SELURUHNYA angka. Tidak ada nama pasien, no. RM, nama obat, nama
 * pemasok, maupun nama petugas -- pagarnya ada di daftar SELECT
 * `khanza/farmasiBulanan.ts`, bukan di sini.
 */

export const TRIGGER_FARMASI_BULANAN = 'FARMASI_BULANAN';
const AKTOR = 'system:farmasi_bulanan';
const KUNCI_PENANDA = 'farmasi.bulanan_last_run';

/**
 * Tujuan yang mencentang "terima rekap bulanan".
 *
 * Sengaja TIDAK memakai `muatTargetAktif()` milik `farmasiRunner.ts`: fungsi itu
 * membaca `isActive`, yang menjawab pertanyaan berbeda ("ke mana notifikasi resep
 * per kejadian dikirim").
 *
 * `isActive` TETAP ikut disyaratkan, dan itu bukan pengetatan berlebih melainkan
 * arti kolomnya sendiri: tujuan yang dinonaktifkan tidak menerima apa pun, apa
 * pun centangnya -- kalimat yang sudah tertulis di halaman `/farmasi` dan yang
 * dipakai staf saat mematikan sebuah grup buru-buru.
 */
export async function muatTargetBulanan(): Promise<TargetAktif[]> {
  const rows = await FarmasiTarget.findAll({
    where: { isActive: true, terimaBulanan: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/**
 * Satu ringkasan jadi satu set variabel.
 *
 * Diekspor supaya PRATINJAU di `/farmasi?tab=bulanan` dan tombol ujinya memakai
 * fungsi yang SAMA dipakai worker saat benar-benar mengirim -- pelajaran yang
 * sudah dibayar di kotak uji balasan otomatis, balasan stok, dan darurat stok.
 *
 * `{jumlah_diserahkan}` dan `{jumlah_ditelaah}` datang dari `gabungBulanan()`
 * yang MENURUNKANNYA (`resep - belum`), bukan dari query tersendiri. Itu yang
 * menjamin keduanya berjumlah dengan `{jumlah_resep}` secara aritmetika,
 * sehingga pembaca bisa menjumlahkannya sendiri di layar tanpa membuka Khanza.
 */
export function susunVarsBulanan(
  r: RingkasBulanan,
  sekarang: Date,
): Partial<Record<TemplateVariable, string>> {
  return {
    bulan_rekap: judulBulan(r),
    jumlah_resep: formatJumlah(r.jmlResep),
    jumlah_pasien: formatJumlah(r.jmlPasien),
    jumlah_kunjungan: formatJumlah(r.jmlKunjungan),
    jumlah_item: formatJumlah(r.jmlBaris),
    jumlah_obat: formatJumlah(r.jmlObat),
    jumlah_racikan: formatJumlah(r.jmlRacikan),
    jumlah_diserahkan: formatJumlah(r.jmlDiserahkan),
    jumlah_belum_serah: formatJumlah(r.jmlBelumSerah),
    jumlah_belum_validasi: formatJumlah(r.jmlBelumValidasi),
    jumlah_ditelaah: formatJumlah(r.jmlAdaTelaah),
    jumlah_tanpa_telaah: formatJumlah(r.jmlTanpaTelaah),
    nilai_obat: formatRupiah(r.nilaiObat),
    jumlah_pengadaan: formatJumlah(r.pengadaan.jml),
    nilai_pengadaan: formatRupiah(r.pengadaan.nilai),
    jumlah_pemesanan: formatJumlah(r.pemesanan.jml),
    nilai_pemesanan: formatRupiah(r.pemesanan.nilai),
    jumlah_hibah: formatJumlah(r.hibah.jml),
    nilai_hibah: formatRupiah(r.hibah.nilai),
    jumlah_penjualan: formatJumlah(r.penjualan.jml),
    nilai_penjualan: formatRupiah(r.penjualan.nilai),
    rincian_barang: formatRincianBarang(r),
    rincian_mutu: formatRincianMutu(r),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };
}

export interface HasilRekapBulanan {
  ringkas: RingkasBulanan;
  bulan: string;
  /** Teks yang benar-benar dirender, atau null bila memilih diam. */
  body: string | null;
  vars: Partial<Record<TemplateVariable, string>>;
}

/**
 * Membaca `sik` lalu menyusun isi pesannya -- tanpa mengirim apa pun.
 *
 * Dipisahkan dari pengirimannya dan diekspor supaya pratinjau dashboard, tombol
 * uji, dan `npm run dryrun:bulanan` memakai jalur yang sama dengan worker.
 */
export async function susunRekapBulanan(
  ym: string,
  sekarang: Date,
): Promise<HasilRekapBulanan> {
  const agregat = await rekapFarmasiBulanan(ym);
  const ringkas = gabungBulanan(ym, agregat);

  const [bodyAda, bodyKosong] = await Promise.all([
    getSetting('farmasi.template_bulanan', ''),
    getSetting('farmasi.template_bulanan_kosong', ''),
  ]);

  /**
   * Template kosong = DIAM, dan HANYA pada cabang "bulan itu tidak ada kegiatan
   * apa pun".
   *
   * Bulan yang ada isinya dengan template utama kosong tetap menghasilkan pesan
   * kosong, dan itu benar: staf yang mengosongkan template utama sedang mematikan
   * fiturnya lewat cara yang salah, dan pesan hampa yang terlihat di `/antrean`
   * jauh lebih mudah ditelusuri daripada kanal yang diam tanpa sebab.
   */
  const body = ringkas.kosong
    ? (bodyKosong ?? '').trim()
      ? (bodyKosong ?? '')
      : null
    : (bodyAda ?? '');

  return { ringkas, bulan: ym, body, vars: susunVarsBulanan(ringkas, sekarang) };
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelar, TANGGAL, dan JAM dibaca ULANG tiap kali -- bukan sekali saat worker
 * mulai. Staf yang mengubah tanggal kirimnya di dashboard harus berlaku bulan itu
 * juga, bukan menunggu worker dimulai ulang oleh orang yang tidak tahu ia perlu
 * melakukannya. Perbaikan yang disengaja atas pola `startScheduler()` milik
 * BOOK_REMIND.
 */
export async function runFarmasiBulananIfDue(): Promise<void> {
  if (!(await getSettingBool('farmasi.bulanan_enabled', false))) return;

  const [tanggalRaw, jamRaw, penanda] = await Promise.all([
    getSetting('farmasi.bulanan_tanggal', String(TANGGAL_KIRIM_BAWAAN)),
    getSetting('farmasi.bulanan_jam', '08:00'),
    getSetting(KUNCI_PENANDA, ''),
  ]);

  /**
   * Setelan yang tidak terbaca jatuh ke bawaan, TIDAK mendiamkan rekapnya.
   *
   * Server action menolak bentuk yang salah di depan orang yang bisa
   * memperbaikinya seketika; di sini, pukul delapan pagi tanggal 3 tanpa
   * siapa-siapa untuk diberi tahu, menolak diam berarti rekapnya berhenti
   * selamanya tanpa satu pun tanda -- kegagalan senyap yang sama jenisnya dengan
   * sakelar menyala tanpa tujuan tercentang.
   */
  const tanggalKirim = bacaTanggalKirim(tanggalRaw);
  if (tanggalKirim === null) {
    logger.warn(
      { tanggal: tanggalRaw, dipakai: TANGGAL_KIRIM_BAWAAN },
      'farmasi.bulanan_tanggal tidak terbaca sebagai 1-28, memakai bawaan',
    );
  }
  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    logger.warn(
      { jam: jamRaw, dipakai: '08:00' },
      'farmasi.bulanan_jam tidak terbaca sebagai HH:MM, memakai jam bawaan',
    );
  }

  const sekarang = new Date();
  const bulan = bulanJatuhTempo(
    sekarang,
    tanggalKirim ?? TANGGAL_KIRIM_BAWAAN,
    jam ?? JAM_REKAP_BULANAN_BAWAAN,
    penanda,
  );
  if (!bulan) return;

  /**
   * Tujuan diperiksa SEBELUM `sik` disentuh, dan penandanya sengaja TIDAK
   * dimajukan di cabang ini.
   *
   * Berbeda dari cabang "bulan itu memang kosong" di bawah: yang ini keadaan
   * salah setel yang bisa diperbaiki dalam hitungan detik lewat satu centang, dan
   * memajukan penandanya berarti rekap SEBULAN PENUH hilang begitu saja. Taruhan
   * yang jauh lebih besar daripada pada rekap harian, dan justru itu yang membuat
   * pemeriksaan di depan ini wajib.
   */
  const tujuan = await muatTargetBulanan();
  if (tujuan.length === 0) {
    logger.warn(
      { bulan },
      'rekap bulanan farmasi jatuh tempo tapi belum ada tujuan yang mencentang "terima rekap bulanan"',
    );
    return;
  }

  let hasil: HasilRekapBulanan;
  try {
    hasil = await susunRekapBulanan(bulan, sekarang);
  } catch (err) {
    /**
     * Penanda TIDAK dimajukan, dan kegagalannya tidak ditelan diam-diam.
     *
     * Pelajaran `bpjs.kontrol_last_run`, dan di sini akibatnya paling mahal di
     * seluruh proyek: satu kegagalan sesaat -- MariaDB sedang terkunci SIMRS,
     * jaringan berkedip -- akan menghapus rekap SEBULAN PENUH tanpa percobaan
     * kedua, dan kesempatan berikutnya baru datang tiga puluh hari lagi. Siklus
     * berikutnya mencobanya lagi; `uq_idem` yang menahan kiriman ganda.
     */
    logger.error({ bulan, ...safeError(err) }, 'gagal membaca rekap bulanan farmasi');
    return;
  }

  if (hasil.body === null) {
    logger.info(
      { bulan },
      'rekap bulanan: tidak ada kegiatan farmasi bulan itu dan pesan kosong tidak diisi, lewati',
    );
  } else {
    const ctx = await loadFarmasiContext(TRIGGER_FARMASI_BULANAN, hasil.body, hasil.body);
    for (const t of tujuan) {
      await enqueueMessage(
        {
          /**
           * Kuncinya memuat BULAN YANG DIREKAP, bukan `sekarang`.
           *
           * `sekarang` berbeda tiap siklus, jadi kegagalan menulis penanda akan
           * membuat rekap terkirim ulang tiap lima menit sampai akhir bulan dan
           * tiap kunci dianggap baru. Bulan rekapnya tetap sama, sehingga
           * `uq_idem` menahan kiriman kedua di mesin database.
           *
           * `chatId` WAJIB ikut, dengan alasan yang sudah dibayar di notifikasi
           * farmasi: tanpa itu tujuan KEDUA dan seterusnya ditolak sebagai
           * duplikat dan hanya satu grup yang pernah menerima apa pun -- tanpa
           * satu pun galat, karena INSERT-nya memang `ignoreDuplicates`.
           *
           * TANPA pemecahan bagian, dan itu diukur bukan diasumsikan: isinya
           * jumlahnya TETAP -- tujuh baris resep, tiga baris mutu, empat baris
           * barang -- berapa pun ramainya bulan itu, karena tidak ada satu pun
           * bagian yang tumbuh mengikuti jumlah data. Pesannya ratusan karakter,
           * sementara batas yang terukur 13.035 (migrations/022).
           */
          idempotencyKey: buildIdempotencyKey(TRIGGER_FARMASI_BULANAN, bulan, t.chatId),
          noRkmMedis: null,
          rawPhone: null,
          chatId: t.chatId,
          eventAt: sekarang,
          vars: hasil.vars,
        },
        ctx,
      );
    }
    const r = hasil.ringkas;
    logger.info(
      {
        bulan,
        resep: r.jmlResep,
        pasien: r.jmlPasien,
        belumSerah: r.jmlBelumSerah,
        tanpaTelaah: r.jmlTanpaTelaah,
        penjualan: r.penjualan.jml,
        pengadaan: r.pengadaan.jml,
        tujuan: tujuan.length,
      },
      'rekap bulanan farmasi terkirim',
    );
    await logAudit(
      AKTOR,
      'farmasi_bulanan_kirim',
      bulan,
      `${labelBulan(bulan)}: ${r.jmlResep} resep, ${r.jmlPasien} pasien, ` +
        `${r.jmlBelumSerah} belum diserahkan, ${r.jmlTanpaTelaah} belum ditelaah, ` +
        `${r.penjualan.jml} nota jual, ${r.pengadaan.jml} faktur beli, ${tujuan.length} tujuan`,
    );
  }

  /**
   * Penanda dimajukan SESUDAH pekerjaannya berhasil -- termasuk saat "berhasil"
   * berarti sengaja diam.
   *
   * Diam karena bulan itu memang tidak ada kegiatan apa pun adalah keputusan yang
   * SUDAH diambil dengan benar; mengulanginya tiap lima menit sampai akhir bulan
   * cuma membaca `sik` sia-sia. Bandingkan cabang "belum ada tujuan" di atas,
   * yang sengaja TIDAK memajukannya karena ia keadaan salah setel.
   */
  await setSetting(KUNCI_PENANDA, bulan);
}
