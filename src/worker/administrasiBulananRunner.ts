import { AdministrasiTarget, getSetting, getSettingBool, setSetting, logAudit } from '@/models';
import { rekapAdministrasiBulanan } from '@/khanza/administrasiBulanan';
import {
  gabungAdmBulanan,
  formatRincianCaraBayar,
  formatRincianBerkas,
  formatRincianPasien,
  judulBulanAdm,
  type RingkasAdmBulanan,
} from '@/core/administrasiBulanan';
import {
  bacaTanggalKirim,
  bulanJatuhTempo,
  labelBulan,
  JAM_REKAP_BULANAN_BAWAAN,
  TANGGAL_KIRIM_BAWAAN,
} from '@/core/rekapBulan';
/**
 * Jamnya dibaca `bacaJamRekap()` yang SAMA dipakai ketiga rekap harian dan rekap
 * bulanan farmasi, bukan penurunan tersendiri. "Pukul berapa" adalah pertanyaan
 * yang benar-benar sama di semua tempat itu, dan dua penurunan untuknya adalah
 * dua kesempatan berbeda tafsir soal apakah `24:00` sah.
 */
import { bacaJamRekap } from '@/core/rekapJadwal';
import { formatJumlah } from '@/core/notaBarang';
import { buildIdempotencyKey } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import type { TargetAktif } from './farmasiRunner';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * REKAP BULANAN ADMINISTRASI -- satu pesan sebulan berisi gambaran kunjungan
 * bulan yang baru lewat, pada tanggal dan jam yang disetel staf.
 *
 * ==========================================================================
 * Kembaran `farmasiBulananRunner.ts`, dan kemiripannya DIPAKAI
 * ==========================================================================
 *
 * Matematika jadwalnya seluruhnya dipakai bersama lewat `core/rekapBulan.ts`
 * (`bacaTanggalKirim`, `bulanJatuhTempo`, `labelBulan`), dan bentuk runnernya
 * sengaja disamakan sampai ke urutan cabangnya. Dua penurunan untuk "bulan mana
 * yang jatuh tempo" adalah dua kesempatan berbeda tafsir, dan yang muncul saat
 * berbeda bukan galat melainkan dua rekap yang menyebut periode berbeda pada pagi
 * yang sama.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak satu pun pasien disebut
 * ==========================================================================
 *
 *   tujuan         `administrasi_target.terima_bulanan` -- TABEL tersendiri,
 *                  bukan kolom di `farmasi_target`. Halaman /administrasi sampai
 *                  migrations/047 tidak punya daftar tujuan sama sekali; ini
 *                  penerima STAF pertama di sana.
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *   jam tenang     DILEWATI (`ADMINISTRASI_BULANAN` di `BYPASS_QUIET_HOURS`),
 *                  karena jam DAN tanggalnya dipilih staf sendiri. Kodenya
 *                  sengaja TIDAK menumpang `ADMINISTRASI` -- lihat alasannya di
 *                  `core/quietHours.ts`.
 *   poli sensitif  tidak relevan; `kd_poli` tidak pernah dibaca sama sekali.
 *
 * Isinya SELURUHNYA angka, ditambah nama PENJAMIN sebagai label baris agregat.
 * Pagarnya ada di daftar SELECT `khanza/administrasiBulanan.ts`, bukan di sini.
 */

export const TRIGGER_ADMINISTRASI_BULANAN = 'ADMINISTRASI_BULANAN';
const AKTOR = 'system:administrasi_bulanan';
const KUNCI_PENANDA = 'administrasi.bulanan_last_run';

/**
 * Tujuan yang mencentang "terima rekap bulanan".
 *
 * `isActive` TETAP ikut disyaratkan, dan itu bukan pengetatan berlebih melainkan
 * arti kolomnya sendiri: tujuan yang dinonaktifkan tidak menerima apa pun, apa pun
 * centangnya -- kalimat yang dipakai staf saat mematikan sebuah grup buru-buru.
 */
export async function muatTargetAdmBulanan(): Promise<TargetAktif[]> {
  const rows = await AdministrasiTarget.findAll({
    where: { isActive: true, terimaBulanan: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/**
 * Satu ringkasan jadi satu set variabel.
 *
 * Diekspor supaya PRATINJAU di `/administrasi?tab=bulanan`, tombol ujinya, dan
 * `npm run dryrun:adm-bulanan` memakai fungsi yang SAMA dipakai worker saat
 * benar-benar mengirim -- pelajaran yang sudah dibayar di kotak uji balasan
 * otomatis, balasan stok, dan darurat stok.
 *
 * KEDUA sisi disediakan untuk resep dan asesmen (`ada` dan `tanpa`), dan keduanya
 * datang dari `gabungAdmBulanan()` yang MENURUNKANNYA dari satu pembilang. Itu
 * yang menjamin keduanya berjumlah secara aritmetika, sehingga pembaca bisa
 * menjumlahkannya sendiri di layar tanpa membuka Khanza.
 */
export function susunVarsAdmBulanan(
  r: RingkasAdmBulanan,
  sekarang: Date,
): Partial<Record<TemplateVariable, string>> {
  return {
    bulan_rekap: judulBulanAdm(r),
    jumlah_kunjungan: formatJumlah(r.jmlKunjungan),
    jumlah_pasien: formatJumlah(r.jmlPasien),
    jumlah_batal: formatJumlah(r.jmlBatal),
    jumlah_pasien_baru: formatJumlah(r.jmlBaru),
    jumlah_pasien_lama: formatJumlah(r.jmlLama),
    jumlah_berulang: formatJumlah(r.jmlBerulang),
    jumlah_kunjungan_berulang: formatJumlah(r.jmlKunjunganBerulang),
    jumlah_ada_resep: formatJumlah(r.jmlAdaResep),
    jumlah_tanpa_resep: formatJumlah(r.jmlTanpaResep),
    jumlah_ada_diagnosa: formatJumlah(r.jmlAdaDiagnosa),
    jumlah_ada_soapie: formatJumlah(r.jmlAdaSoapie),
    jumlah_ada_resume: formatJumlah(r.jmlAdaResume),
    jumlah_baru_ada_asesmen: formatJumlah(r.jmlBaruAdaAsesmen),
    jumlah_baru_tanpa_asesmen: formatJumlah(r.jmlBaruTanpaAsesmen),
    jumlah_belum_bayar: formatJumlah(r.jmlBelumBayar),
    jumlah_surat_sakit: formatJumlah(r.jmlSuratSakit),
    jumlah_surat_kontrol: formatJumlah(r.jmlSuratKontrol),
    rincian_cara_bayar: formatRincianCaraBayar(r),
    rincian_pasien: formatRincianPasien(r),
    rincian_berkas: formatRincianBerkas(r),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };
}

export interface HasilRekapAdmBulanan {
  ringkas: RingkasAdmBulanan;
  bulan: string;
  /** Teks yang benar-benar dirender, atau null bila memilih diam. */
  body: string | null;
  vars: Partial<Record<TemplateVariable, string>>;
}

/**
 * Membaca `sik` lalu menyusun isi pesannya -- tanpa mengirim apa pun.
 *
 * Dipisahkan dari pengirimannya dan diekspor supaya pratinjau dashboard, tombol
 * uji, dan dryrun memakai jalur yang sama dengan worker.
 */
export async function susunRekapAdmBulanan(
  ym: string,
  sekarang: Date,
): Promise<HasilRekapAdmBulanan> {
  const agregat = await rekapAdministrasiBulanan(ym);
  const ringkas = gabungAdmBulanan(ym, agregat);

  const [bodyAda, bodyKosong] = await Promise.all([
    getSetting('administrasi.template_bulanan', ''),
    getSetting('administrasi.template_bulanan_kosong', ''),
  ]);

  /**
   * Template kosong = DIAM, dan HANYA pada cabang "bulan itu tanpa satu pun
   * kunjungan".
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

  return { ringkas, bulan: ym, body, vars: susunVarsAdmBulanan(ringkas, sekarang) };
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
export async function runAdministrasiBulananIfDue(): Promise<void> {
  if (!(await getSettingBool('administrasi.bulanan_enabled', false))) return;

  const [tanggalRaw, jamRaw, penanda] = await Promise.all([
    getSetting('administrasi.bulanan_tanggal', String(TANGGAL_KIRIM_BAWAAN)),
    getSetting('administrasi.bulanan_jam', '08:00'),
    getSetting(KUNCI_PENANDA, ''),
  ]);

  /**
   * Setelan yang tidak terbaca jatuh ke bawaan, TIDAK mendiamkan rekapnya.
   *
   * Server action menolak bentuk yang salah di depan orang yang bisa
   * memperbaikinya seketika; di sini, pukul delapan pagi tanggal 3 tanpa
   * siapa-siapa untuk diberi tahu, menolak diam berarti rekapnya berhenti
   * selamanya tanpa satu pun tanda. Pola yang sama dengan `bacaHariSebelum()`.
   */
  const tanggalKirim = bacaTanggalKirim(tanggalRaw);
  if (tanggalKirim === null) {
    logger.warn(
      { tanggal: tanggalRaw, dipakai: TANGGAL_KIRIM_BAWAAN },
      'administrasi.bulanan_tanggal tidak terbaca sebagai 1-28, memakai bawaan',
    );
  }
  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    logger.warn(
      { jam: jamRaw, dipakai: '08:00' },
      'administrasi.bulanan_jam tidak terbaca sebagai HH:MM, memakai jam bawaan',
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
   * memajukan penandanya berarti rekap SEBULAN PENUH hilang begitu saja.
   */
  const tujuan = await muatTargetAdmBulanan();
  if (tujuan.length === 0) {
    logger.warn(
      { bulan },
      'rekap bulanan administrasi jatuh tempo tapi belum ada tujuan yang mencentang "terima rekap bulanan"',
    );
    return;
  }

  let hasil: HasilRekapAdmBulanan;
  try {
    hasil = await susunRekapAdmBulanan(bulan, sekarang);
  } catch (err) {
    /**
     * Penanda TIDAK dimajukan, dan kegagalannya tidak ditelan diam-diam.
     *
     * Pelajaran `bpjs.kontrol_last_run`, dan pada periode bulanan akibatnya
     * paling mahal: satu kegagalan sesaat -- MariaDB sedang terkunci SIMRS,
     * jaringan berkedip -- akan menghapus rekap SEBULAN PENUH tanpa percobaan
     * kedua, dan kesempatan berikutnya baru datang tiga puluh hari lagi. Siklus
     * berikutnya mencobanya lagi; `uq_idem` yang menahan kiriman ganda.
     */
    logger.error({ bulan, ...safeError(err) }, 'gagal membaca rekap bulanan administrasi');
    return;
  }

  if (hasil.body === null) {
    logger.info(
      { bulan },
      'rekap bulanan administrasi: tidak ada kunjungan bulan itu dan pesan kosong tidak diisi, lewati',
    );
  } else {
    const ctx = await loadFarmasiContext(TRIGGER_ADMINISTRASI_BULANAN, hasil.body, hasil.body);
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
           * TANPA pemecahan bagian, dan itu diukur bukan diasumsikan: satu-satunya
           * bagian yang tumbuh mengikuti data adalah `{rincian_cara_bayar}`, dan
           * ia tumbuh mengikuti jumlah PENJAMIN -- terukur DUA di instalasi ini,
           * dan katalog `penjab` seluruhnya berisi belasan baris. Pesannya
           * ratusan karakter, sementara batas yang terukur 13.035
           * (migrations/022).
           */
          idempotencyKey: buildIdempotencyKey(TRIGGER_ADMINISTRASI_BULANAN, bulan, t.chatId),
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
        kunjungan: r.jmlKunjungan,
        pasien: r.jmlPasien,
        batal: r.jmlBatal,
        baruTanpaAsesmen: r.jmlBaruTanpaAsesmen,
        belumBayar: r.jmlBelumBayar,
        tujuan: tujuan.length,
      },
      'rekap bulanan administrasi terkirim',
    );
    await logAudit(
      AKTOR,
      'administrasi_bulanan_kirim',
      bulan,
      `${labelBulan(bulan)}: ${r.jmlKunjungan} kunjungan, ${r.jmlPasien} pasien, ` +
        `${r.jmlBatal} batal, ${r.jmlBaruTanpaAsesmen} asesmen belum diisi, ` +
        `${r.jmlBelumBayar} belum closing billing, ${tujuan.length} tujuan`,
    );
  }

  /**
   * Penanda dimajukan SESUDAH pekerjaannya berhasil -- termasuk saat "berhasil"
   * berarti sengaja diam.
   *
   * Diam karena bulan itu memang tanpa kunjungan adalah keputusan yang SUDAH
   * diambil dengan benar; mengulanginya tiap lima menit sampai akhir bulan cuma
   * membaca `sik` sia-sia. Bandingkan cabang "belum ada tujuan" di atas, yang
   * sengaja TIDAK memajukannya karena ia keadaan salah setel.
   */
  await setSetting(KUNCI_PENANDA, bulan);
}
