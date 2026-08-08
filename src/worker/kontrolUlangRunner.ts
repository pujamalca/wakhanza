import { getSetting, getSettingNumber, setSetting } from '@/models';
import { pollKontrolUlang, type KontrolUlangRow } from '@/khanza/kontrolUlang';
import { bacaHariSebelum, sasaranKontrol, labelSisaHari, jatuhTempoHarian, tanggalLokal } from '@/core/bpjs';
import { buildIdempotencyKey } from '@/core/idempotency';
import type { TemplateVariable } from '@/core/template';
import { loadPipelineContext, enqueuePemicuPasien, type PipelineContext } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * PENGINGAT SURAT KONTROL untuk pasien NON-BPJS.
 *
 * Padanan `BPJS_KONTROL` dari sisi Khanza sendiri, dan sengaja dibentuk
 * semirip mungkin dengannya: seluruh matematika penjadwalannya
 * (`bacaHariSebelum`, `sasaranKontrol`, `labelSisaHari`, `jatuhTempoHarian`)
 * DIPAKAI BERSAMA dari `core/bpjs.ts` alih-alih disalin. Dua penurunan untuk
 * "kapan H-N jatuh tempo" pasti menyimpang, dan yang muncul saat menyimpang
 * bukan galat melainkan dua pengingat berbeda hari dari satu sistem -- bentuk
 * kegagalan yang sudah berkali-kali dibayar di proyek ini (`respectsOptOut()`,
 * `core/outboxStatus.ts`, `kunciPesanMasuk()`).
 *
 * ==========================================================================
 * Yang BERBEDA dari BPJS_KONTROL, dan cuma ini
 * ==========================================================================
 *
 * 1. Sumbernya `skdp_bpjs` lewat `khanza/kontrolUlang.ts`, bukan tabel
 *    bridging. Uraiannya di sana, termasuk kenapa nama tabelnya menyesatkan.
 *
 * 2. Sakelarnya `template.is_active`, BUKAN sepasang kunci `app_setting`.
 *    Pemicu ini baris `template` biasa, jadi ia dikelola di `/template` seperti
 *    pemicu pasien lain -- dan ikut mendapat tujuan tambahan per pemicu
 *    (`template_target`), daftar tolak, jam tenang, serta penggantian poli
 *    sensitif tanpa satu baris kode tambahan. `loadPipelineContext()`
 *    mengembalikan null saat barisnya nonaktif; itulah gerbangnya.
 *
 * 3. Tidak ada cadangan nomor dari SEP. `bridging_sep.notelep` adalah kolom
 *    milik kanal BPJS; pasien non-BPJS tidak punya padanannya, jadi satu-satunya
 *    nomor adalah `pasien.no_tlp` -- diserahkan sebagai `rawPhone` supaya
 *    `enqueueMessage` yang menjalankan `resolvePhone()` (koreksi manual petugas
 *    MENGALAHKAN normalisasi otomatis, F2.1-F2.3).
 *
 * ==========================================================================
 * TABRAKAN dengan BOOK_REMIND -- baca sebelum menyalakannya
 * ==========================================================================
 *
 * Setelan Khanza `JADIKANBOOKINGSURATKONTROL` (`setting/database.xml`, bukan
 * tabel -- tak terlihat dari sini) membuat setiap surat kontrol JUGA menulis
 * satu baris `booking_registrasi`. Di mesin ini setelannya `yes` dan terukur
 * 253 dari 253 surat punya bookingnya, sehingga BOOK_CONFIRM dan BOOK_REMIND
 * sudah menyentuh pasien yang sama. Menyalakan keduanya = dua pesan untuk satu
 * kunjungan.
 *
 * Sengaja TIDAK dipagari mesin: keduanya sah dipakai sendiri-sendiri, dan di
 * instalasi yang setelannya `no` justru pemicu inilah satu-satunya yang
 * memberitahu pasien. Yang ada adalah peringatan di `/template`, di depan orang
 * yang menyalakannya.
 */

export const TRIGGER_KONTROL_ULANG = 'KONTROL_ULANG';

/**
 * Diekspor untuk `poll:dryrun` -- pemetaan baris->variabel wajib hidup di SATU
 * tempat. Yang membuat aturan itu berbunyi di sini bukan penyimpangan biasa
 * melainkan penyimpangan pada PRATINJAUNYA: `poll:dryrun` ada justru untuk
 * menjawab "apa yang AKAN terkirim" sebelum ada pesan sungguhan ke pasien, jadi
 * pratinjau yang menampilkan variabel kosong sementara produksi mengisinya
 * membuat staf menyimpulkan variabelnya tidak jalan lalu membuangnya dari
 * template.
 */
export function varsKontrolUlang(
  row: KontrolUlangRow,
  hariSebelum: number,
): Partial<Record<TemplateVariable, string>> {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis ?? '',
    nama_dokter: row.nm_dokter ?? '',
    // Kosong bila Khanza tidak membuatkan bookingnya -- lihat KontrolUlangRow.
    nama_poli: row.nm_poli ?? '',
    tanggal_kontrol: row.tgl_kontrol,
    sisa_hari: labelSisaHari(hariSebelum),
    no_surat_kontrol: row.no_antrian,
  };
}

/**
 * Satu kali jalan -- seluruh selisih hari yang disetel.
 * Diekspor untuk verifikasi dan pratinjau.
 *
 * @returns berapa surat yang diproses.
 */
export async function runKontrolUlangJob(now: Date = new Date(), ctxSiap?: PipelineContext): Promise<number> {
  /**
   * Gerbangnya `is_active` pada baris templatenya, dan pemeriksaan itu
   * dikerjakan `loadPipelineContext()` sendiri (null = nonaktif). Diperiksa DI
   * DEPAN, sebelum `sik` disentuh: tidak ada gunanya membaca surat kontrol yang
   * tidak akan dikirim ke mana pun.
   *
   * Konteksnya boleh DISERAHKAN pemanggil. `runKontrolUlangIfDue()` sudah
   * memuatnya untuk memutuskan boleh-tidaknya penanda harian maju, dan memuat
   * ulang di sini berarti dua pembacaan template + tujuan tiap siklus. Tetap
   * dimuat sendiri bila tidak diserahkan, supaya fungsi ini utuh dipanggil
   * sendirian oleh pratinjau dan skrip verifikasi.
   */
  const ctx = ctxSiap ?? (await loadPipelineContext(TRIGGER_KONTROL_ULANG));
  if (!ctx) return 0;

  const rawHari = await getSetting('schedule.kontrol_ulang_hari_sebelum', '1');
  const hariSebelum = bacaHariSebelum(rawHari);
  if (hariSebelum.length === 0) {
    // Menyalakan pemicunya tanpa satu pun selisih hari yang sah berarti
    // pengingatnya tidak akan pernah terkirim -- dan yang terlihat cuma baris
    // template bercentang aktif.
    logger.warn({ rawHari }, 'pengingat kontrol non-BPJS menyala tapi tidak ada "hari sebelum" yang sah');
    return 0;
  }

  const sasaran = sasaranKontrol(hariSebelum, now);
  let rows: KontrolUlangRow[];
  try {
    rows = await pollKontrolUlang(sasaran.map((s) => s.tanggal));
  } catch (err) {
    /**
     * DILEMPAR ULANG, tidak ditelan -- alasan yang sama persis dengan
     * `pollBpjsKontrol`. Pemanggil terjadwal memakai berhasil-atau-tidaknya
     * untuk memutuskan apakah penanda hariannya boleh maju; menelan galat di
     * sini membuat satu kegagalan sesaat menghapus pengingat SEHARIAN bagi
     * semua pasien yang kontrol besok, tanpa percobaan kedua.
     */
    logger.error(safeError(err), 'gagal membaca surat kontrol non-BPJS');
    throw err;
  }

  if (rows.length === 0) {
    logger.info({ sasaran: sasaran.map((s) => s.tanggal) }, 'tidak ada surat kontrol non-BPJS yang jatuh tempo');
    return 0;
  }

  // Satu query mengembalikan beberapa tanggal sekaligus, jadi tiap baris harus
  // tahu ia pengingat yang keberapa.
  const selisihPerTanggal = new Map(sasaran.map((s) => [s.tanggal, s.hariSebelum]));

  let diproses = 0;
  let tanpaPoli = 0;
  for (const row of rows) {
    const hari = selisihPerTanggal.get(row.tgl_kontrol);
    // Tidak mungkin dalam keadaan normal (WHERE-nya persis daftar itu), tapi
    // menebak 0 akan mengirim "besok" untuk kontrol yang masih seminggu lagi.
    if (hari === undefined) continue;
    if (!row.kd_poli) tanpaPoli++;

    /**
     * Kunci idempoten memuat TIGA bagian, mengikuti BPJS_KONTROL:
     *
     * - nomor surat (`tahun`+`no_antrian`) -- satuan yang benar, dan `tahun`
     *   wajib ikut karena `no_antrian` cuma urut PER TAHUN: surat 000001 tahun
     *   ini dan 000001 tahun lalu adalah dua surat berbeda, dan tanpa `tahun`
     *   yang kedua ditolak `uq_idem` sebagai duplikat -- diam-diam, karena
     *   INSERT-nya memang `ignoreDuplicates`.
     * - tanggal kontrolnya -- bisa direvisi; tanpa ini surat yang dijadwalkan
     *   ulang tidak pernah diingatkan lagi.
     * - selisih harinya -- setelan "7,1" harus menghasilkan DUA pengingat.
     *   Tanpa ini yang kedua ditolak sebagai duplikat dan yang terlihat cuma
     *   "pengingat H-1 tidak jalan".
     */
    const kunci = buildIdempotencyKey(
      TRIGGER_KONTROL_ULANG,
      `${row.tahun}-${row.no_antrian}`,
      row.tgl_kontrol,
      String(hari),
    );

    await enqueuePemicuPasien(
      {
        idempotencyKey: kunci,
        noRkmMedis: row.no_rkm_medis,
        rawPhone: row.no_tlp,
        /**
         * Waktu DETEKSI, bukan tanggal kontrolnya. Tanggal kontrol berada di
         * MASA DEPAN (itu memang gunanya), jadi memakainya membuat perhitungan
         * basi F5.3 membandingkan pesan dengan kejadian yang belum terjadi.
         */
        eventAt: now,
        kdPoli: row.kd_poli,
        vars: varsKontrolUlang(row, hari),
      },
      ctx,
    );
    diproses++;
  }

  if (tanpaPoli > 0) {
    /**
     * Poli yang tidak diketahui berarti `checkPrivacy()` memperlakukan barisnya
     * sebagai aman, sehingga penggantian pesan generik untuk poli sensitif
     * diam-diam TIDAK berlaku. Dicatat `warn` justru supaya keadaan itu punya
     * suara -- ia tidak meninggalkan jejak lain di mana pun, dan sebabnya ada
     * di setelan Khanza yang tak terlihat dari dashboard.
     */
    logger.warn(
      { tanpaPoli, dari: rows.length },
      'sebagian surat kontrol tidak punya poli (JADIKANBOOKINGSURATKONTROL mati di Khanza?) -- pemeriksaan poli sensitif tidak berlaku untuk baris itu',
    );
  }

  logger.info(
    { surat: rows.length, diproses, sasaran: sasaran.map((s) => s.tanggal), tujuan: ctx.pemicuPasien?.targets.length ?? 0 },
    'pengingat kontrol non-BPJS selesai',
  );
  return diproses;
}

/**
 * Dipanggil worker tiap siklus pindai. Menentukan sendiri apakah sudah waktunya.
 *
 * Memakai pola `runBpjsKontrolIfDue()`, BUKAN node-cron seperti BOOK_REMIND:
 * `startScheduler()` membaca jamnya SEKALI saat worker mulai, jadi mengubahnya
 * lewat dashboard tidak berlaku sampai ada yang menyalakan ulang worker -- tanpa
 * satu pun tanda bahwa setelan barunya belum aktif. Di sini jamnya dibaca ulang
 * tiap siklus.
 */
export async function runKontrolUlangIfDue(now: Date = new Date()): Promise<void> {
  /**
   * Sakelarnya diperiksa SEBELUM kejatuhtempoan, dan urutan itu mengikat.
   *
   * Terbalik, pemicu yang masih nonaktif pukul 09:00 tetap memajukan penanda
   * hariannya; staf yang menyalakannya pukul 10:00 lalu menunggu pengingat yang
   * baru datang BESOK, tanpa satu pun keterangan kenapa. `runBpjsKontrolIfDue()`
   * memeriksa sakelarnya lebih dulu dengan alasan yang persis sama.
   */
  const ctx = await loadPipelineContext(TRIGGER_KONTROL_ULANG);
  if (!ctx) return;

  const jam = await getSettingNumber('schedule.kontrol_ulang_jam', 9);
  const penanda = await getSetting('schedule.kontrol_ulang_last_run', '');
  if (!jatuhTempoHarian(now, jam, penanda ?? '')) return;

  /**
   * Penanda dimajukan SESUDAH pekerjaannya berhasil, dan hanya kalau berhasil.
   * Alasan lengkapnya di `runBpjsKontrolIfDue()`: satu kegagalan sesaat tidak
   * boleh menghapus pengingat seharian, dan mencoba ulang aman justru karena
   * kunci idempotennya.
   *
   * Nol surat yang jatuh tempo TETAP memajukan penanda -- itu hasil yang sah,
   * bukan kegagalan, dan mengulanginya tiap lima menit sepanjang hari adalah
   * beban yang alasan "sekali sehari" ada untuk mencegahnya.
   */
  try {
    await runKontrolUlangJob(now, ctx);
  } catch {
    // Sudah dicatat di dalam. Penanda TIDAK dimajukan, jadi siklus berikutnya
    // mencobanya lagi.
    return;
  }
  await setSetting('schedule.kontrol_ulang_last_run', tanggalLokal(now));
}
