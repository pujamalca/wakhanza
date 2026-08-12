import { sikSelect } from '@/db/sik';
import { registerPlanCheck, MAX_ROWS_JENDELA_30_HARI } from './planChecks';
import { formatResepPrefix, lookbackDate } from './common';
import type {
  BarisRekapResepHeader,
  BarisRekapResepItem,
  BarisRekapResepNilai,
  BarisRekapResepRacikan,
} from '@/core/resepRekap';

/**
 * Dua langkah kerja APOTEK di `resep_obat`, untuk diberitahukan ke grup/petugas
 * farmasi -- bukan ke pasien.
 *
 * Kolom mana yang berarti apa dibuktikan dari data `sik` di mesin ini, bukan
 * ditebak dari namanya (nama `tgl_perawatan` sama sekali tidak mengisyaratkan
 * "validasi"):
 *
 *   dokter menulis resep   tgl_peresepan + jam_peresepan
 *   VALIDASI apotek        tgl_perawatan + jam              rata-rata +5,3 menit
 *   PENYERAHAN             tgl_penyerahan + jam_penyerahan  rata-rata +12,4 menit
 *
 * Yang memastikan `jam` benar-benar langkah tersendiri dan bukan salinan waktu
 * penyerahan: 3.214 resep yang BELUM diserahkan (`tgl_penyerahan='0000-00-00'`)
 * sudah punya `tgl_perawatan`/`jam` terisi, dan dari ~28 ribu baris yang sudah
 * diserahkan hanya 1 yang urutannya terbalik.
 *
 * PRIVASI: `no_tlp` sengaja TIDAK diambil sama sekali. Tujuan pesan ini adalah
 * staf, jadi nomor pasien tidak pernah dibutuhkan -- dan kolom yang tidak
 * pernah dibaca tidak mungkin bocor (ARCHITECTURE §5.2). Nama obat, jumlah, dan
 * aturan pakai juga tidak diambil: apotek membacanya di SIMRS, dan daftar obat
 * seseorang adalah justru bagian yang paling tidak boleh berpindah ke grup WhatsApp.
 */
export interface ResepStafRow {
  no_resep: string;
  no_rawat: string;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  nm_poli: string | null;
  nm_dokter: string | null;
  /** Tanggal+jam kejadian yang sedang dipantau (validasi ATAU penyerahan). */
  tgl_kejadian: string;
  jam_kejadian: string;
}

/**
 * Satu bentuk SQL untuk kedua pemicu, dibedakan lewat pasangan kolom waktunya.
 *
 * Ditulis begini alih-alih dua fungsi terpisah karena keduanya menyaring baris
 * yang SAMA dari tabel yang sama dengan bentuk kondisi yang sama -- dua salinan
 * yang berbeda satu nama kolom adalah cara paling gampang membuat perbaikan
 * pada satu pemicu diam-diam tidak ikut berlaku pada satunya.
 *
 * Nama kolom di sini dari daftar tetap di bawah, TIDAK PERNAH dari input
 * pengguna -- lihat pemanggilnya.
 */
function buildResepStafSql(kolomTgl: string, kolomJam: string, filterTambahan: string) {
  return `
    SELECT
      ro.no_resep, ro.no_rawat,
      r.no_rkm_medis, r.kd_poli,
      p.nm_pasien,
      pk.nm_poli,
      d.nm_dokter,
      ro.${kolomTgl} AS tgl_kejadian,
      ro.${kolomJam} AS jam_kejadian
    FROM resep_obat ro
    JOIN reg_periksa r ON r.no_rawat = ro.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN dokter d ON d.kd_dokter = ro.kd_dokter
    WHERE ro.no_resep >= :lookbackPrefix
      ${filterTambahan}
      AND TIMESTAMP(ro.${kolomTgl}, ro.${kolomJam}) >= :cursorTs
    ORDER BY ro.${kolomTgl}, ro.${kolomJam}
    LIMIT 200
  `;
}

/**
 * `tgl_perawatan` NULLABLE dan berisi '0000-00-00' pada 13 baris lama -- sebuah
 * resep yang belum pernah disentuh apotek. Keduanya harus disaring eksplisit:
 * TIMESTAMP('0000-00-00', ...) menghasilkan NULL dan baris itu akan lolos ke
 * pemetaan tanggal sebagai Invalid Date.
 */
const SQL_VALIDASI = buildResepStafSql(
  'tgl_perawatan',
  'jam',
  `AND ro.tgl_perawatan IS NOT NULL AND ro.tgl_perawatan <> '0000-00-00'`,
);

const SQL_PENYERAHAN = buildResepStafSql(
  'tgl_penyerahan',
  'jam_penyerahan',
  `AND ro.tgl_penyerahan <> '0000-00-00'`,
);

export async function pollResepValidasi(cursorTs: Date, lookbackDays: number): Promise<ResepStafRow[]> {
  return sikSelect<ResepStafRow>(SQL_VALIDASI, {
    lookbackPrefix: formatResepPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  });
}

export async function pollResepPenyerahan(cursorTs: Date, lookbackDays: number): Promise<ResepStafRow[]> {
  return sikSelect<ResepStafRow>(SQL_PENYERAHAN, {
    lookbackPrefix: formatResepPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  });
}

const replacementsContoh = { lookbackPrefix: formatResepPrefix(lookbackDate(30)), cursorTs: new Date() };

registerPlanCheck({ name: 'FARMASI_VALIDASI', sql: SQL_VALIDASI, replacements: replacementsContoh, maxRows: MAX_ROWS_JENDELA_30_HARI });
registerPlanCheck({ name: 'FARMASI_PENYERAHAN', sql: SQL_PENYERAHAN, replacements: replacementsContoh, maxRows: MAX_ROWS_JENDELA_30_HARI });

/* ==========================================================================
 * REKAP HARIAN RESEP (migrations/042)
 *
 * Ditaruh di berkas INI, bukan di `khanza/resepRekap.ts` tersendiri, dengan
 * alasan yang sama persis yang menaruh rekap penjualan di `khanza/penjualan.ts`:
 * yang paling penting untuk dijaga di seluruh keluarga resep adalah pagar privasi
 * di kepala berkas ini, dan pagar itu berbunyi "nama obat, jumlah, dan aturan
 * pakai juga tidak diambil". Berkas kedua berarti tempat kedua yang bisa
 * menambahkannya tanpa pernah membaca kalimat itu. Menyatukannya membuat pagar
 * itu berlaku secara FISIK, bukan lewat ingatan penulis berikutnya.
 *
 * Kelas pemicunya berbeda (WAKTU, bukan sisip) dan itu memang alasan wajar untuk
 * memisah berkas -- tapi kelas pemicu tinggal di runner, sementara yang tinggal
 * di sini cuma bentuk SQL-nya, dan bentuk SQL-nya menyentuh tabel yang sama
 * persis dengan pagar yang sama persis.
 *
 * --------------------------------------------------------------------------
 * TIGA query, dan menggabungkannya jadi satu menghasilkan angka yang KELIRU
 * --------------------------------------------------------------------------
 *
 * `resep_obat` (satu baris per resep), `resep_dokter` (satu baris per obat), dan
 * `resep_dokter_racikan` (satu baris per racikan) adalah tiga TINGKAT yang
 * berbeda. Satu query yang menjoinkan ketiganya lalu menghitung `COUNT(*)` akan
 * menghitung satu resep sebanyak baris obat di dalamnya -- resep berisi 5 obat
 * terhitung LIMA RESEP. Tidak ada galat yang muncul, dan hasilnya tetap terlihat
 * masuk akal. Penggabungannya di `core/resepRekap.ts`'s `gabungRekapResep()`,
 * berikut uji regresi yang mematoknya.
 *
 * --------------------------------------------------------------------------
 * Rentang harinya prefiks `no_resep`, dan ia EKSAK
 * --------------------------------------------------------------------------
 *
 * `no_resep` berbentuk `YYYYMMDD` + 4 digit dan merupakan PRIMARY KEY, jadi
 * rentang satu hari jatuh sebagai `range` pada PRIMARY. Diukur atas seluruh
 * 12.422 baris: prefiksnya cocok dengan `tgl_peresepan` pada 12.353 baris dan
 * MENYIMPANG NOL HARI pada seluruhnya (69 sisanya `tgl_peresepan` kosong, bukan
 * menyimpang). Sekelas `nota_jual` penjualan, bukan sekelas `no_faktur`
 * pengadaan yang butuh margin.
 *
 * Yang ditentukan prefiks itu adalah tanggal PERESEPAN -- kapan dokter
 * menulisnya. Itu memang yang ditanyakan rekap ini, dan sekaligus satu-satunya
 * dari ketiga pasang kolom waktu di tabel ini yang prefiksnya menyandikannya:
 * terhadap `tgl_perawatan` (validasi apotek) prefiksnya menyimpang pada 94 baris,
 * karena validasi bisa jatuh di hari berikutnya.
 * ========================================================================== */

/** Rentang prefiks `no_resep` untuk satu hari kalender. */
function rentangResepHarian(tanggal: string): { awalPrefix: string; akhirPrefix: string } {
  const padat = tanggal.replaceAll('-', '');
  return { awalPrefix: `${padat}0000`, akhirPrefix: `${padat}9999` };
}

/**
 * Agregat tingkat RESEP untuk satu hari, dikelompokkan per dokter.
 *
 * `reg_periksa` dan `pasien` TIDAK di-JOIN sama sekali -- bukan "di-JOIN lalu
 * kolomnya tidak dipilih", melainkan tabelnya memang tidak disebut, sehingga
 * tidak ada jalan apa pun dari query ini menuju seorang pasien. Ini lebih ketat
 * daripada rekap penjualan, tempat tabel `penjualan` sendiri memang membawa
 * kolom pasiennya.
 *
 * `dokter` di-LEFT JOIN, bukan INNER: kode dokter yang mastersnya sudah dihapus
 * tetap harus terhitung, kalau tidak `{jumlah_resep}` berhenti cocok dengan
 * jumlah resep yang sungguhan. `core/resepRekap.ts` yang menyediakan nama
 * penggantinya (kode dokter, lalu "(tanpa nama)").
 *
 * `tgl_penyerahan <> '0000-00-00'` adalah penanda "sudah diserahkan" milik
 * Khanza -- kolomnya NOT NULL dan memakai tanggal nol sebagai penanda kosong,
 * bukan NULL. Lihat komentar pembuka berkas ini.
 */
function buildRekapResepHeaderSql(): string {
  return `
    SELECT
      ro.kd_dokter                                      AS kd_dokter,
      COALESCE(d.nm_dokter, '')                         AS nm_dokter,
      COUNT(*)                                          AS jml_resep,
      SUM(ro.tgl_penyerahan <> '0000-00-00')            AS jml_serah
    FROM resep_obat ro
    LEFT JOIN dokter d ON d.kd_dokter = ro.kd_dokter
    WHERE ro.no_resep >= :awalPrefix AND ro.no_resep <= :akhirPrefix
    GROUP BY ro.kd_dokter, d.nm_dokter
  `;
}

/**
 * Agregat tingkat BARIS OBAT untuk satu hari, dikelompokkan per dokter.
 *
 * Hanya `COUNT(*)` dan `SUM(rd.jml)`. `kode_brng` dan `aturan_pakai` TIDAK
 * di-SELECT -- yang pertama nama obatnya, yang kedua dosisnya, dan keduanya
 * persis apa yang komentar pembuka berkas ini larang keluar dari `sik`.
 *
 * Penyaringnya ditulis pada `rd.no_resep` sebagaimana saat diukur, walau
 * MariaDB membalik arah join-nya sendiri (terukur `ro` sebagai penggerak lewat
 * `range PRIMARY`, lalu `rd` lewat `ref no_resep`): keduanya disamakan oleh
 * join, dan bentuk yang berbeda dari yang diperiksa adalah bentuk yang belum
 * diperiksa.
 */
function buildRekapResepItemSql(): string {
  return `
    SELECT
      ro.kd_dokter                    AS kd_dokter,
      COUNT(*)                        AS jml_baris,
      COALESCE(SUM(rd.jml), 0)        AS jml_obat
    FROM resep_dokter rd
    JOIN resep_obat ro ON ro.no_resep = rd.no_resep
    WHERE rd.no_resep >= :awalPrefix AND rd.no_resep <= :akhirPrefix
    GROUP BY ro.kd_dokter
  `;
}

/**
 * Agregat RACIKAN untuk satu hari, dikelompokkan per dokter.
 *
 * Query KETIGA dan bukan digabung ke yang kedua: `resep_dokter` dan
 * `resep_dokter_racikan` sama-sama detail dari `resep_obat`, jadi menjoinkan
 * keduanya sekaligus mengalikan barisnya satu sama lain.
 *
 * `nama_racik` TIDAK di-SELECT, dan ini yang paling gampang dikira aman: ia nama
 * racikan yang DIKETIK DOKTER, dan racikan biasa dinamai menurut indikasinya --
 * jadi ia bisa menyebut penyakit selugas nama obat. Yang diambil cuma jumlahnya.
 */
function buildRekapResepRacikanSql(): string {
  return `
    SELECT
      ro.kd_dokter                    AS kd_dokter,
      COUNT(*)                        AS jml_racikan
    FROM resep_dokter_racikan rr
    JOIN resep_obat ro ON ro.no_resep = rr.no_resep
    WHERE rr.no_resep >= :awalPrefix AND rr.no_resep <= :akhirPrefix
    GROUP BY ro.kd_dokter
  `;
}

/* ==========================================================================
 * NILAI RUPIAH -- query KEEMPAT, dan satu-satunya yang menyentuh tabel penagihan
 * ==========================================================================
 *
 * `resep_dokter` TIDAK PUNYA SATU PUN KOLOM HARGA -- isinya cuma `no_resep`,
 * `kode_brng`, `jml`, `aturan_pakai`. Jadi "berapa rupiah resep hari ini" tidak
 * bisa dijawab dari ketiga query di atas sama sekali; ia harus datang dari luar.
 *
 * --------------------------------------------------------------------------
 * DUA sumber mungkin, dan yang satunya diam-diam salah
 * --------------------------------------------------------------------------
 *
 * (A) KATALOG -- `databarang.ralan` x `resep_dokter.jml`, plus bahan racikan dari
 *     `resep_dokter_racikan_detail`. Tidak menyentuh tabel penagihan sama sekali,
 *     jadi terlihat lebih "bersih". DITOLAK, dan sebabnya diukur:
 *
 *       - `databarang` menyimpan harga HARI INI, bukan harga saat obatnya
 *         diserahkan. `farmasi.resep_rekap_offset_hari` boleh 1, dan
 *         `npm run dryrun:resep` menerima tanggal apa pun -- jadi satu perubahan
 *         harga membuat rekap kemarin menyebut angka yang TIDAK PERNAH
 *         ditagihkan ke siapa pun. Tanpa galat, dan hasilnya tetap masuk akal.
 *       - Ia sudah meleset hari ini juga: pada 2026-08-10 katalog menghasilkan
 *         Rp1.471.826 atas 244 baris, sementara yang benar-benar ditagihkan
 *         Rp1.455.477 atas 245 baris.
 *       - Ia buta pada embalase dan tuslah, yang memang bukan milik katalog.
 *       - `resep_obat.status` = 'ralan' pada SELURUH 12.422 baris di sini, jadi
 *         kolom `ralan` kebetulan benar -- tapi RS yang melayani rawat inap harus
 *         memilih antara `kelas1`/`kelas2`/`kelas3`/`utama`/`vip`/`vvip` menurut
 *         kelas kamar pasiennya, yang cuma bisa dibaca lewat `reg_periksa`.
 *         Yaitu tabel yang rekap ini justru ada untuk TIDAK disentuh.
 *
 * (B) YANG BENAR-BENAR DITAGIHKAN -- `detail_pemberian_obat.total`. Inilah yang
 *     dipakai. Angkanya dibekukan Khanza pada saat validasi apotek, jadi ia tetap
 *     benar dibaca kapan pun; dan `total` diambil apa adanya alih-alih dihitung
 *     ulang dari `biaya_obat * jml + embalase + tuslah` karena 21 dari 9.076 baris
 *     (90 hari) menyimpang dari rumus itu -- kolomnya yang berwenang, bukan
 *     rumusnya. Embalase dan tuslah nol pada seluruh 33.198 baris setahun di sini,
 *     tapi keduanya sudah ikut terhitung di dalam `total` tanpa perlu disebut.
 *
 * --------------------------------------------------------------------------
 * PRIVASI -- kenapa ini TIDAK melebarkan apa pun
 * --------------------------------------------------------------------------
 *
 * `detail_pemberian_obat` di-JOIN lewat `no_rawat`, dan itu terdengar seperti
 * jalan menuju pasien. Bukan, dan bedanya penting:
 *
 *   - `resep_obat` -- penggerak query ini sejak migrations/042 -- SUDAH memuat
 *     `no_rawat`, dan `resep_dokter` sudah dijoinkan padanya. Jadi hubungan
 *     "pasien -> obat" sudah terbentang di modul ini sebelum baris ini ada. Yang
 *     ditambahkan `detail_pemberian_obat` cuma HARGA, bukan hubungan baru.
 *   - `reg_periksa` dan `pasien` tetap TIDAK disebut sama sekali. Tidak ada nama,
 *     tidak ada nomor rekam medis, tidak ada poli yang bisa dibaca dari sini.
 *   - `no_rawat` dipakai sebagai KUNCI JOIN dan tidak pernah masuk daftar SELECT,
 *     jadi ia tidak pernah meninggalkan SQL. `npm run dryrun:resep` membuktikannya
 *     pada `Object.keys()` baris hasilnya -- bukan dengan membaca SQL ini.
 *   - `kode_brng` juga tidak diambil: yang keluar cuma SATU angka per dokter.
 *
 * --------------------------------------------------------------------------
 * Mustahil dobel hitung, dan itu diukur bukan diasumsikan
 * --------------------------------------------------------------------------
 *
 * Join-nya `(tgl_perawatan, jam, no_rawat)` -- bukan `no_resep`, yang memang tidak
 * ada di `detail_pemberian_obat`. Kalau satu kombinasi itu dipakai oleh DUA resep,
 * baris penagihannya akan terhitung dua kali. Diukur atas 365 hari: NOL kombinasi
 * dipakai lebih dari satu resep.
 *
 * Ketiga kolom itu kebetulan juga tiga kolom terdepan PRIMARY KEY
 * `detail_pemberian_obat`, jadi join-nya jatuh sebagai `ref PRIMARY` (key_len 25)
 * alih-alih pemindaian -- terukur 31 ms untuk hari tersibuk.
 *
 * --------------------------------------------------------------------------
 * INNER JOIN, dan akibatnya yang harus disadari
 * --------------------------------------------------------------------------
 *
 * Resep yang belum divalidasi apotek belum punya baris penagihan sama sekali, jadi
 * ia menyumbang nol rupiah. Itu benar -- uangnya memang belum ada -- tapi artinya
 * `{nilai_obat}` dan `{jumlah_resep}` berdiri di atas denominator yang sedikit
 * berbeda. Terukur kecil: 5 dari 9.038 resep (90 hari) tanpa baris penagihan.
 *
 * LEFT JOIN tidak memperbaiki apa pun di sini -- ia menghasilkan angka yang sama
 * persis, cuma dengan baris nol tambahan -- sementara INNER membuat maksudnya
 * terbaca: yang dijumlahkan adalah uang yang SUDAH masuk penagihan.
 */
function buildRekapResepNilaiSql(): string {
  return `
    SELECT
      ro.kd_dokter                    AS kd_dokter,
      COALESCE(SUM(dpo.total), 0)     AS nilai_obat
    FROM resep_obat ro
    JOIN detail_pemberian_obat dpo
      ON dpo.tgl_perawatan = ro.tgl_perawatan
     AND dpo.jam           = ro.jam
     AND dpo.no_rawat      = ro.no_rawat
    WHERE ro.no_resep >= :awalPrefix AND ro.no_resep <= :akhirPrefix
    GROUP BY ro.kd_dokter
  `;
}

/**
 * Agregat satu hari penuh.
 *
 * Ketiganya mengembalikan `[]` untuk hari tanpa satu resep pun -- keadaan yang
 * benar-benar terjadi dan bukan kelainan: terukur, HARI MINGGU nol resep pada
 * seluruh 90 hari terakhir. Jadi "tidak ada resep" adalah keadaan yang tidak
 * ambigu, bukan baris berisi nol yang bisa tertukar dengan hari yang gagal
 * dibaca.
 */
export async function rekapResepHarian(tanggal: string): Promise<{
  header: BarisRekapResepHeader[];
  item: BarisRekapResepItem[];
  racikan: BarisRekapResepRacikan[];
  nilai: BarisRekapResepNilai[];
}> {
  const rep = rentangResepHarian(tanggal);
  const [header, item, racikan, nilai] = await Promise.all([
    sikSelect<BarisRekapResepHeader>(buildRekapResepHeaderSql(), rep),
    sikSelect<BarisRekapResepItem>(buildRekapResepItemSql(), rep),
    sikSelect<BarisRekapResepRacikan>(buildRekapResepRacikanSql(), rep),
    sikSelect<BarisRekapResepNilai>(buildRekapResepNilaiSql(), rep),
  ]);
  return { header, item, racikan, nilai };
}

/**
 * TANPA izin pindai penuh, dan itu tidak akan berubah saat tabelnya membesar:
 * `no_resep` adalah PRIMARY KEY `resep_obat` dan `resep_dokter_racikan`, serta
 * indeks pada `resep_dokter`, jadi rentang satu hari selalu jatuh sebagai
 * `range`. Terukur `range PRIMARY` + `eq_ref PRIMARY` (dokter) pada header,
 * ditambah `ref no_resep` pada item, dan `range PRIMARY` + `Using index` pada
 * racikan.
 *
 * `Using temporary; Using filesort` pada ketiganya berasal dari `GROUP BY` atas
 * hasil rentang yang sudah kecil (puluhan baris), bukan dari pemindaian tabel.
 *
 * Query NILAI ikut tanpa izin pindai penuh, dan itu bukan keberuntungan:
 * `(tgl_perawatan, jam, no_rawat)` adalah tiga kolom TERDEPAN PRIMARY KEY
 * `detail_pemberian_obat`, jadi join-nya jatuh sebagai `ref PRIMARY` (key_len 25)
 * dengan `ro` sebagai penggerak lewat `range PRIMARY`. Terukur 31 ms pada hari
 * tersibuk. Kalau suatu saat pemeriksaan ini berbunyi, yang PERTAMA ditinjau
 * adalah apakah urutan kondisi ON-nya masih mengikuti urutan PRIMARY KEY itu --
 * bukan menaikkan `maxRows`.
 */
const rekapContoh = rentangResepHarian('2026-08-10');

registerPlanCheck({ name: 'FARMASI_RESEP_REKAP_HEADER', sql: buildRekapResepHeaderSql(), replacements: rekapContoh, maxRows: 5000 });
registerPlanCheck({ name: 'FARMASI_RESEP_REKAP_ITEM', sql: buildRekapResepItemSql(), replacements: rekapContoh, maxRows: 5000 });
registerPlanCheck({ name: 'FARMASI_RESEP_REKAP_RACIKAN', sql: buildRekapResepRacikanSql(), replacements: rekapContoh, maxRows: 5000 });
registerPlanCheck({ name: 'FARMASI_RESEP_REKAP_NILAI', sql: buildRekapResepNilaiSql(), replacements: rekapContoh, maxRows: 5000 });
