import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { bulanSesudah } from '@/core/rekapBulan';

/**
 * REKAP BULANAN ADMINISTRASI -- agregat satu bulan penuh atas KUNJUNGAN pasien:
 * berapa yang datang, cara bayarnya, berapa yang batal, dan seberapa lengkap
 * berkasnya terisi.
 *
 * ==========================================================================
 * Beda jenis dari rekap bulanan FARMASI (046), dan bedanya menentukan pagarnya
 * ==========================================================================
 *
 * Rekap farmasi berangkat dari `resep_obat` dan menyebut `reg_periksa` TEPAT
 * SEKALI, lewat satu `COUNT(DISTINCT no_rkm_medis)` yang berdiri sendiri justru
 * supaya tetap begitu. Yang ini berangkat DARI `reg_periksa` -- tabel yang memuat
 * `no_rkm_medis`, `kd_poli`, `p_jawab`, dan `almt_pj` sekaligus. Jadi pagar
 * "tabelnya memang tidak disebut" tidak tersedia di sini sama sekali, dan yang
 * menggantikannya harus berupa bentuk kode yang tidak bisa ditumpangi:
 *
 *  1. **Tidak satu pun kolom identitas masuk daftar SELECT.** `no_rkm_medis`
 *     hanya pernah muncul sebagai argumen `COUNT(DISTINCT ...)` dan sebagai
 *     `GROUP BY` di dalam tabel turunan yang hasilnya langsung di-`COUNT` lagi.
 *     `nm_pasien` tidak ada karena `pasien` tidak pernah di-JOIN.
 *  2. **Kelengkapan berkas dibaca lewat `EXISTS`, bukan JOIN.** Bentuk itu
 *     menghasilkan BOOLEAN, jadi query ini mengetahui bahwa SOAPIE sudah diisi
 *     TANPA pernah mengetahui apa isinya -- prinsip yang sama dengan
 *     `TRIM(p.td) <> ''` pada `khanza/penilaianAwal.ts`. Tabel yang disentuhnya
 *     memuat rekam medis telanjang: `pemeriksaan_ralan.keluhan` /`pemeriksaan`
 *     /`penilaian`/`evaluasi`, `diagnosa_pasien.kd_penyakit`,
 *     `resume_pasien.diagnosa_utama`. Tidak satu pun bisa ikut keluar, karena
 *     `EXISTS` memang tidak punya tempat untuk membawanya.
 *  3. **`kd_poli` tidak dibaca sama sekali.** Rekap ini tidak memecah per poli,
 *     dan begitu ia mulai memecah, satu baris "Poliklinik Kulit & Kelamin: 3"
 *     pada bulan sepi adalah keterangan tentang tiga orang tertentu.
 *
 * Satu-satunya NAMA yang ikut keluar adalah `penjab.png_jawab` -- nama penjamin,
 * sebuah instansi, dan selalu sebagai label pada baris agregat. Ia tetap wajib
 * lewat `sanitizeValue()` di sisi perakit; lihat `core/administrasiBulanan.ts`.
 *
 * ==========================================================================
 * Pemangkasnya prefiks `no_rawat`, dan ia EKSAK
 * ==========================================================================
 *
 * `YYYY/MM/DD/NNNNNN` (garis miring, bukan tanda hubung), dan ia PRIMARY KEY
 * `reg_periksa`. Diukur atas SELURUH 12.392 baris di database produksi: cocok
 * dengan `tgl_registrasi` pada 12.392, menyimpang pada NOL -- pengukuran yang
 * sama sudah dipakai migrations/044. Sekelas `nota_jual` (040), bukan sekelas
 * `no_faktur` pengadaan yang butuh margin 31 hari. Tidak ada margin yang perlu
 * ditambahkan.
 *
 * Batas atasnya EKSKLUSIF ke prefiks bulan berikutnya, bukan deretan sembilan --
 * alasan lengkapnya di `rentangBulan()` (`khanza/farmasiBulanan.ts`).
 */

/** Rentang prefiks `no_rawat` untuk satu bulan penuh. */
export function rentangBulanRawat(ym: string): { awal: string; akhir: string } {
  const potong = (v: string) => `${v.slice(0, 4)}/${v.slice(4, 6)}/`;
  return { awal: potong(ym), akhir: potong(bulanSesudah(ym)) };
}

/** Rentang TANGGAL (bukan prefiks) untuk tabel yang tidak punya `no_rawat`. */
export function rentangBulanTanggal(ym: string): { awalTgl: string; akhirTgl: string } {
  const iso = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-01`;
  return { awalTgl: iso(ym), akhirTgl: iso(bulanSesudah(ym)) };
}

/* ==========================================================================
 * TABEL TINDAKAN -- satu daftar, dipakai DUA bentuk query
 * ==========================================================================
 *
 * Khanza memecah tindakan menurut siapa yang mengerjakannya (dokter, paramedis,
 * keduanya) DIKALI jalur perawatannya (jalan, inap), sehingga satu pertanyaan
 * sederhana -- "tindakan apa saja yang dikerjakan bulan ini" -- harus dibaca dari
 * ENAM tabel berbentuk sama.
 *
 * Keenamnya dipakai walau lima di antaranya kosong hari ini (terukur:
 * `rawat_jl_dr` 12.215, `rawat_jl_drpr` 3, empat sisanya NOL). Alasannya sama
 * yang membuat `buildAdmKunjunganSql()` tidak menyaring `status_lanjut='Ralan'`:
 * rekap ini menghitung SELURUH kunjungan, jadi membaca tindakannya dari jalur
 * rawat jalan saja akan membuat pembilang dan pembaginya berbeda pada hari RS
 * mulai melayani rawat inap -- tanpa satu pun galat, dan dengan angka yang tetap
 * terlihat masuk akal.
 *
 * Daftarnya SATU, dan itu bukan kerapian: ia dipakai membangun UNION pada rincian
 * per tindakan DAN rantai `EXISTS` pada penghitung "kunjungan yang punya
 * tindakan". Dua daftar berarti dua kesempatan menambahkan tabel ke salah satunya
 * saja, dan yang muncul saat menyimpang bukan galat melainkan dua angka dari satu
 * sistem yang berhenti berjumlah.
 *
 * Keenam PK berawalan `no_rawat` (terukur), jadi prefiks bulanannya memangkas
 * lewat indeks pada keenamnya -- `range` pada yang berisi, `index` + `Using index`
 * pada yang kosong. TANPA izin pindai penuh, dan itu tidak akan berubah saat
 * tabelnya terisi: yang kosong beralih ke `range` justru karena pemangkasnya PK.
 */
const TABEL_TINDAKAN = [
  'rawat_jl_dr',
  'rawat_jl_pr',
  'rawat_jl_drpr',
  'rawat_inap_dr',
  'rawat_inap_pr',
  'rawat_inap_drpr',
] as const;

/** `EXISTS(...) OR EXISTS(...)` untuk keenam tabel, terhadap alias `r`. */
function adaTindakanSql(): string {
  return TABEL_TINDAKAN.map(
    (t, i) => `EXISTS(SELECT 1 FROM ${t} tk${i} WHERE tk${i}.no_rawat = r.no_rawat)`,
  ).join('\n           OR ');
}

/* ==========================================================================
 * KUNJUNGAN + KELENGKAPAN BERKAS -- satu query
 * ========================================================================== */

export interface BarisAdmKunjungan {
  jml_kunjungan: number | string;
  jml_pasien: number | string;
  jml_batal: number | string | null;
  jml_baru: number | string | null;
  jml_belum_bayar: number | string | null;
  ada_resep: number | string | null;
  ada_diagnosa: number | string | null;
  ada_soapie: number | string | null;
  ada_resume: number | string | null;
  ada_tindakan: number | string | null;
  baru_tanpa_asesmen: number | string | null;
}

/**
 * Sepuluh penghitung dalam SATU query, dan itu kebalikan dari keputusan
 * `rekapFarmasiBulanan()` yang justru memecah sepuluh agregat jadi sepuluh query.
 *
 * Bedanya PENGGERAK: di sana kesepuluhnya berangkat dari tabel yang berbeda-beda
 * (`resep_obat`, `pembelian`, `penjualan`, ...), jadi menyatukannya berarti
 * menjoinkan tabel yang tidak punya hubungan satu sama lain. Di sini kesepuluhnya
 * berangkat dari baris `reg_periksa` yang SAMA PERSIS -- yang berbeda cuma
 * kondisi di dalam `SUM(...)`. Memecahnya berarti membaca rentang yang sama
 * sepuluh kali untuk hasil yang identik.
 *
 * --------------------------------------------------------------------------
 * `EXISTS`, bukan `LEFT JOIN` -- dan ini bukan pilihan gaya
 * --------------------------------------------------------------------------
 *
 * `pemeriksaan_ralan` dan `diagnosa_pasien` PK-nya majemuk dengan `no_rawat` di
 * depan, jadi satu kunjungan punya BANYAK baris di keduanya. `LEFT JOIN` akan
 * menggandakan baris penggeraknya, sehingga `COUNT(*)` melaporkan jumlah
 * kunjungan yang jauh lebih besar daripada yang sebenarnya -- tanpa satu pun
 * galat, dan dengan angka yang tetap terlihat masuk akal. Bentuk kegagalan yang
 * sama persis sudah dibayar di `gabungRekap()` (migrations/041), tempat `ongkir`
 * terhitung sekali per BARANG alih-alih sekali per nota.
 *
 * `EXISTS` menghentikan pembacaan pada baris pertama yang cocok, jadi ia sekaligus
 * lebih murah. Terukur `ref`/`eq_ref` + `Using index` untuk kelimanya, dan seluruh
 * query 62 ms atas rentang 668 kunjungan.
 *
 * --------------------------------------------------------------------------
 * `status_bayar`, bukan ketiadaan `nota_jalan` -- dan keduanya DIUKUR
 * --------------------------------------------------------------------------
 *
 * "Belum closing billing" dan "belum bayar" adalah dua nama untuk satu tindakan
 * kasir, dan datanya membenarkan itu: atas SELURUH 12.392 baris, 102 kunjungan
 * ber-`status_bayar='Belum Bayar'` DAN tanpa baris `nota_jalan`, sementara yang
 * menyimpang hanya SATU (punya nota tapi statusnya tertinggal 'Belum Bayar').
 *
 * Yang dipakai `status_bayar` karena ia kolom pada tabel penggeraknya sendiri --
 * nol join, terindeks, dan namanya menyebut isinya. Menghitungnya lewat
 * `NOT EXISTS (SELECT 1 FROM nota_jalan ...)` menambah satu subquery untuk
 * jawaban yang berbeda 0,008%.
 *
 * --------------------------------------------------------------------------
 * `status_poli`, bukan `stts_daftar`
 * --------------------------------------------------------------------------
 *
 * Keduanya ada dan artinya BERBEDA: `stts_daftar` menjawab "pasien ini baru
 * pertama kali terdaftar di RS", `status_poli` menjawab "baru pertama kali ke
 * POLI ini". Terukur keduanya menyimpang pada 85 dari 12.392 baris.
 *
 * Yang dipakai `status_poli`, dan alasannya bukan preferensi melainkan
 * KONSISTENSI dengan kewajiban yang sedang diukur: aturan "pasien baru wajib
 * punya asesmen awal keperawatan" ditegakkan migrations/044 terhadap
 * `status_poli`, jadi memakai `stts_daftar` di sini akan menghasilkan pembagi
 * yang berbeda dari pembilangnya -- "97 dari 188 pasien baru belum diasesmen"
 * sementara halaman /erm/penilaian-umum pada hari yang sama menyebut 191.
 * Dua angka berbeda untuk satu pertanyaan, tanpa satu pun galat.
 *
 * `status_lanjut = 'Ralan'` TIDAK disaring di sini, berbeda dari
 * `khanza/penilaianAwal.ts` yang mewajibkannya. Di sana penyaring itu perlu
 * karena tabel asesmennya memang `_ralan`; di sini yang dihitung SELURUH
 * kunjungan, dan membuang rawat inap dari "jumlah total pasien perbulan" akan
 * membuat angkanya berhenti menjadi total pada hari RS mulai melayani ranap.
 * Cabang asesmennya sendiri tetap aman: `NOT EXISTS` terhadap tabel `_ralan`
 * akan menjaring pasien ranap sebagai "belum diasesmen", dan itu memang keadaan
 * yang harus terlihat -- lihat catatannya di `core/administrasiBulanan.ts`.
 *
 * --------------------------------------------------------------------------
 * `ada_tindakan` tinggal DI SINI, bukan jadi query ketujuh
 * --------------------------------------------------------------------------
 *
 * Ia penghitung per-KUNJUNGAN ("berapa kunjungan yang punya setidaknya satu
 * tindakan"), jadi ia berangkat dari baris `reg_periksa` yang sama persis dengan
 * kesembilan penghitung di atasnya -- aturan yang sudah ditulis di kepala fungsi
 * ini. Query tersendiri berarti membaca rentang yang sama sekali lagi untuk
 * jawaban yang tidak bisa diturunkan dari rincian per tindakan: satu kunjungan
 * bisa punya beberapa jenis tindakan, sehingga menjumlahkan kunjungan per jenis
 * menghitungnya berkali-kali.
 *
 * Rantai `EXISTS`-nya dirakit dari `TABEL_TINDAKAN` yang SAMA dipakai UNION di
 * bawah, bukan diketik ulang.
 *
 * Terukur, dan angkanya kelas yang sama dengan SOAPIE: kunjungan yang punya
 * tindakan bergerak 60,9% (Januari 2026) -> 70,4% (Juli 2026).
 */
function buildAdmKunjunganSql(): string {
  return `
    SELECT
      COUNT(*)                                AS jml_kunjungan,
      COUNT(DISTINCT r.no_rkm_medis)          AS jml_pasien,
      SUM(r.stts = 'Batal')                   AS jml_batal,
      SUM(r.status_poli = 'Baru')             AS jml_baru,
      SUM(r.status_bayar = 'Belum Bayar')     AS jml_belum_bayar,
      SUM(EXISTS(SELECT 1 FROM resep_obat ro
                  WHERE ro.no_rawat = r.no_rawat))                AS ada_resep,
      SUM(EXISTS(SELECT 1 FROM diagnosa_pasien dp
                  WHERE dp.no_rawat = r.no_rawat))                AS ada_diagnosa,
      SUM(EXISTS(SELECT 1 FROM pemeriksaan_ralan pr
                  WHERE pr.no_rawat = r.no_rawat))                AS ada_soapie,
      SUM(EXISTS(SELECT 1 FROM resume_pasien rs
                  WHERE rs.no_rawat = r.no_rawat))                AS ada_resume,
      SUM(${adaTindakanSql()})                                    AS ada_tindakan,
      SUM(r.status_poli = 'Baru'
          AND NOT EXISTS(SELECT 1 FROM penilaian_awal_keperawatan_ralan p
                          WHERE p.no_rawat = r.no_rawat))         AS baru_tanpa_asesmen
    FROM reg_periksa r
    WHERE r.no_rawat >= :awal AND r.no_rawat < :akhir
  `;
}

/* ==========================================================================
 * CARA BAYAR
 * ========================================================================== */

export interface BarisAdmCaraBayar {
  kd_pj: string;
  png_jawab: string | null;
  jml_kunjungan: number | string;
  jml_pasien: number | string;
}

/**
 * Pecahan per penjamin, DINAMIS lewat `GROUP BY` -- bukan kolom tetap.
 *
 * Terukur, rumah sakit ini cuma memakai dua (`A01` UMUM 473, `A02` BPJS
 * Kesehatan 195 pada Juli 2026), sementara katalog `penjab` memuat lebih banyak
 * termasuk "DINAS SOSIAL" dan "JASA RAHARJA". Kolom tetap untuk umum dan BPJS
 * akan menelan sisanya diam-diam: bulan pertama ada pasien Jasa Raharja, angkanya
 * hilang dari rekap dan totalnya berhenti berjumlah.
 *
 * `LEFT JOIN`, bukan INNER: `kd_pj` yang tidak ada lagi di master (penjamin yang
 * dihapus sesudah kunjungannya tercatat) tetap harus muncul sebagai barisnya
 * sendiri. INNER akan membuangnya, sehingga jumlah pecahannya lebih kecil
 * daripada `{jumlah_kunjungan}` tanpa satu pun keterangan kenapa.
 *
 * `penjab.status` sengaja TIDAK disaring, dan itu KEBALIKAN dari pelajaran jadwal
 * dokter (`p.status='1'` wajib di sana). Pertanyaannya berbeda: di sana "layanan
 * apa yang MASIH dilayani", di sini "siapa penjamin kunjungan yang SUDAH
 * terjadi". Asuransi yang dinonaktifkan bulan lalu tetap penjamin kunjungan bulan
 * lalu; menyaringnya mengganti fakta yang benar dengan kekosongan. Aturan yang
 * sama sudah ditulis untuk `{cara_bayar}` pada pemicu pasien.
 */
function buildAdmCaraBayarSql(): string {
  return `
    SELECT
      r.kd_pj                        AS kd_pj,
      pj.png_jawab                   AS png_jawab,
      COUNT(*)                       AS jml_kunjungan,
      COUNT(DISTINCT r.no_rkm_medis) AS jml_pasien
    FROM reg_periksa r
    LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
    WHERE r.no_rawat >= :awal AND r.no_rawat < :akhir
    GROUP BY r.kd_pj, pj.png_jawab
    ORDER BY jml_kunjungan DESC
  `;
}

/* ==========================================================================
 * TINDAKAN
 * ========================================================================== */

export interface BarisAdmTindakan {
  kd_jenis_prw: string;
  nm_perawatan: string | null;
  jml: number | string;
}

/**
 * Berapa kali tiap jenis tindakan dikerjakan bulan itu.
 *
 * DINAMIS lewat `GROUP BY`, bukan kolom tetap -- alasan yang sama persis dengan
 * pecahan cara bayar: katalog `jns_perawatan` berisi 1.312 baris sementara yang
 * benar-benar dikerjakan 14-20 jenis sebulan, dan kolom tetap akan menelan jenis
 * ke-21 diam-diam pada bulan pertama poliklinik memakainya.
 *
 * --------------------------------------------------------------------------
 * Yang KELUAR cuma kode, nama, dan bilangan
 * --------------------------------------------------------------------------
 *
 * `no_rawat` disebut DI DALAM tabel turunan -- ia yang menyatukan keenam sumber --
 * tapi tidak pernah menjadi kolom hasil, sama seperti `no_rkm_medis` di
 * `buildAdmBerulangSql()`. Yang menyeberang ke Node cuma `kd_jenis_prw`,
 * `nm_perawatan`, dan sebuah `COUNT`. `kd_dokter`/`nip` tidak diambil sama sekali:
 * memecah tindakan per petugas mengubah rekap kunjungan menjadi laporan kinerja
 * per orang, dan itu keputusan tersendiri yang tidak pernah diminta.
 *
 * --------------------------------------------------------------------------
 * `LEFT JOIN`, dan `jns_perawatan.status` TIDAK disaring
 * --------------------------------------------------------------------------
 *
 * Keduanya mengikuti `buildAdmCaraBayarSql()` lewat alasan yang sama. `LEFT JOIN`
 * menjaga tindakan yang kodenya sudah tidak ada lagi di katalog tetap muncul
 * sebagai barisnya sendiri -- INNER akan membuangnya, sehingga jumlah pecahannya
 * lebih kecil daripada totalnya tanpa satu pun keterangan. Terukur nol kode yatim
 * hari ini, dan justru itu yang membuat penjagaannya murah.
 *
 * `status` sengaja dibiarkan: tindakan yang dinonaktifkan bulan lalu tetap
 * tindakan yang dikerjakan bulan lalu. Menyaringnya mengganti fakta yang benar
 * dengan kekosongan -- KEBALIKAN dari pelajaran `p.status='1'` pada jadwal dokter,
 * yang menjawab "layanan apa yang MASIH dilayani".
 *
 * --------------------------------------------------------------------------
 * PENGECUALIAN TIDAK dikerjakan di sini
 * --------------------------------------------------------------------------
 *
 * Daftar tindakan yang dikecualikan staf (`administrasi.bulanan_tindakan_kecuali`)
 * disaring di `core/administrasiBulanan.ts`, bukan di WHERE. Dua sebab, dan
 * keduanya mengikat: yang dikecualikan tetap harus ikut TERHITUNG di total
 * (kalau tidak, pecahannya berhenti berjumlah -- lihat `gabungAdmBulanan()`), dan
 * modul `khanza/` tidak boleh membaca `app_setting` sama sekali. Pola yang sama
 * dengan `farmasi.stok_pakai_batch` dan `administrasi.sertakan_diagnosa`.
 */
function buildAdmTindakanSql(): string {
  const union = TABEL_TINDAKAN.map(
    (t) => `SELECT no_rawat, kd_jenis_prw FROM ${t}\n        WHERE no_rawat >= :awal AND no_rawat < :akhir`,
  ).join('\n      UNION ALL\n      ');

  return `
    SELECT
      x.kd_jenis_prw  AS kd_jenis_prw,
      j.nm_perawatan  AS nm_perawatan,
      COUNT(*)        AS jml
    FROM (
      ${union}
    ) x
    LEFT JOIN jns_perawatan j ON j.kd_jenis_prw = x.kd_jenis_prw
    GROUP BY x.kd_jenis_prw, j.nm_perawatan
    ORDER BY jml DESC, x.kd_jenis_prw ASC
  `;
}

/**
 * Daftar tindakan yang BENAR-BENAR dikerjakan dalam sebuah rentang bulan --
 * bahan pilihan untuk kotak centang "kecualikan" di dashboard.
 *
 * Query yang SAMA dipakai rekapnya, cuma rentangnya lebih lebar. Dua bentuk SQL
 * untuk satu pertanyaan berarti dua rencana yang harus dijaga terpisah, dan yang
 * paling mungkin memburuk tanpa terlihat adalah yang cuma dipakai satu halaman.
 *
 * Berangkat dari `rawat_jl_dr` dan bukan dari katalog `jns_perawatan`, dan itu
 * keputusan: katalognya 1.312 baris sementara yang dipakai 14-20 sebulan. Daftar
 * 1.312 kotak centang adalah daftar yang tidak dibaca siapa pun, dan yang
 * dicentang di sana akan tersimpan sebagai kode yang tidak pernah muncul.
 *
 * AKIBAT yang harus disadari: tindakan yang belum pernah dikerjakan tidak bisa
 * dikecualikan di muka. Itu diterima -- yang mengganggu adalah yang muncul, dan
 * tindakan baru selalu bisa dicentang pada bulan pertama ia terlihat.
 */
export async function daftarTindakanTerpakai(
  ymAwal: string,
  ymAkhir: string,
): Promise<BarisAdmTindakan[]> {
  return sikSelect<BarisAdmTindakan>(buildAdmTindakanSql(), {
    awal: rentangBulanRawat(ymAwal).awal,
    akhir: rentangBulanRawat(ymAkhir).akhir,
  });
}

/**
 * Nama tindakan untuk sekumpulan kode tertentu.
 *
 * Ada karena satu celah yang gagal DIAM di picker "kecualikan tindakan": daftar
 * pilihannya berangkat dari tindakan yang benar-benar dikerjakan beberapa bulan
 * terakhir, jadi tindakan yang SUDAH dicentang lalu berhenti dikerjakan akan
 * lenyap dari daftar itu -- dan kotak centang yang tidak dirender tidak ikut
 * terkirim saat form disimpan. Yang terlihat staf: pengecualian yang batal
 * sendiri, tanpa satu pun galat, pada bulan pertama tindakan itu tidak muncul.
 *
 * Jalan keluarnya MENAMBAHKAN kode itu ke daftar pilihan berikut namanya, bukan
 * menitipkannya sebagai input tersembunyi. Input tersembunyi memang membuatnya
 * bertahan, tapi sekaligus membuatnya MUSTAHIL dilepas -- pelajaran yang sudah
 * dibayar `pilihanTersembunyi()` di `/broadcast`.
 *
 * `IN` pada PRIMARY KEY, jadi `eq_ref`/`range` tanpa kolom bantu. Hanya dijalankan
 * saat memang ada kode yang tertinggal.
 */
export async function namaTindakanByKode(kodes: string[]): Promise<BarisAdmTindakan[]> {
  if (kodes.length === 0) return [];
  return sikSelect<BarisAdmTindakan>(buildNamaTindakanSql(), { kodes });
}

function buildNamaTindakanSql(): string {
  return `
    SELECT j.kd_jenis_prw AS kd_jenis_prw, j.nm_perawatan AS nm_perawatan, 0 AS jml
    FROM jns_perawatan j
    WHERE j.kd_jenis_prw IN (:kodes)
  `;
}

/* ==========================================================================
 * PASIEN BERULANG
 * ========================================================================== */

export interface BarisAdmBerulang {
  jml_pasien_berulang: number | string;
  jml_kunjungan_berulang: number | string | null;
}

/**
 * Pasien yang datang LEBIH DARI SEKALI dalam bulan itu.
 *
 * Berdiri sendiri dari "pasien lama" (`status_poli`), dan bedanya nyata: pasien
 * lama adalah orang yang pernah ke poli ini SEBELUMNYA -- bisa saja setahun lalu
 * dan cuma datang sekali bulan ini. Yang dihitung di sini orang yang bolak-balik
 * DI DALAM bulan yang direkap. Terukur Juli 2026: 563 pasien, 81 di antaranya
 * datang 2-5 kali, menyumbang 186 dari 668 kunjungan.
 *
 * `jml_kunjungan_berulang` ikut karena angka pasiennya sendiri tidak bisa dinilai:
 * 81 orang bisa berarti 162 kunjungan atau 400, dan itu dua beban kerja yang
 * berbeda. Ia juga yang membuat pembacanya bisa menjumlahkan sendiri -- kunjungan
 * berulang ditambah pasien sekali-datang menghasilkan total kunjungan.
 *
 * `<derived2>` memang `type=ALL` pada EXPLAIN, dan itu bukan pemindaian tabel
 * dasar: `scripts/verify-plans.ts` sudah mengecualikan tabel turunan justru
 * karena isinya hasil yang SUDAH tersaring. Tabel dasarnya `range` pada
 * `idx_reg_periksa_rawat_rkm` berikut `Using index` -- covering, jadi barisnya
 * tidak pernah disentuh.
 */
function buildAdmBerulangSql(): string {
  return `
    SELECT
      COUNT(*)                AS jml_pasien_berulang,
      COALESCE(SUM(t.n), 0)   AS jml_kunjungan_berulang
    FROM (
      SELECT r.no_rkm_medis, COUNT(*) AS n
      FROM reg_periksa r
      WHERE r.no_rawat >= :awal AND r.no_rawat < :akhir
      GROUP BY r.no_rkm_medis
      HAVING n > 1
    ) t
  `;
}

/* ==========================================================================
 * SURAT SAKIT
 * ========================================================================== */

export interface BarisAdmJumlah {
  jml: number | string;
}

/**
 * Surat keterangan sakit yang terbit bulan itu.
 *
 * Dipangkas lewat `no_rawat`, BUKAN lewat prefiks `no_surat` -- dan itu koreksi
 * yang penting. `no_surat` memang PRIMARY KEY dan berbentuk `SKS`+`YYYYMMDD`,
 * jadi ia terlihat seperti pemangkas yang lebih tepat. Tapi migrations/027 sudah
 * mengukur bahwa tanggal di dalamnya diambil dari kotak **Tanggal Awal** (mulai
 * istirahat) saat nomornya dibuatkan, bukan dari hari suratnya disimpan: surat
 * yang ditulis hari ini untuk istirahat pekan depan bernomor bulan DEPAN.
 *
 * `no_rawat` menjawab pertanyaan yang benar-benar diajukan rekap ini -- berapa
 * surat yang terbit atas kunjungan bulan itu -- dan sekaligus membuat seluruh
 * rekap berdiri di atas SATU definisi periode. Terindeks (`no_rawat`), jadi
 * `range` tanpa kolom bantu.
 *
 * Yang WAJIB diketahui: menunya praktis sudah ditinggalkan di RS ini. Terukur 17
 * surat seluruhnya, Agustus 2024 - Februari 2025, lalu berhenti. Angkanya akan 0
 * setiap bulan sampai poliklinik memakainya lagi.
 */
function buildAdmSuratSakitSql(): string {
  return `
    SELECT COUNT(*) AS jml
    FROM suratsakit ss
    WHERE ss.no_rawat >= :awal AND ss.no_rawat < :akhir
  `;
}

/* ==========================================================================
 * SURAT KONTROL -- dua sumber, dan KEDUANYA praktis kosong
 * ==========================================================================
 *
 * Khanza punya dua menu surat kontrol yang menulis ke tabel berbeda, dan
 * pemisahan itu sudah didokumentasikan migrations/032:
 *
 *   menu "Surat Kontrol"          -> `skdp_bpjs`                   (non-VClaim)
 *   menu "Surat Kontrol VClaim"   -> `bridging_surat_kontrol_bpjs` (BPJS)
 *
 * Keduanya dibaca dan DIJUMLAHKAN jadi satu angka. Memisahkannya jadi dua
 * variabel akan menghasilkan dua baris yang keduanya berbunyi 0 setiap bulan,
 * dan baris yang selamanya nol mengajari pembacanya melewati bagian itu.
 *
 * Yang dihitung SURAT, bukan pasien -- dan nama variabelnya menyebut itu.
 * `skdp_bpjs` punya `no_rkm_medis` sehingga pasien berbedanya bisa dihitung,
 * `bridging_surat_kontrol_bpjs` tidak (ia menuju pasien lewat `bridging_sep`,
 * tabel yang menyimpan `diagawal`/`nmdiagnosaawal`). Menjumlahkan "pasien
 * berbeda" dari satu sumber dengan "surat" dari sumber lain menghasilkan angka
 * yang tidak berarti apa-apa, dan menamainya "pasien" akan berbohong -- kesalahan
 * yang sama yang membuat `{tanggal_kunjungan}` sengaja tidak dinamai
 * `{tanggal_kunjungan_terakhir}`.
 *
 * PEMINDAIAN PENUH yang disengaja, pada keduanya. Tidak ada indeks pada kolom
 * tanggalnya, dan PK keduanya tidak bisa dipakai sebagai pemangkas rentang:
 * `skdp_bpjs` ber-PK `(tahun, no_antrian)` yang diturunkan dari `tanggal_datang`
 * (tanggal KONTROL) sementara yang dicari `tanggal_rujukan` (tanggal SURAT) --
 * terukur merentang -57 sampai +309 hari di migrations/033; `no_surat`
 * bridging memuat tanggal sebagai `MMYY` di TENGAH string sehingga tidak terurut
 * leksikal antar tahun. Yang membuatnya bisa diterima: rekap ini jalan SEKALI
 * SEBULAN, dan terukur 46 ms untuk keduanya sekaligus terhadap arsip berisi 253 +
 * 18.306 baris. Alasan yang sama sudah dipakai migrations/024 dan 033.
 *
 * Kolom klinis TIDAK satu pun dibaca. `skdp_bpjs` menyimpan `diagnosa`, `terapi`,
 * `alasan1/2`, `rtl1/2`; `bridging_surat_kontrol_bpjs` menyimpan `status_prb`
 * (diagnosis kronis apa adanya), HBA1C, GDP, eGFR, LDL, tekanan darah. Yang
 * meninggalkan SQL cuma satu bilangan.
 */
function buildAdmKontrolSkdpSql(): string {
  return `
    SELECT COUNT(*) AS jml
    FROM skdp_bpjs s
    WHERE s.tanggal_rujukan >= :awalTgl AND s.tanggal_rujukan < :akhirTgl
  `;
}

function buildAdmKontrolBridgingSql(): string {
  return `
    SELECT COUNT(*) AS jml
    FROM bridging_surat_kontrol_bpjs b
    WHERE b.tgl_surat >= :awalTgl AND b.tgl_surat < :akhirTgl
  `;
}

/* ==========================================================================
 * PEMBACAAN
 * ========================================================================== */

export interface AgregatAdmBulanan {
  kunjungan: BarisAdmKunjungan | null;
  caraBayar: BarisAdmCaraBayar[];
  tindakan: BarisAdmTindakan[];
  berulang: BarisAdmBerulang | null;
  suratSakit: BarisAdmJumlah | null;
  kontrolSkdp: BarisAdmJumlah | null;
  kontrolBridging: BarisAdmJumlah | null;
}

/**
 * Tujuh agregat untuk satu bulan penuh.
 *
 * Dijalankan BERBARENGAN walau kolam `sik` sengaja dibatasi `pool.max: 2`:
 * mysql2 mengantrekan sisanya, dan fungsi ini jalan SEKALI SEBULAN. Alasan yang
 * sama sudah dipakai `rekapFarmasiBulanan()`.
 *
 * Kelima agregat berbaris-tunggal memakai `?? null`, dan `core/` sudah
 * memperlakukan null sebagai nol. `caraBayar` dan `tindakan` justru sebaliknya --
 * keduanya memang banyak baris, dan larik kosong berarti bulan tanpa kunjungan
 * (atau, untuk tindakan, bulan yang tak satu pun tindakannya tercatat).
 */
export async function rekapAdministrasiBulanan(ym: string): Promise<AgregatAdmBulanan> {
  const rawat = rentangBulanRawat(ym);
  const tgl = rentangBulanTanggal(ym);

  const [kunjungan, caraBayar, tindakan, berulang, suratSakit, kontrolSkdp, kontrolBridging] =
    await Promise.all([
      sikSelect<BarisAdmKunjungan>(buildAdmKunjunganSql(), rawat),
      sikSelect<BarisAdmCaraBayar>(buildAdmCaraBayarSql(), rawat),
      sikSelect<BarisAdmTindakan>(buildAdmTindakanSql(), rawat),
      sikSelect<BarisAdmBerulang>(buildAdmBerulangSql(), rawat),
      sikSelect<BarisAdmJumlah>(buildAdmSuratSakitSql(), rawat),
      sikSelect<BarisAdmJumlah>(buildAdmKontrolSkdpSql(), tgl),
      sikSelect<BarisAdmJumlah>(buildAdmKontrolBridgingSql(), tgl),
    ]);

  return {
    kunjungan: kunjungan[0] ?? null,
    caraBayar,
    tindakan,
    berulang: berulang[0] ?? null,
    suratSakit: suratSakit[0] ?? null,
    kontrolSkdp: kontrolSkdp[0] ?? null,
    kontrolBridging: kontrolBridging[0] ?? null,
  };
}

/**
 * Rencana query -- keempat yang berangkat dari `reg_periksa` TANPA izin pindai
 * penuh, dan itu bukan keberuntungan: penyaringnya ditulis pada PRIMARY KEY.
 * Terukur pada rentang Juli 2026, bulan penuh terakhir dan yang tersibuk:
 *
 *   kunjungan    range PRIMARY 668  + kelima EXISTS ref/eq_ref (Using index)
 *   cara bayar   range          668  + penjab eq_ref PRIMARY
 *   berulang     range          668  (Using index -- covering)
 *   surat sakit  range no_rawat
 *
 * Kedua query surat kontrol MEMANG dipindai penuh, dan izinnya ditulis eksplisit
 * per alias berikut alasannya di seksi masing-masing. `maxRows`-nya tetap
 * ditegakkan justru di sana: pada tabel yang boleh dipindai penuh itulah asumsi
 * "tabel ini tidak besar" perlu gagal berisik saat ternyata keliru.
 *
 * Bulan contohnya sengaja bulan yang BERISI. Bulan kosong membuat MariaDB memilih
 * rencana yang berbeda pada tabel yang hampir kosong (pelajaran `sks` dan
 * `permintaan_lab`), sehingga pemeriksaannya akan menjaga bentuk yang tidak
 * pernah dipakai produksi.
 */
const contohRawat = rentangBulanRawat('202607');
const contohTgl = rentangBulanTanggal('202607');

/** Sebulan, bukan sehari -- lihat catatan `MAKS_BARIS_BULAN` di farmasiBulanan.ts. */
const MAKS_BARIS_BULAN = 50_000;

registerPlanCheck({
  name: 'ADM_BULANAN_KUNJUNGAN',
  sql: buildAdmKunjunganSql(),
  replacements: contohRawat,
  maxRows: MAKS_BARIS_BULAN,
});
registerPlanCheck({
  name: 'ADM_BULANAN_CARA_BAYAR',
  sql: buildAdmCaraBayarSql(),
  replacements: contohRawat,
  maxRows: MAKS_BARIS_BULAN,
});
/**
 * Rincian per tindakan. TANPA izin pindai penuh untuk keenam tabelnya, dan itu
 * terukur bukan diharapkan: `rawat_jl_dr` `range no_rawat` + `Using index`
 * (covering), kelima yang kosong `type=index` + `Using index` -- bukan `ALL`.
 *
 * `<derived3>` memang `type=ALL`, dan `scripts/verify-plans.ts` sudah
 * mengecualikan tabel turunan: isinya hasil yang SUDAH tersaring, bukan tabel
 * dasar. Alasan yang sama sudah dipakai `ADM_BULANAN_BERULANG`.
 */
registerPlanCheck({
  name: 'ADM_BULANAN_TINDAKAN',
  sql: buildAdmTindakanSql(),
  replacements: contohRawat,
  maxRows: MAKS_BARIS_BULAN,
});
registerPlanCheck({
  name: 'ADM_BULANAN_NAMA_TINDAKAN',
  sql: buildNamaTindakanSql(),
  replacements: { kodes: ['RJ00000', 'RJ00001'] },
  maxRows: MAKS_BARIS_BULAN,
});
registerPlanCheck({
  name: 'ADM_BULANAN_BERULANG',
  sql: buildAdmBerulangSql(),
  replacements: contohRawat,
  maxRows: MAKS_BARIS_BULAN,
});
registerPlanCheck({
  name: 'ADM_BULANAN_SURAT_SAKIT',
  sql: buildAdmSuratSakitSql(),
  replacements: contohRawat,
  maxRows: MAKS_BARIS_BULAN,
});
registerPlanCheck({
  name: 'ADM_BULANAN_KONTROL_SKDP',
  sql: buildAdmKontrolSkdpSql(),
  replacements: contohTgl,
  allowFullScan: ['s'],
  maxRows: MAKS_BARIS_BULAN,
});
registerPlanCheck({
  name: 'ADM_BULANAN_KONTROL_BRIDGING',
  sql: buildAdmKontrolBridgingSql(),
  replacements: contohTgl,
  allowFullScan: ['b'],
  maxRows: MAKS_BARIS_BULAN,
});
