import { getSetting, getSettingNumber, setSetting } from '@/models';
import { pollKontrolTerbit, JENDELA_KONTROL_TERBIT_PENUH, type KontrolTerbitRow } from '@/khanza/kontrolTerbit';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { tanggalLokal } from '@/core/bpjs';
import { buildIdempotencyKey } from '@/core/idempotency';
import type { TemplateVariable } from '@/core/template';
import { loadPipelineContext, enqueuePemicuPasien, saringKunciBaruPemicuPasien } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * SURAT KONTROL DITERBITKAN -- pasangan `kontrolUlangRunner.ts` dari ujung yang
 * lain, dan sengaja dibentuk semirip mungkin dengannya. Yang perlu dibaca
 * sebelum menyentuh berkas ini adalah bagian yang BERBEDA; yang sama alasannya
 * sudah tertulis di sana.
 *
 * Tiga hal yang berbeda, dan ketiganya berasal dari satu sebab -- pemicunya
 * KEJADIAN (surat disimpan), bukan TANGGAL (H-N):
 *
 * 1. Kelas PINDAI berjendela, bukan jadwal harian. Ia harus berbunyi dalam
 *    hitungan menit sesudah surat disimpan, bukan menunggu pukul 09:00.
 * 2. Kunci idempotennya TANPA selisih hari -- satu surat, satu pemberitahuan,
 *    selamanya. Bandingkan KONTROL_ULANG yang justru MEMASUKKAN selisih hari
 *    supaya setelan "7,1" menghasilkan dua pengingat.
 * 3. Ada kuota per siklus dan lantai aktivasi, karena mengaktifkannya membaca
 *    jendela yang sudah berisi surat lama.
 */

export const TRIGGER_KONTROL_TERBIT = 'KONTROL_TERBIT';

/**
 * Diekspor untuk `poll:dryrun` dan pratinjau -- pemetaan baris->variabel wajib
 * hidup di SATU tempat.
 *
 * Sengaja menghasilkan variabel yang SAMA PERSIS dengan `varsKontrolUlang()`
 * (minus `{sisa_hari}`, yang tidak punya arti saat suratnya baru dibuat):
 * kedua pesan menyangkut surat yang sama, jadi staf yang menyunting salah
 * satunya tidak perlu menghafal dua kosakata, dan template boleh disalin
 * bolak-balik tanpa berlubang.
 */
export function varsKontrolTerbit(row: KontrolTerbitRow): Partial<Record<TemplateVariable, string>> {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis ?? '',
    nama_dokter: row.nm_dokter ?? '',
    // Kosong bila Khanza tidak membuatkan bookingnya -- lihat KontrolUlangRow.
    nama_poli: row.nm_poli ?? '',
    tanggal_kontrol: row.tgl_kontrol,
    no_surat_kontrol: row.no_antrian,
  };
}

/**
 * Per surat, dan TANPA stempel waktu maupun selisih hari.
 *
 * `tahun` WAJIB ikut karena `no_antrian` cuma urut PER TAHUN: surat 000001
 * tahun ini dan 000001 tahun lalu adalah dua surat berbeda, dan tanpa `tahun`
 * yang kedua ditolak `uq_idem` sebagai duplikat -- diam-diam, karena INSERT-nya
 * memang `ignoreDuplicates`.
 *
 * Tanpa stempel waktu karena jendelanya dipindai ULANG tiap siklus selama
 * berhari-hari: kunci yang selalu baru berarti pasien menerima pemberitahuan
 * yang sama tiap lima menit.
 */
function kunciTerbit(row: KontrolTerbitRow): string {
  return buildIdempotencyKey(TRIGGER_KONTROL_TERBIT, `${row.tahun}-${row.no_antrian}`, row.tgl_kontrol);
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Gerbangnya `template.is_active` lewat `loadPipelineContext()` (null =
 * nonaktif), diperiksa DI DEPAN sebelum `sik` disentuh sama sekali.
 */
export async function runKontrolTerbitCycle(now: Date = new Date()): Promise<void> {
  const ctx = await loadPipelineContext(TRIGGER_KONTROL_TERBIT);
  if (!ctx) return;

  const [lookback, kuota, sejak] = await Promise.all([
    getSettingNumber('schedule.kontrol_terbit_lookback_hari', 3),
    getSettingNumber('schedule.kontrol_terbit_max_per_siklus', 20),
    getSetting('schedule.kontrol_terbit_sejak', ''),
  ]);

  /**
   * LANTAI aktivasi yang MEMASANG DIRINYA SENDIRI.
   *
   * Sakelarnya `template.is_active`, dipegang aksi generik di `/template` yang
   * tidak tahu apa-apa tentang pemicu ini. Menambahkan kasus khusus di sana
   * berarti setiap pemicu berikutnya harus ingat menambahkan kasusnya sendiri --
   * dan yang lupa tidak mendapat satu pun galat, cuma arsip yang terkirim
   * sekaligus ke pasien. Mengisi diri sendiri pada siklus pertama tidak bisa
   * lupa.
   *
   * Siklus yang memasang lantainya TIDAK ikut mengirim: jendela yang terbaca
   * saat itu masih jendela SEBELUM lantai dipasang, dan memakainya berarti
   * lantainya tidak menahan apa pun pada satu-satunya siklus yang penting.
   */
  const lantai = sejak?.trim() || '';
  if (!lantai) {
    const hariIni = tanggalLokal(now);
    await setSetting('schedule.kontrol_terbit_sejak', hariIni);
    logger.info(
      { sejak: hariIni },
      'lantai aktivasi surat kontrol dipasang -- surat bertanggal sebelum hari ini tidak akan dikirim otomatis',
    );
    return;
  }

  const jendela = hitungJendelaPindai(now, lookback, lantai);

  let rows: KontrolTerbitRow[];
  try {
    rows = await pollKontrolTerbit(jendela.dari, jendela.sampai);
  } catch (err) {
    // Tidak ada watermark yang bisa tertinggal salah -- jendelanya dihitung
    // ulang tiap siklus, jadi kegagalan sesaat pulih sendiri pada siklus
    // berikutnya.
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca jendela surat kontrol');
    return;
  }

  if (rows.length >= JENDELA_KONTROL_TERBIT_PENUH) {
    logger.warn(
      { ...jendela, terbaca: rows.length },
      'jendela surat kontrol terbaca PENUH -- baris tertua mungkin belum terjangkau, persempit lookback-nya',
    );
  }
  if (rows.length === 0) return;

  /**
   * Dedup DULU, kuota belakangan.
   *
   * Terbalik, kuota per siklus habis dimakan surat yang sudah dikabarkan
   * kemarin dan yang baru tidak pernah kebagian -- kegagalan yang tidak
   * meninggalkan satu pun galat. Pelajaran yang sama sudah dibayar di
   * `suratRunner.ts` dan `pemesananRunner.ts`.
   *
   * Lewat `saringKunciBaruPemicuPasien()`, BUKAN `saringKunciBaru()` biasa, dan
   * itu bukan kerapian: pemicu ini dikirim lewat `enqueuePemicuPasien()`, yang
   * pada `tujuan_mode = 'tujuan'` hanya menulis kunci TURUNAN per alamat. Kunci
   * dasar yang diperiksa penyaring biasa karena itu tidak pernah ada di
   * `outbox`, sehingga ia tidak menyaring apa pun dan justru MENGHIDUPKAN
   * kegagalan yang dijelaskan alinea di atas. Terjadi sungguhan di produksi --
   * lihat kunciYangDitulis() di pipeline.ts.
   */
  const belum = await saringKunciBaruPemicuPasien(rows, kunciTerbit, ctx);
  if (belum.length === 0) return;

  const dikerjakan = belum.slice(0, Math.max(0, kuota));
  const ditunda = belum.length - dikerjakan.length;
  if (dikerjakan.length === 0) return;

  let terkirim = 0;
  let tanpaPoli = 0;
  for (const row of dikerjakan) {
    if (!row.kd_poli) tanpaPoli++;
    await enqueuePemicuPasien(
      {
        idempotencyKey: kunciTerbit(row),
        noRkmMedis: row.no_rkm_medis,
        rawPhone: row.no_tlp,
        /**
         * Waktu DETEKSI, bukan `tgl_surat`. Tanggal surat DIPILIH staf dan bisa
         * dimundurkan berhari-hari; memakainya membuat surat yang baru saja
         * disimpan dinilai basi lalu ditandai `expired` (F5.3) tanpa pernah
         * terkirim.
         */
        eventAt: now,
        kdPoli: row.kd_poli,
        vars: varsKontrolTerbit(row),
      },
      ctx,
    );
    terkirim++;
  }

  if (tanpaPoli > 0) {
    // Poli yang tidak diketahui berarti `checkPrivacy()` memperlakukan barisnya
    // sebagai aman, sehingga penggantian pesan generik untuk poli sensitif
    // diam-diam TIDAK berlaku. Alasan lengkapnya di `khanza/kontrolUlang.ts`.
    logger.warn(
      { tanpaPoli, dari: dikerjakan.length },
      'sebagian surat kontrol tidak punya poli -- pemeriksaan poli sensitif tidak berlaku untuk baris itu',
    );
  }

  logger.info(
    {
      ...jendela,
      terbaca: rows.length,
      baru: belum.length,
      terkirim,
      tujuan: ctx.pemicuPasien?.targets.length ?? 0,
      ...(ditunda ? { ditundaKuota: ditunda } : {}),
    },
    'siklus surat kontrol terbit selesai',
  );
}
