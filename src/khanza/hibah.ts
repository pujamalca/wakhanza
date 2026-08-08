import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import type { BarisHibah, BarisDetailHibah } from '@/core/hibah';

/**
 * HIBAH OBAT & BHP -- barang medis yang DITERIMA sebagai pemberian.
 *
 * Sumbernya menu "Hibah Obat & BHP" di Khanza
 * (`src/inventory/InventoryHibahObatBHP.java`), yang menulis satu baris
 * `hibah_obat_bhp` berikut sekian baris `detailhibah_obat_bhp`.
 *
 * Kembaran `khanza/pengadaan.ts`, dan sengaja dibentuk semirip mungkin dengannya
 * -- keduanya menjawab pertanyaan yang sama ("barang apa yang masuk gudang hari
 * ini, dari siapa, senilai berapa") lewat menu yang berbeda. Yang BERBEDA
 * dicatat di tempatnya masing-masing di bawah, bukan disembunyikan di balik
 * kemiripannya.
 *
 * ==========================================================================
 * TIDAK ADA SATU PUN DATA PASIEN DI SINI, dan itu yang membentuk pagarnya
 * ==========================================================================
 *
 * Sama kategorinya dengan `pengadaan.ts`, `stokDarurat.ts`, dan `stokObat.ts`:
 * yang dibaca adalah KATALOG barang, nilainya, dan pemberinya -- tidak ada satu
 * pun kolom yang menautkan sebuah penerimaan hibah dengan seorang pasien, dan
 * tidak ada satu pun tabel di sini yang bisa. Larangan "nama obat tidak pernah
 * diambil dari `sik`" tetap utuh: larangan itu tentang `resep_obat` -- obat APA
 * yang diterima SIAPA.
 *
 * Modul ini TIDAK BOLEH digabung dengan `resep_obat`, `detail_pemberian_obat`,
 * atau `reg_periksa`.
 *
 * ==========================================================================
 * Kelas PINDAI, lewat sebab yang sama persis dengan pengadaan
 * ==========================================================================
 *
 * `hibah_obat_bhp` punya TUJUH kolom dan tidak satu pun stempel waktu -- yang
 * ada cuma `tgl_hibah` bertipe DATE, dan tanggal itu DIPILIH staf, bukan diisi
 * jam server. Watermark karena itu mustahil benar. Jendelanya berbagi penurunan
 * dengan SURAT_SAKIT dan PENGADAAN lewat `core/jendelaPindai.ts`.
 *
 * `riwayat_barang_medis` ditolak dengan dua alasan yang sama seperti pengadaan,
 * dan di sini alasannya bahkan lebih kuat: (1) tidak ada indeks yang bisa
 * melayani penyaringan waktu atas 114.092 baris yang bertambah ~100 sehari; dan
 * (2) `InventoryHibahObatBHP.java:824` -- cabang non-batch, yang dipakai di sini
 * karena `farmasi.stok_pakai_batch` mati -- meneruskan `no_faktur=""` ke
 * `Trackobat.catatRiwayat(...)`, persis seperti `DlgPembelian.java:998`. Di
 * instalasi ini tabel itu bahkan tidak punya SATU baris ber-`posisi='Hibah'`.
 *
 * ==========================================================================
 * Pemangkasnya prefiks `no_hibah`
 * ==========================================================================
 *
 * Bentuknya `HO` + `YYYYMMDD` + urutan 3 digit, dan ia PRIMARY KEY yang terurut
 * leksikal -- jadi rentang tanggal jatuh langsung jadi `range` pada PRIMARY,
 * terukur bahkan pada tabel yang masih kosong (bukan `type=ALL` seperti yang
 * terjadi pada `sks` dan `permintaan_lab`, yang bukan PK).
 *
 * `InventoryHibahObatBHP.java:1386` merakit prefiksnya lewat `Valid.autoNomer3`
 * dari isi kotak **Tanggal** pada saat nomornya dibuatkan -- mekanisme yang sama
 * persis dengan `no_faktur` pengadaan, sampai ke nama variabelnya (`TglBeli`).
 *
 * PENGUKURANNYA BERBEDA DARI PENGADAAN, dan itu wajib disadari: untuk pengadaan,
 * arahnya diukur atas 910 baris (9 maju, 0 mundur) dan nol pada arah mundur
 * itulah yang membuktikan prefiksnya penanda "kapan DIMASUKKAN". Di sini
 * tabelnya KOSONG di kedua database produksi; yang ada cuma 6 baris di dua
 * database uji, dan keenamnya berselisih NOL hari. Enam baris tidak membuktikan
 * apa pun tentang arah penyimpangannya -- yang menopang keputusan ini adalah
 * kesamaan MEKANISMENYA di sumber Khanza, bukan pengukuran. Karena itu
 * jendelanya tetap merentang KE DUA ARAH: kalau ternyata menyimpang, ia
 * menyimpang ke arah yang sudah dijaring.
 */

/**
 * Batas baris jendela pindai.
 *
 * Jauh lebih longgar daripada yang akan pernah dibutuhkan: hibah adalah kejadian
 * jarang (nol baris di kedua database produksi, tiga baris dalam setahun di
 * database uji yang paling ramai). Batas ini jaring pengaman terhadap instalasi
 * yang menerima hibah rutin, bukan angka yang akan menggigit di sini.
 */
const BATAS_JENDELA = 300;

function prefixHibah(tanggal: string, akhir: boolean): string {
  const angka = tanggal.replace(/-/g, '');
  return `HO${angka}${akhir ? '999' : '000'}`;
}

/**
 * Kedua total header SELALU dibaca, dan `farmasi.hibah_nilai` TIDAK memutusnya
 * -- persis seperti `{tagihan}` pada pengadaan.
 *
 * Versi pertama memutus keduanya juga, dengan alasan yang terdengar lebih ketat
 * ("tidak ada yang ditagihkan, jadi tidak ada alasan angkanya tetap dibaca").
 * Alasan itu runtuh begitu hasilnya dilihat: templatenya menulis LABEL kedua
 * total sebagai baris tersendiri, jadi mematikan sakelarnya menghasilkan
 *
 *     Total nilai hibah :
 *     *Nilai diakui : *
 *
 * -- dua baris menggantung yang terbaca sebagai sistem rusak, dan sejak itu
 * angka yang benar pun tidak dipercaya. Satu-satunya jalan keluarnya adalah
 * menyuruh staf ikut menyunting templatenya, dan invarian dua-langkah semacam
 * itu adalah yang berulang kali terbukti gagal DIAM di proyek ini.
 *
 * Jadi sakelarnya mengatur apa yang memang bisa diaturnya sendirian: nilai PER
 * BARANG. RS yang tidak ingin satu pun angka beredar menghapus `{total_hibah}`
 * dan `{total_diakui}` dari templatenya -- satu tindakan yang terlihat, di
 * halaman yang sedang dibukanya.
 */
function buildHeaderSql(): string {
  return `
    SELECT
      h.no_hibah, h.tgl_hibah,
      COALESCE(pm.nama_pemberi, '') AS nama_pemberi,
      COALESCE(pt.nama, '')         AS nama_petugas,
      COALESCE(g.nm_bangsal, '')    AS nm_bangsal,
      h.totalhibah, h.totalnilai
    FROM hibah_obat_bhp h
    LEFT JOIN pemberihibah pm ON pm.kode_pemberi = h.kode_pemberi
    LEFT JOIN petugas pt      ON pt.nip = h.nip
    LEFT JOIN bangsal g       ON g.kd_bangsal = h.kd_bangsal
    WHERE h.no_hibah >= :awalPrefix AND h.no_hibah <= :akhirPrefix
    ORDER BY h.no_hibah ASC
    LIMIT ${BATAS_JENDELA}
  `;
}

/**
 * Seluruh join LEFT, dan itu koreksi atas Khanza yang disengaja.
 *
 * `InventoryCariHibahObatBHP` menampilkan hibah lewat INNER JOIN; sebuah baris
 * yang pemberinya sudah dihapus dari master karena itu hilang sama sekali dari
 * daftar. Untuk layar yang dibuka orang, hilangnya satu baris lama terlihat dan
 * bisa ditelusuri. Untuk PEMICU, hilangnya berarti satu penerimaan barang yang
 * benar-benar terjadi tidak pernah diberitahukan, tanpa satu pun galat.
 *
 * `kode_pemberi` NULLABLE di tabelnya (berbeda dari `kd_bangsal` yang NOT NULL),
 * jadi LEFT JOIN di sini bukan cuma kehati-hatian terhadap master yang terhapus
 * -- barisnya memang boleh tidak menunjuk pemberi mana pun.
 */
export async function pollHibahJendela(dariTanggal: string, sampaiTanggal: string): Promise<BarisHibah[]> {
  return sikSelect<BarisHibah>(buildHeaderSql(), {
    awalPrefix: prefixHibah(dariTanggal, false),
    akhirPrefix: prefixHibah(sampaiTanggal, true),
  });
}

/**
 * Rincian barang -- query TERPISAH, bukan satu join yang menggandakan header.
 *
 * Alasan yang sama dengan pengadaan: menjoinkan keduanya berarti setiap kolom
 * header berulang sebanyak barangnya lalu harus dibuang lagi di sisi Node.
 *
 * `sertakanNilai` memutus kolom nilainya di SELECT, bukan menyaringnya nanti --
 * bentuk yang sama dengan `farmasi.pengadaan_harga` dan
 * `administrasi.sertakan_diagnosa`: pengaturannya dibaca PEMANGGIL lalu
 * diserahkan sebagai parameter, karena modul `khanza/` tidak boleh menyentuh
 * pengaturan (batas itu yang membuat `npm run verify:db` bisa membuktikan `sik`
 * hanya dibaca). Saat mati, nilai per barang tidak sekadar tidak dirender: ia
 * tidak pernah sampai ke proses ini (§5.2).
 *
 * `subtotalhibah` sengaja TIDAK diambil walau ada. Yang ditampilkan per baris
 * cuma nilai satuan yang disebut pemberi (`h_hibah`, dan hanya saat berbeda dari
 * yang diakui) -- subtotalnya tidak menambah apa pun yang tidak sudah terjawab
 * oleh `{total_hibah}` di kepala nota, sementara ia menambah satu kolom lagi
 * pada tiap baris yang sudah punya empat angka.
 *
 * `kadaluarsa` dan `no_batch` juga tidak diambil. `kadaluarsa` bernilai
 * `'0000-00-00'` pada SELURUH 14 baris rincian di database uji -- kolom yang
 * memang tidak diisi, dan mencetak penanda kosongnya membuat notanya terbaca
 * sebagai sistem rusak. Alasannya berbeda dari pengadaan (di sana kolomnya
 * terisi tapi 20% sudah lewat pada hari pembeliannya), tapi kesimpulannya sama.
 */
export async function ambilDetailHibah(noHibah: string[], sertakanNilai: boolean): Promise<BarisDetailHibah[]> {
  if (noHibah.length === 0) return [];
  return sikSelect<BarisDetailHibah>(buildDetailSql(sertakanNilai), { nomor: noHibah });
}

function buildDetailSql(sertakanNilai: boolean): string {
  return `
    SELECT
      d.no_hibah, d.kode_brng,
      COALESCE(br.nama_brng, '') AS nama_brng,
      COALESCE(sat.satuan, '')   AS satuan,
      d.jumlah${sertakanNilai ? ',\n      d.h_hibah, d.h_diakui, d.subtotaldiakui' : ''}
    FROM detailhibah_obat_bhp d
    LEFT JOIN databarang br  ON br.kode_brng = d.kode_brng
    LEFT JOIN kodesatuan sat ON sat.kode_sat = d.kode_sat
    WHERE d.no_hibah IN (:nomor)
    ORDER BY d.no_hibah ASC, br.nama_brng ASC
  `;
}

/** Jendela penuh terbaca = tanda ada yang mungkin luput; dipakai runner untuk memperingatkan. */
export const JENDELA_HIBAH_PENUH = BATAS_JENDELA;

/**
 * TANPA izin pindai penuh untuk keempatnya, dan di sini itu bukan keberuntungan
 * MAUPUN sesuatu yang akan berubah saat tabelnya terisi.
 *
 * `sks` (surat sakit) dan `permintaan_lab` sama-sama perlu izin sementara justru
 * karena kolom pemangkasnya BUKAN primary key, sehingga MariaDB memilih pindai
 * penuh selagi tabelnya kecil. Di sini `no_hibah` dan `(no_hibah, kode_brng,
 * no_batch)` ADALAH primary key masing-masing tabel, jadi rencananya `range
 * PRIMARY` bahkan pada tabel yang berisi nol baris -- dibuktikan dengan
 * menjalankan EXPLAIN yang sama terhadap `alca` (0 baris) dan salinan uji
 * (3 baris): keduanya `range PRIMARY`.
 *
 * Izinnya karena itu tidak ditulis, dan jangan ditambahkan "supaya aman": izin
 * pindai penuh yang menganggur adalah izin yang diam-diam menutupi kemunduran
 * berikutnya.
 *
 * Kedua varian rincian didaftarkan terpisah karena bentuk SQL yang berbeda
 * adalah bentuk yang belum terperiksa -- alasan yang sama dengan
 * `FARMASI_PENGADAAN_DETAIL_HARGA`. Header cuma punya satu bentuk sejak kedua
 * totalnya selalu dibaca.
 */
registerPlanCheck({
  name: 'FARMASI_HIBAH',
  sql: buildHeaderSql(),
  replacements: { awalPrefix: prefixHibah('2026-08-01', false), akhirPrefix: prefixHibah('2026-08-14', true) },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_HIBAH_DETAIL',
  sql: buildDetailSql(false),
  replacements: { nomor: ['HO20260807001'] },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_HIBAH_DETAIL_NILAI',
  sql: buildDetailSql(true),
  replacements: { nomor: ['HO20260807001'] },
  maxRows: 5000,
});
