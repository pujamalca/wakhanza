import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import type { BarisPemesanan, BarisDetailPemesanan } from '@/core/pemesanan';

/**
 * SURAT PEMESANAN OBAT & BHP -- pesanan yang DIKIRIM ke pemasok.
 *
 * Sumbernya menu "Surat Pemesanan Obat & BHP" di Khanza
 * (`src/inventory/InventorySuratPemesanan.java`), yang menulis satu baris
 * `surat_pemesanan_medis` berikut sekian baris `detail_surat_pemesanan_medis`.
 *
 * Kembaran `khanza/pengadaan.ts` dan `khanza/hibah.ts`, TAPI ia pasangan
 * pengadaan dari ujung yang lain -- bukan salinannya:
 *
 *   SURAT PEMESANAN   pesanan DIKIRIM     "barang ini sedang dipesan"
 *   PENGADAAN         barang DITERIMA     "barang ini sudah datang"
 *
 * `DlgPembelian.java:1810-1826` MEMBACA tabel ini untuk mengisi layar
 * pembeliannya, jadi sebuah pesanan yang barangnya datang melahirkan baris
 * `pembelian` tersendiri -- dan PENGADAAN sudah memberitakannya. Modul ini
 * karena itu tidak pernah berbicara tentang kedatangan.
 *
 * ==========================================================================
 * TIDAK ADA SATU PUN DATA PASIEN DI SINI, dan itu yang membentuk pagarnya
 * ==========================================================================
 *
 * Sama kategorinya dengan `pengadaan.ts`, `hibah.ts`, `stokDarurat.ts`, dan
 * `stokObat.ts`: yang dibaca adalah KATALOG barang, harganya, dan pemasoknya --
 * tidak ada satu pun kolom yang menautkan sebuah pesanan dengan seorang pasien,
 * dan tidak ada satu pun tabel di sini yang bisa. Larangan "nama obat tidak
 * pernah diambil dari `sik`" tetap utuh: larangan itu tentang `resep_obat` --
 * obat APA yang diterima SIAPA.
 *
 * Modul ini TIDAK BOLEH digabung dengan `resep_obat`, `detail_pemberian_obat`,
 * atau `reg_periksa`.
 *
 * ==========================================================================
 * Kelas PINDAI, lewat sebab yang sama persis dengan pengadaan dan hibah
 * ==========================================================================
 *
 * `surat_pemesanan_medis` punya sebelas kolom dan tidak satu pun stempel waktu
 * -- yang ada cuma `tanggal` bertipe DATE, dan tanggal itu DIPILIH staf, bukan
 * diisi jam server. Watermark karena itu mustahil benar. Jendelanya berbagi
 * penurunan dengan SURAT_SAKIT, PENGADAAN, dan HIBAH lewat
 * `core/jendelaPindai.ts`.
 *
 * `riwayat_barang_medis` ditolak dengan alasan yang sama seperti kedua
 * saudaranya, dan di sini bahkan tidak perlu diperiksa lebih jauh: ia mencatat
 * PERGERAKAN STOK, sementara sebuah surat pemesanan belum menggerakkan satu
 * butir barang pun. Tidak ada baris di sana yang menandai pesanan dikirim.
 */

/**
 * Batas baris jendela pindai.
 *
 * Jauh lebih longgar daripada yang akan pernah dibutuhkan: terukur 40 pesanan
 * sepanjang setahun pada database uji yang paling ramai (`sik-ridda-dev`), dan
 * NOL di database produksi. Batas ini jaring pengaman terhadap instalasi yang
 * memesan tiap hari, bukan angka yang akan menggigit di sini.
 */
const BATAS_JENDELA = 300;

/**
 * Pemangkas `no_pemesanan`, dan DI SINILAH satu-satunya perbedaan yang bisa
 * membuat seluruh fitur ini diam tanpa satu pun galat.
 *
 * ==========================================================================
 * Tahun DUA digit -- `SPM` + `YYMMDD`, bukan `YYYYMMDD`
 * ==========================================================================
 *
 * `InventorySuratPemesanan.java:1677` merakit prefiksnya lewat
 * `Valid.autoNomer3` sebagai:
 *
 *     "SPM" + Tanggal.substring(8,10)   // yy  <- DUA digit terakhir tahun
 *           + Tanggal.substring(3,5)    // MM
 *           + Tanggal.substring(0,2)    // dd
 *
 * atas kotak Tanggal berformat `dd-MM-yyyy`. Jadi `SPM230610001` = 10 Juni 2023,
 * dan bentuknya `SPM` + 6 digit + urutan 3 digit -- panjang 12, bukan 14.
 *
 * Pengadaan (`PG`) dan hibah (`HO`) keduanya memakai `YYYYMMDD`. Menyalin
 * `prefixFaktur()` apa adanya ke sini menghasilkan `SPM20260807000`, yang secara
 * LEKSIKAL berada di atas seluruh nilai `SPM26...` yang benar -- sehingga
 * `no_pemesanan >= :awalPrefix` tidak pernah cocok dengan satu baris pun.
 * Hasilnya bukan galat melainkan jendela yang selamanya kosong, dan gejalanya
 * persis sama dengan "memang belum ada pesanan baru". Kelas kegagalan yang sama
 * dengan prefiks `nobooking` pada pembatalan BPJS.
 *
 * Sifat leksikalnya tetap utuh untuk keperluan pemangkasan: `SPM251231001` <
 * `SPM260101001`. Yang akan mematahkannya adalah pergantian abad (`99` -> `00`),
 * dan itu 74 tahun lagi -- disebut di sini supaya yang menemukannya nanti tahu
 * ini sudah dilihat, bukan terlewat.
 *
 * ==========================================================================
 * Arahnya diukur, dan hasilnya BERBEDA dari pengadaan
 * ==========================================================================
 *
 * Atas 109 baris di enam database (`sik` 10, `sik-dev` 19, `sik-dev-alca` 14,
 * `sik-ridda-dev` 40, `alca-dev` 18, `sik05112026` 8):
 *
 *   prefiks LEBIH MAJU daripada `tanggal`     0 baris
 *   prefiks LEBIH MUNDUR daripada `tanggal`   0 baris
 *
 * Cocok sempurna, berbeda dari pengadaan yang menyimpang pada 9 dari 910. Sebabnya
 * terlihat di `Valid.autoNomer3`-nya sendiri: query urutannya menyaring
 * `WHERE tanggal = <tanggal terpilih>`, jadi nomor dan tanggal lahir dari kotak
 * yang sama pada saat yang sama.
 *
 * Jendelanya TETAP merentang ke dua arah. Yang menopang keputusan itu bukan
 * pengukuran di atas melainkan MEKANISMENYA: staf masih bisa menggeser kotak
 * Tanggal SESUDAH nomornya dibuatkan, dan nol dari 109 membuktikan bahwa itu
 * jarang -- bukan bahwa itu mustahil.
 */
function prefixPemesanan(tanggal: string, akhir: boolean): string {
  // `tanggal` selalu `YYYY-MM-DD` (dihitung `core/jendelaPindai.ts`), jadi
  // membuang dua digit pertama tahunnya cukup dengan slice -- bukan penguraian
  // tanggal, yang justru bisa menggeser hari lewat zona waktu.
  const angka = tanggal.replace(/-/g, '').slice(2);
  return `SPM${angka}${akhir ? '999' : '000'}`;
}

/**
 * Keempat angka header SELALU dibaca, dan `farmasi.pemesanan_harga` TIDAK
 * memutusnya -- persis seperti `{tagihan}` pada pengadaan dan kedua total pada
 * hibah.
 *
 * Sebabnya sudah dibayar di 029: templatenya menulis LABEL tiap angka sebagai
 * baris tersendiri, jadi mematikan sakelarnya menghasilkan "Tagihan :" tanpa
 * angka -- baris menggantung yang terbaca sebagai sistem rusak, dan sejak itu
 * angka yang benar pun tidak dipercaya. Sakelarnya mengatur apa yang memang bisa
 * diaturnya sendirian: harga PER BARANG.
 *
 * ==========================================================================
 * `pegawai`, BUKAN `petugas` -- dan ini terukur, bukan pilihan gaya
 * ==========================================================================
 *
 * Pengadaan dan hibah keduanya menyelesaikan `nip` lewat `petugas`, jadi
 * menyeragamkannya di sini terasa benar. Ia salah, dan tabelnya sendiri yang
 * mengatakannya: foreign key `surat_pemesanan_medis_ibfk_2` menunjuk
 * `pegawai(nik)`, dan `InventoryVerifikasiPenerimaan.java:718` men-join
 * `pegawai on surat_pemesanan_medis.nip = pegawai.nik`.
 *
 * Diukur atas 40 baris di `sik-ridda-dev`:
 *
 *   diselesaikan lewat `pegawai`   40 dari 40
 *   diselesaikan lewat `petugas`   21 dari 40
 *
 * Sembilan belas sisanya (`010101`, `08998998`, `D0000003`, `D0000004`) akan
 * tampil sebagai nama petugas KOSONG pada 47% pesanan -- tanpa satu pun galat,
 * karena `COALESCE(...,'')` memang memperlakukannya sebagai variabel kosong.
 *
 * ==========================================================================
 * Tanpa `kd_bangsal`, dan itu bukan kelalaian tabelnya
 * ==========================================================================
 *
 * `pembelian` dan `hibah_obat_bhp` keduanya punya kolom gudang; tabel ini tidak.
 * Masuk akal: sebuah PESANAN belum menentukan gudang mana yang akan menerimanya
 * -- itu baru diputuskan saat penerimaan. Karena itu tidak ada join ke `bangsal`
 * di sini, dan tidak ada `{nama_gudang}` yang bisa ditambahkan ke templatenya.
 */
function buildHeaderSql(): string {
  return `
    SELECT
      p.no_pemesanan, p.tanggal,
      COALESCE(s.nama_suplier, '') AS nama_suplier,
      COALESCE(pg.nama, '')        AS nama_petugas,
      COALESCE(p.status, '')       AS status,
      p.total1, p.potongan, p.ppn, p.meterai, p.tagihan
    FROM surat_pemesanan_medis p
    LEFT JOIN datasuplier s ON s.kode_suplier = p.kode_suplier
    LEFT JOIN pegawai pg    ON pg.nik = p.nip
    WHERE p.no_pemesanan >= :awalPrefix AND p.no_pemesanan <= :akhirPrefix
    ORDER BY p.no_pemesanan ASC
    LIMIT ${BATAS_JENDELA}
  `;
}

/**
 * Kedua join LEFT, dan itu koreksi atas Khanza yang disengaja.
 *
 * `InventoryVerifikasiPenerimaan` menampilkan pesanan lewat INNER JOIN ke
 * `pegawai`; sebuah pesanan yang petugasnya sudah dihapus dari master karena itu
 * hilang sama sekali dari daftar. Untuk layar yang dibuka orang, hilangnya satu
 * baris lama terlihat dan bisa ditelusuri. Untuk PEMICU, hilangnya berarti satu
 * pesanan yang benar-benar dikirim ke pemasok tidak pernah diberitahukan, tanpa
 * satu pun galat.
 *
 * `kode_suplier` dan `nip` keduanya NULLABLE di tabelnya, jadi LEFT JOIN di sini
 * bukan cuma kehati-hatian terhadap master yang terhapus -- barisnya memang boleh
 * tidak menunjuk pemasok maupun petugas mana pun.
 */
export async function pollPemesananJendela(
  dariTanggal: string,
  sampaiTanggal: string,
): Promise<BarisPemesanan[]> {
  return sikSelect<BarisPemesanan>(buildHeaderSql(), {
    awalPrefix: prefixPemesanan(dariTanggal, false),
    akhirPrefix: prefixPemesanan(sampaiTanggal, true),
  });
}

/**
 * Rincian barang -- query TERPISAH, bukan satu join yang menggandakan header.
 *
 * Alasan yang sama dengan pengadaan dan hibah: menjoinkan keduanya berarti
 * setiap kolom header (termasuk kelima angka rupiahnya) berulang sebanyak
 * barangnya, lalu harus dibuang lagi di sisi Node.
 *
 * `sertakanHarga` memutus kolom harganya di SELECT, bukan menyaringnya nanti --
 * bentuk yang sama dengan `farmasi.pengadaan_harga`, `farmasi.hibah_nilai`, dan
 * `administrasi.sertakan_diagnosa`: pengaturannya dibaca PEMANGGIL lalu
 * diserahkan sebagai parameter, karena modul `khanza/` tidak boleh menyentuh
 * pengaturan (batas itu yang membuat `npm run verify:db` bisa membuktikan `sik`
 * hanya dibaca). Saat mati, harga pesanan tidak sekadar tidak dirender: ia tidak
 * pernah sampai ke proses ini (§5.2).
 *
 * ==========================================================================
 * Yang sengaja TIDAK diambil, dan sebabnya masing-masing
 * ==========================================================================
 *
 * `subtotal` -- ia jumlah x harga SEBELUM diskon baris, sementara `total` adalah
 * sesudahnya. Keduanya berselisih pada 1 dari 122 baris rincian sungguhan, dan
 * yang benar untuk nota adalah `total`: hanya itu yang menjumlah ke `tagihan` di
 * kepala nota. Mengambil keduanya cuma memberi kesempatan memilih yang salah.
 *
 * `dis` / `besardis` -- diskon per baris, terpakai pada 1 dari 122. Menambah
 * satu kolom angka pada SETIAP baris demi keadaan di bawah 1% membuat notanya
 * lebih sulit dibaca setiap hari demi kejelasan sesekali; selisihnya toh sudah
 * terbaca dari harga dikali jumlah yang tidak sama dengan totalnya.
 *
 * `jumlah2` -- Khanza memakainya bersama `databarang.isi` untuk menghitung isi
 * kemasan (`InventorySuratPemesanan.java:1704`). Terukur SAMA PERSIS dengan
 * `jumlah` pada seluruh 122 baris, jadi mencetaknya berarti mengulang angka yang
 * sama dua kali dalam satu baris.
 */
export async function ambilDetailPemesanan(
  noPemesanan: string[],
  sertakanHarga: boolean,
): Promise<BarisDetailPemesanan[]> {
  if (noPemesanan.length === 0) return [];
  return sikSelect<BarisDetailPemesanan>(buildDetailSql(sertakanHarga), { nomor: noPemesanan });
}

function buildDetailSql(sertakanHarga: boolean): string {
  return `
    SELECT
      d.no_pemesanan, d.kode_brng,
      COALESCE(br.nama_brng, '') AS nama_brng,
      COALESCE(sat.satuan, '')   AS satuan,
      d.jumlah${sertakanHarga ? ',\n      d.h_pesan, d.total' : ''}
    FROM detail_surat_pemesanan_medis d
    LEFT JOIN databarang br  ON br.kode_brng = d.kode_brng
    LEFT JOIN kodesatuan sat ON sat.kode_sat = d.kode_sat
    WHERE d.no_pemesanan IN (:nomor)
    ORDER BY d.no_pemesanan ASC, br.nama_brng ASC
  `;
}

/** Jendela penuh terbaca = tanda ada yang mungkin luput; dipakai runner untuk memperingatkan. */
export const JENDELA_PEMESANAN_PENUH = BATAS_JENDELA;

/**
 * TANPA izin pindai penuh untuk ketiganya, dan di sini itu bukan keberuntungan
 * MAUPUN sesuatu yang akan berubah saat tabelnya terisi.
 *
 * `sks` (surat sakit) dan `permintaan_lab` sama-sama perlu izin sementara justru
 * karena kolom pemangkasnya BUKAN primary key, sehingga MariaDB memilih pindai
 * penuh selagi tabelnya kecil. Di sini `no_pemesanan` ADALAH primary key
 * `surat_pemesanan_medis`, dan `detail_surat_pemesanan_medis` punya indeks
 * `no_pemesanan` tersendiri. Dibuktikan dengan menjalankan EXPLAIN terhadap
 * database produksi yang nyaris kosong (`alca`, 1 baris) DAN terhadap salinan
 * yang berisi (`sik-ridda-dev`, 40 / 122): header `range PRIMARY`, rincian
 * `ref no_pemesanan` -- keduanya, di kedua database. Justru pada tabel yang
 * hampir kosong itulah `sks` dan `permintaan_lab` gagal, jadi kesamaan hasil di
 * kedua ujung ukuran itu yang membuat izinnya benar-benar tidak diperlukan.
 *
 * Izinnya karena itu tidak ditulis, dan jangan ditambahkan "supaya aman": izin
 * pindai penuh yang menganggur adalah izin yang diam-diam menutupi kemunduran
 * berikutnya.
 *
 * Kedua varian rincian didaftarkan terpisah karena bentuk SQL yang berbeda
 * adalah bentuk yang belum terperiksa -- alasan yang sama dengan
 * `FARMASI_PENGADAAN_DETAIL_HARGA` dan `FARMASI_HIBAH_DETAIL_NILAI`.
 */
registerPlanCheck({
  name: 'FARMASI_PEMESANAN',
  sql: buildHeaderSql(),
  replacements: {
    awalPrefix: prefixPemesanan('2026-08-01', false),
    akhirPrefix: prefixPemesanan('2026-08-14', true),
  },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PEMESANAN_DETAIL',
  sql: buildDetailSql(false),
  replacements: { nomor: ['SPM260807001'] },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PEMESANAN_DETAIL_HARGA',
  sql: buildDetailSql(true),
  replacements: { nomor: ['SPM260807001'] },
  maxRows: 5000,
});
