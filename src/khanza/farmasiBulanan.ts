import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { bulanSesudah } from '@/core/rekapBulan';

/**
 * REKAP BULANAN FARMASI -- agregat satu bulan penuh atas SELURUH kegiatan
 * farmasi: resep, telaah, dan keempat jalur barang.
 *
 * ==========================================================================
 * PRIVASI -- lebih longgar SATU LANGKAH dari rekap harian, dan itu disengaja
 * ==========================================================================
 *
 * `khanza/farmasiStaf.ts` menulis dengan tegas bahwa `reg_periksa` dan `pasien`
 * TIDAK di-JOIN sama sekali pada rekap harian resep -- bukan "di-JOIN lalu
 * kolomnya tidak dipilih", melainkan tabelnya memang tidak disebut.
 *
 * Berkas ini MENYEBUT `reg_periksa`, tepat satu kali, di `buildPasienSql()`.
 * Sebabnya tidak bisa dihindari: yang diminta adalah "jumlah PASIEN yang
 * diresepkan", dan `resep_obat` hanya memuat `no_rawat` -- satu KUNJUNGAN.
 * Terukur, keduanya jauh berbeda: Juli 2026 punya 634 kunjungan dari 541 pasien,
 * selisih 15%. Menyajikan kunjungan dengan label "pasien" adalah berbohong 15%
 * setiap bulan, tanpa satu pun galat.
 *
 * Yang menahan pelebaran itu ada tiga, dan ketiganya ditegakkan bentuk kodenya
 * sendiri, bukan disiplin pembacanya:
 *
 *  1. `COUNT(DISTINCT ...)` -- satu ANGKA yang meninggalkan SQL. `no_rkm_medis`
 *     tidak pernah masuk daftar SELECT sebagai nilai, jadi merender identitas
 *     bukan terlarang melainkan MUSTAHIL (ARCHITECTURE §5.2).
 *  2. Query TERSENDIRI, bukan join tambahan pada agregat utama. Kalau ia digabung,
 *     `reg_periksa` ikut hadir di query yang punya delapan kolom lain -- dan
 *     penyunting berikutnya yang menambahkan satu kolom lagi ke sana tidak punya
 *     satu pun tanda bahwa ia sedang melewati pagar. Berdiri sendiri, ia satu
 *     fungsi berisi satu `COUNT` yang tidak bisa ditumpangi apa pun.
 *  3. `pasien` tetap TIDAK disebut. Nama, alamat, dan nomor telepon tidak punya
 *     jalan menuju berkas ini sama sekali.
 *
 * `telaah_farmasi` tidak menambah satu pun pertanyaan privasi: tabelnya cuma
 * berisi `no_resep`, dua puluh kolom enum Ya/Tidak, dan `nip` petugas. Tidak ada
 * kolom pasien di sana untuk dijaga.
 */

/**
 * Rentang prefiks untuk satu bulan penuh.
 *
 * Bentuknya `>= awal AND < akhir` (batas atas EKSKLUSIF), bukan `<= '...9999'`
 * yang dipakai rentang harian. Bedanya bukan gaya: batas atas berupa deretan
 * sembilan mengandaikan panjang nomor urut yang tetap, dan nomor yang suatu saat
 * melebar satu digit akan diam-diam jatuh di luar rentang. Batas eksklusif ke
 * prefiks bulan BERIKUTNYA tidak punya asumsi itu sama sekali, dan tetap jatuh
 * sebagai `range` karena prefiksnya sama panjang.
 *
 * `awalan` berbeda per tabel, dan SPM memakai tahun DUA digit -- pelajaran
 * migrations/030, tempat menyalin `prefixFaktur()` apa adanya menghasilkan
 * jendela yang kosong selamanya tanpa satu pun galat.
 */
export function rentangBulan(
  ym: string,
  awalan: string,
  tahunDuaDigit = false,
): { awalPrefix: string; akhirPrefix: string } {
  const potong = (v: string) => (tahunDuaDigit ? v.slice(2) : v);
  return {
    awalPrefix: `${awalan}${potong(ym)}`,
    akhirPrefix: `${awalan}${potong(bulanSesudah(ym))}`,
  };
}

/* ==========================================================================
 * RESEP + TELAAH
 * ========================================================================== */

export interface BarisBulananResep {
  jml_resep: number | string;
  jml_kunjungan: number | string;
  belum_validasi: number | string | null;
  belum_serah: number | string | null;
  tanpa_telaah: number | string | null;
}

/**
 * Agregat tingkat RESEP untuk sebulan, berikut ketiga angka "yang tidak".
 *
 * Keempat penghitungnya dijadikan SATU query dan bukan empat, dan itu kebalikan
 * dari keputusan `gabungRekapResep()` yang justru memecah tiga agregat. Bedanya
 * TINGKAT: di sana ketiganya membaca tabel yang berbeda (`resep_obat`,
 * `resep_dokter`, `resep_dokter_racikan`), sehingga menjoinkannya menggandakan
 * baris. Di sini keempatnya membaca baris yang SAMA persis dari `resep_obat` --
 * yang berbeda cuma kondisi di dalam `SUM(CASE ...)`. Memecahnya berarti membaca
 * rentang yang sama empat kali untuk hasil yang identik.
 *
 * --------------------------------------------------------------------------
 * `telaah_farmasi` -- LEFT JOIN, dan arahnya menentukan
 * --------------------------------------------------------------------------
 *
 * PK-nya `no_resep`, sama persis dengan `resep_obat`, jadi join-nya `eq_ref
 * PRIMARY` dan "tidak ada telaah" jatuh sebagai `t.no_resep IS NULL`. Arahnya
 * WAJIB dari `resep_obat` -- yang dicari adalah resep yang TIDAK punya telaah,
 * dan tabel telaah tidak memuat baris untuk sesuatu yang tidak ada di sana.
 * Terukur, arah sebaliknya memang tidak menyimpan apa pun yang terlewat: NOL
 * baris `telaah_farmasi` tanpa `resep_obat` yang bersesuaian.
 *
 * Kedua puluh kolom enum (`resep_tepat_dosis`, `resep_interaksi_obat`, ...)
 * sengaja TIDAK dibaca. Yang diminta adalah berapa resep yang belum DITELAAH,
 * bukan hasil telaahnya -- dan hasil telaah adalah penilaian klinis atas resep
 * seorang pasien, yang jenisnya sama dengan `diagnosa_klinis` pada permintaan lab
 * (migrations/025): merendernya bukan terlarang melainkan mustahil karena
 * kolomnya tidak pernah diambil.
 *
 * --------------------------------------------------------------------------
 * `belum_validasi` diukur NOL, dan tetap dihitung
 * --------------------------------------------------------------------------
 *
 * Terukur atas seluruh 12.466 baris: 12.465 punya `tgl_perawatan` terisi, SATU
 * bernilai nol. Jadi angkanya akan hampir selalu 0 -- dan itu justru alasan ia
 * ada. Bandingkan `{status_resep}`, yang ditolak di migrations/042 karena
 * bernilai 'ralan' pada SELURUH baris: yang itu tidak akan berubah selama RS
 * hanya melayani rawat jalan, jadi ia kolom yang selamanya mengatakan hal yang
 * sama. Yang ini nol karena apoteknya bekerja rapi, dan hari ia berhenti nol
 * adalah persis hari yang paling perlu terlihat.
 */
function buildBulananResepSql(): string {
  return `
    SELECT
      COUNT(*)                                   AS jml_resep,
      COUNT(DISTINCT ro.no_rawat)                AS jml_kunjungan,
      SUM(ro.tgl_perawatan IS NULL
          OR ro.tgl_perawatan = '0000-00-00')    AS belum_validasi,
      SUM(ro.tgl_penyerahan IS NULL
          OR ro.tgl_penyerahan = '0000-00-00')   AS belum_serah,
      SUM(tf.no_resep IS NULL)                   AS tanpa_telaah
    FROM resep_obat ro
    LEFT JOIN telaah_farmasi tf ON tf.no_resep = ro.no_resep
    WHERE ro.no_resep >= :awalPrefix AND ro.no_resep < :akhirPrefix
  `;
}

export interface BarisBulananItem {
  jml_baris: number | string;
  jml_obat: number | string | null;
}

/** Baris obat sebulan. `kode_brng` dan `aturan_pakai` tidak pernah di-SELECT. */
function buildBulananItemSql(): string {
  return `
    SELECT
      COUNT(*)                    AS jml_baris,
      COALESCE(SUM(rd.jml), 0)    AS jml_obat
    FROM resep_dokter rd
    WHERE rd.no_resep >= :awalPrefix AND rd.no_resep < :akhirPrefix
  `;
}

export interface BarisBulananRacikan {
  jml_racikan: number | string;
}

/**
 * Racikan sebulan.
 *
 * Query TERSENDIRI dari baris obat, dengan alasan yang sama yang memecah
 * `buildRekapResepItemSql()` dan `buildRekapResepRacikanSql()`: `resep_dokter`
 * dan `resep_dokter_racikan` sama-sama detail dari `resep_obat`, jadi
 * menjoinkan keduanya sekaligus mengalikan barisnya satu sama lain.
 *
 * `nama_racik` TIDAK di-SELECT -- ia diketik dokter dan racikan biasa dinamai
 * menurut indikasinya, jadi ia bisa menyebut penyakit selugas nama obat.
 */
function buildBulananRacikanSql(): string {
  return `
    SELECT COUNT(*) AS jml_racikan
    FROM resep_dokter_racikan rr
    WHERE rr.no_resep >= :awalPrefix AND rr.no_resep < :akhirPrefix
  `;
}

export interface BarisBulananNilai {
  nilai_obat: number | string | null;
}

/**
 * Rupiah yang SUDAH masuk penagihan atas resep sebulan.
 *
 * Join `(tgl_perawatan, jam, no_rawat)` -- tiga kolom terdepan PRIMARY KEY
 * `detail_pemberian_obat`, jadi `ref PRIMARY`. Alasan lengkap kenapa katalog
 * `databarang` ditolak sebagai sumber harga ada di `buildRekapResepNilaiSql()`;
 * ringkasnya, katalog menyimpan harga HARI INI sementara rekap bulanan selalu
 * membaca bulan yang sudah lewat -- ia akan menyebut angka yang tidak pernah
 * ditagihkan ke siapa pun.
 *
 * INNER JOIN: resep yang belum divalidasi belum punya baris penagihan dan
 * menyumbang nol rupiah. Itu benar -- uangnya memang belum ada -- dan sekaligus
 * yang membuat `{jumlah_belum_validasi}` di atas bisa dibaca sebagai
 * keterangannya.
 */
function buildBulananNilaiSql(): string {
  return `
    SELECT COALESCE(SUM(dpo.total), 0) AS nilai_obat
    FROM resep_obat ro
    JOIN detail_pemberian_obat dpo
      ON dpo.tgl_perawatan = ro.tgl_perawatan
     AND dpo.jam           = ro.jam
     AND dpo.no_rawat      = ro.no_rawat
    WHERE ro.no_resep >= :awalPrefix AND ro.no_resep < :akhirPrefix
  `;
}

export interface BarisBulananPasien {
  jml_pasien: number | string;
}

/**
 * Jumlah PASIEN berbeda yang menerima resep sebulan.
 *
 * SATU-SATUNYA query di berkas ini yang menyebut `reg_periksa`, dan ia berdiri
 * sendiri justru supaya tetap begitu -- lihat pagar di kepala berkas. Yang
 * meninggalkan SQL cuma satu bilangan; `no_rkm_medis` dipakai sebagai argumen
 * `COUNT(DISTINCT ...)` dan tidak pernah menjadi kolom hasil.
 *
 * INNER JOIN, dan itu benar: resep selalu melekat pada satu kunjungan, dan
 * kunjungan yang barisnya sudah tidak ada di `reg_periksa` tidak punya pasien
 * yang bisa dihitung. Terukur `eq_ref PRIMARY`.
 */
function buildBulananPasienSql(): string {
  return `
    SELECT COUNT(DISTINCT rp.no_rkm_medis) AS jml_pasien
    FROM resep_obat ro
    JOIN reg_periksa rp ON rp.no_rawat = ro.no_rawat
    WHERE ro.no_resep >= :awalPrefix AND ro.no_resep < :akhirPrefix
  `;
}

/* ==========================================================================
 * KEEMPAT JALUR BARANG
 * ==========================================================================
 *
 * Bentuknya sengaja SERAGAM -- satu `COUNT(*)` plus satu `SUM` nilai, semuanya
 * `range PRIMARY` pada prefiks nomor dokumennya. Yang berbeda cuma nama tabel,
 * awalan nomor, dan nama kolom nilainya.
 *
 * Pemesanan dan hibah terukur NOL pada setiap bulan di instalasi ini (menunya
 * masing-masing praktis belum dipakai: satu surat pemesanan dalam dua tahun, dan
 * hibah nol baris sama sekali). Keduanya tetap dibaca dan tetap ditampilkan
 * sebagai 0, atas permintaan pemilik sistem -- dan itu keputusan yang benar
 * dengan alasan yang sama yang membuat `belum_validasi` tetap dihitung: nol di
 * sini bukan sifat struktural melainkan keadaan yang bisa berubah, dan hari ia
 * berhenti nol adalah hari angkanya mulai berarti.
 */

export interface BarisBulananDokumen {
  jml: number | string;
  nilai: number | string | null;
}

function buildBulananPengadaanSql(): string {
  return `
    SELECT COUNT(*) AS jml, COALESCE(SUM(pb.tagihan), 0) AS nilai
    FROM pembelian pb
    WHERE pb.no_faktur >= :awalPrefix AND pb.no_faktur < :akhirPrefix
  `;
}

function buildBulananPemesananSql(): string {
  return `
    SELECT COUNT(*) AS jml, COALESCE(SUM(sp.tagihan), 0) AS nilai
    FROM surat_pemesanan_medis sp
    WHERE sp.no_pemesanan >= :awalPrefix AND sp.no_pemesanan < :akhirPrefix
  `;
}

/**
 * Hibah memakai `totalnilai` (yang DIAKUI RS), bukan `totalhibah` (yang disebut
 * pemberi) -- angka yang sama yang dijurnal Khanza sebagai PENDAPATAN HIBAH.
 * Lihat migrations/031.
 */
function buildBulananHibahSql(): string {
  return `
    SELECT COUNT(*) AS jml, COALESCE(SUM(hb.totalnilai), 0) AS nilai
    FROM hibah_obat_bhp hb
    WHERE hb.no_hibah >= :awalPrefix AND hb.no_hibah < :akhirPrefix
  `;
}

/** Jumlah nota penjualan sebulan. Nilainya query terpisah -- lihat di bawah. */
function buildBulananPenjualanSql(): string {
  return `
    SELECT COUNT(*) AS jml, COALESCE(SUM(pj.ongkir), 0) AS nilai
    FROM penjualan pj
    WHERE pj.nota_jual >= :awalPrefix AND pj.nota_jual < :akhirPrefix
  `;
}

/**
 * Nilai penjualan sebulan -- query TERPISAH, dan itu bukan pilihan gaya.
 *
 * `penjualan` tidak menyimpan totalnya; yang ada cuma `ppn` dan `ongkir` per
 * NOTA, sementara nilainya hidup di `detailjual` per BARANG. Satu query yang
 * menjoinkan keduanya lalu menjumlahkan semuanya akan menghitung `ongkir` sekali
 * PER BARANG -- nota berisi lima barang menyumbang penyesuaiannya lima kali,
 * tanpa satu pun galat, dan angkanya tidak akan pernah cocok dengan layar
 * Khanza. Pelajaran yang sama persis sudah dibayar di `gabungRekap()`
 * (migrations/041).
 *
 * PRIVASI: `penjualan` PUNYA `no_rkm_medis` dan `nm_pasien`, dan `detailjual`
 * punya nama obatnya -- digabung, keduanya persis "obat apa yang diterima siapa".
 * Tidak satu pun ikut. `keterangan` juga tidak: ia teks bebas yang diketik kasir
 * dan terukur memuat nama orang pada sebagian barisnya (migrations/040).
 */
function buildBulananPenjualanNilaiSql(): string {
  return `
    SELECT COALESCE(SUM(dj.total), 0) AS nilai
    FROM penjualan pj
    JOIN detailjual dj ON dj.nota_jual = pj.nota_jual
    WHERE pj.nota_jual >= :awalPrefix AND pj.nota_jual < :akhirPrefix
  `;
}

/* ==========================================================================
 * PEMBACAAN
 * ========================================================================== */

export interface AgregatBulanan {
  resep: BarisBulananResep | null;
  item: BarisBulananItem | null;
  racikan: BarisBulananRacikan | null;
  nilai: BarisBulananNilai | null;
  pasien: BarisBulananPasien | null;
  pengadaan: BarisBulananDokumen | null;
  pemesanan: BarisBulananDokumen | null;
  hibah: BarisBulananDokumen | null;
  penjualan: BarisBulananDokumen | null;
  penjualanNilai: BarisBulananNilai | null;
}

/**
 * Sembilan agregat untuk satu bulan penuh.
 *
 * Dijalankan BERBARENGAN walau kolam `sik` sengaja dibatasi `pool.max: 2`:
 * mysql2 mengantrekan sisanya, dan fungsi ini jalan SEKALI SEBULAN. Biaya
 * antreannya terukur nol koma sekian detik, sementara menjadikannya berurutan
 * cuma memindahkan waktu yang sama ke tempat yang lebih sulit dibaca.
 *
 * Setiap agregat mengembalikan TEPAT SATU baris -- semuanya `COUNT`/`SUM` tanpa
 * `GROUP BY` -- jadi `[0]` selalu ada. `?? null` tetap dipasang karena klaim
 * "selalu ada" tentang database milik orang lain adalah klaim yang menua dengan
 * buruk, dan `core/farmasiBulanan.ts` sudah memperlakukan null sebagai nol.
 */
export async function rekapFarmasiBulanan(ym: string): Promise<AgregatBulanan> {
  const resepRep = rentangBulan(ym, '');
  const pgRep = rentangBulan(ym, 'PG');
  const spRep = rentangBulan(ym, 'SPM', true);
  const hoRep = rentangBulan(ym, 'HO');
  const pjRep = rentangBulan(ym, 'PJ');

  const [resep, item, racikan, nilai, pasien, pengadaan, pemesanan, hibah, penjualan, penjualanNilai] =
    await Promise.all([
      sikSelect<BarisBulananResep>(buildBulananResepSql(), resepRep),
      sikSelect<BarisBulananItem>(buildBulananItemSql(), resepRep),
      sikSelect<BarisBulananRacikan>(buildBulananRacikanSql(), resepRep),
      sikSelect<BarisBulananNilai>(buildBulananNilaiSql(), resepRep),
      sikSelect<BarisBulananPasien>(buildBulananPasienSql(), resepRep),
      sikSelect<BarisBulananDokumen>(buildBulananPengadaanSql(), pgRep),
      sikSelect<BarisBulananDokumen>(buildBulananPemesananSql(), spRep),
      sikSelect<BarisBulananDokumen>(buildBulananHibahSql(), hoRep),
      sikSelect<BarisBulananDokumen>(buildBulananPenjualanSql(), pjRep),
      sikSelect<BarisBulananNilai>(buildBulananPenjualanNilaiSql(), pjRep),
    ]);

  return {
    resep: resep[0] ?? null,
    item: item[0] ?? null,
    racikan: racikan[0] ?? null,
    nilai: nilai[0] ?? null,
    pasien: pasien[0] ?? null,
    pengadaan: pengadaan[0] ?? null,
    pemesanan: pemesanan[0] ?? null,
    hibah: hibah[0] ?? null,
    penjualan: penjualan[0] ?? null,
    penjualanNilai: penjualanNilai[0] ?? null,
  };
}

/**
 * TANPA izin pindai penuh untuk kesepuluh query, dan itu bukan keberuntungan:
 * setiap penyaringnya ditulis pada PRIMARY KEY tabelnya (`no_resep`,
 * `no_faktur`, `no_pemesanan`, `no_hibah`, `nota_jual`), sehingga rentang sebulan
 * selalu jatuh sebagai `range`. Terukur pada rentang Juli 2026 -- bulan penuh
 * terakhir dan yang tersibuk:
 *
 *   resep      range PRIMARY 685      + telaah eq_ref PRIMARY
 *   pasien     range PRIMARY 685      + reg_periksa eq_ref PRIMARY
 *   pengadaan  range PRIMARY 26
 *   pemesanan  range PRIMARY 1
 *   hibah      range PRIMARY 1
 *   penjualan  range PRIMARY 716      + detailjual ref nota_jual
 *
 * `maxRows` dipatok jauh di atas angka terukur karena rentangnya SEBULAN, bukan
 * sehari: kalau instalasi lain berjalan sepuluh kali lebih ramai, pemeriksaan ini
 * tidak boleh berbunyi hanya karena rumah sakitnya lebih besar. Yang harus
 * ditangkapnya adalah rencana yang BERUBAH BENTUK -- prefiks yang berhenti
 * dipakai sebagai `range` -- bukan volume.
 *
 * Bulan contohnya sengaja bulan yang BERISI. Bulan kosong membuat MariaDB memilih
 * rencana yang berbeda pada tabel yang hampir kosong (pelajaran `sks` dan
 * `permintaan_lab`), sehingga pemeriksaannya akan menjaga bentuk yang tidak
 * pernah dipakai produksi.
 */
const contohResep = rentangBulan('202607', '');
const contohPg = rentangBulan('202607', 'PG');
const contohSp = rentangBulan('202607', 'SPM', true);
const contohHo = rentangBulan('202607', 'HO');
const contohPj = rentangBulan('202607', 'PJ');

const MAKS_BARIS_BULAN = 50_000;

registerPlanCheck({ name: 'FARMASI_BULANAN_RESEP', sql: buildBulananResepSql(), replacements: contohResep, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_ITEM', sql: buildBulananItemSql(), replacements: contohResep, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_RACIKAN', sql: buildBulananRacikanSql(), replacements: contohResep, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_NILAI', sql: buildBulananNilaiSql(), replacements: contohResep, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_PASIEN', sql: buildBulananPasienSql(), replacements: contohResep, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_PENGADAAN', sql: buildBulananPengadaanSql(), replacements: contohPg, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_PEMESANAN', sql: buildBulananPemesananSql(), replacements: contohSp, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_HIBAH', sql: buildBulananHibahSql(), replacements: contohHo, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_PENJUALAN', sql: buildBulananPenjualanSql(), replacements: contohPj, maxRows: MAKS_BARIS_BULAN });
registerPlanCheck({ name: 'FARMASI_BULANAN_PENJUALAN_NILAI', sql: buildBulananPenjualanNilaiSql(), replacements: contohPj, maxRows: MAKS_BARIS_BULAN });
