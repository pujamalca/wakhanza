import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import type { BarisPengadaan, BarisDetailPengadaan } from '@/core/pengadaan';

/**
 * PENGADAAN OBAT, ALKES & BHP MEDIS -- pembelian langsung dari pemasok.
 *
 * Sumbernya menu "Transaksi Pengadaan Obat, Alkes & BHP Medis" di Khanza
 * (`src/inventory/DlgPembelian.java`), yang menulis satu baris `pembelian`
 * berikut sekian baris `detailbeli`.
 *
 * ==========================================================================
 * TIDAK ADA SATU PUN DATA PASIEN DI SINI, dan itu yang membentuk pagarnya
 * ==========================================================================
 *
 * Sama kategorinya dengan `stokDarurat.ts` dan `stokObat.ts`: yang dibaca adalah
 * KATALOG barang, harga beli, dan pemasok -- tidak ada satu pun kolom yang
 * menautkan sebuah pembelian dengan seorang pasien, dan tidak ada satu pun
 * tabel di sini yang bisa. Larangan "nama obat tidak pernah diambil dari `sik`"
 * (lihat komentar panjang di `stokObat.ts`) tetap utuh: larangan itu tentang
 * `resep_obat` -- obat APA yang diterima SIAPA. Yang ini setara nota pembelian
 * yang ditempel di papan gudang.
 *
 * Modul ini TIDAK BOLEH digabung dengan `resep_obat`, `detail_pemberian_obat`,
 * atau `reg_periksa`. Penggabungan itulah yang akan mengubah nota pembelian
 * menjadi data pasien, dan tidak ada satu pun kebutuhan di halaman ini yang
 * memerlukannya.
 *
 * ==========================================================================
 * Kelas PINDAI, dan sekali lagi bentuk tabelnya yang memaksanya
 * ==========================================================================
 *
 * `pembelian` TIDAK punya kolom jam sama sekali -- hanya `tgl_beli` bertipe
 * DATE, dan tanggal itu DIPILIH staf (tanggal nota pemasok), bukan diisi jam
 * server. Jadi tidak ada satu pun nilai di tabel ini yang menyatakan "baris ini
 * tersimpan pukul sekian", dan watermark karena itu mustahil benar.
 *
 * Yang dipakai: jendela ±N hari yang dipindai ulang tiap siklus, dedup murni
 * lewat kunci idempoten -- bentuk yang sama dengan SURAT_SAKIT dan dengan alasan
 * yang sama persis.
 *
 * ==========================================================================
 * Kenapa `riwayat_barang_medis` TIDAK dipakai walau ia PUNYA jam
 * ==========================================================================
 *
 * Ia menggoda: `posisi='Pengadaan'`, `status='Simpan'`, plus `tanggal` DATE dan
 * `jam` TIME yang benar-benar diisi saat penyimpanan -- persis waktu kejadian
 * yang tidak dipunyai `pembelian`. Ditolak karena dua hal yang terukur:
 *
 * 1. **Tidak ada indeks yang bisa melayani penyaringan waktu.** Satu-satunya
 *    kunci di tabel itu adalah `kode_brng` dan `kd_bangsal`. Menyaring
 *    `tanggal >= X` berarti pemindaian penuh atas 114.092 baris yang bertambah
 *    ~100 sehari (58 ribu di antaranya dari pemberian obat, yang sama sekali
 *    tidak ada urusannya dengan pengadaan) -- setiap siklus, selamanya. Itu
 *    persis beban yang §4.4 ada untuk mencegahnya.
 *
 * 2. **`no_faktur`-nya KOSONG di instalasi ini.** `DlgPembelian.java` memanggil
 *    `Trackobat.catatRiwayat(...)` lewat dua cabang, dan cabang non-batch
 *    (baris 998, yang dipakai di sini karena `farmasi.stok_pakai_batch` mati)
 *    meneruskan `no_faktur=""`. Nomor fakturnya hanya ada sebagai kata pertama
 *    di dalam `keterangan` -- terbukti pada 5.374 baris `Pengadaan`, seluruhnya
 *    ber-`no_faktur=''`. Menautkannya berarti bergantung pada penguraian teks
 *    bebas yang bentuknya berbeda antar cabang kode Khanza.
 *
 * `pembelian.no_faktur` sebagai pemangkas jauh lebih murah dan tidak bergantung
 * pada cabang mana pun: ia PRIMARY KEY.
 */

/**
 * Bentuk barisnya tinggal di `core/pengadaan.ts`, bukan di sini -- pola yang
 * sama dengan `BarisDaruratStok`. Yang merangkai pesannya adalah `core/`, dan
 * ia tidak boleh mengimpor `khanza/` (yang menarik koneksi database ke dalam
 * bundel klien saat dipakai pratinjau dashboard). Jadi arah impornya satu:
 * `khanza/` -> `core/`.
 */

/**
 * Batas baris jendela pindai.
 *
 * Diukur: 2,21 faktur per hari aktif selama 30 hari terakhir, dan 910 faktur
 * sepanjang dua setengah tahun. Jendela seminggu karena itu berisi belasan
 * baris, bukan ratusan -- batas ini jaring pengaman terhadap instalasi yang
 * jauh lebih ramai, bukan angka yang akan menggigit di sini.
 */
const BATAS_JENDELA = 300;

/**
 * Pemangkas `no_faktur` -- PRIMARY KEY, terurut leksikal, dan tanggalnya berasal
 * dari sumber yang berbeda dari `tgl_beli`. Perbedaan itu yang membuatnya BENAR
 * untuk keperluan ini.
 *
 * Bentuknya `PG` + `YYYYMMDD` + urutan 3 digit. `DlgPembelian.java:1759` merakit
 * prefiksnya lewat `Valid.autoNomer3` dari isi kotak **Tanggal Beli** pada saat
 * nomornya dibuatkan -- dan kotak itu bawaannya hari ini.
 *
 * ==========================================================================
 * Arahnya diukur, bukan diasumsikan
 * ==========================================================================
 *
 * Atas seluruh 910 baris di database ini:
 *
 *   prefiks LEBIH MAJU daripada `tgl_beli`     9 baris (sampai 31 hari)
 *   prefiks LEBIH MUNDUR daripada `tgl_beli`   0 baris
 *
 * Nol pada arah mundur itu yang menentukan. Artinya alurnya selalu: nomor
 * dibuatkan hari ini (prefiks = hari ini), lalu `tgl_beli` digeser MUNDUR ke
 * tanggal nota pemasok yang sebenarnya. Jadi prefiks `no_faktur` adalah penanda
 * "kapan ini DIMASUKKAN", sementara `tgl_beli` adalah "kapan notanya tertanggal"
 * -- dan yang dibutuhkan pemicu justru yang pertama.
 *
 * Kalau `tgl_beli` yang dipakai sebagai pemangkas, nota bertanggal bulan lalu
 * yang dimasukkan hari ini akan jatuh di luar jendela dan tidak pernah
 * diberitahukan, tanpa satu pun galat. Itu 9 dari 910 baris di sini -- jarang,
 * tapi kelas kegagalan yang sama persis dengan prefiks `nobooking` pada
 * pembatalan BPJS, dan justru kejarangannya yang membuatnya tidak akan pernah
 * disadari.
 *
 * Jendelanya tetap merentang KE DUA ARAH: staf yang mengubah Tanggal Beli
 * SEBELUM menekan tombol nomor akan menghasilkan prefiks yang mengikuti tanggal
 * pilihannya, dan itu bisa jatuh di masa depan.
 */
function prefixFaktur(tanggal: string, akhir: boolean): string {
  const angka = tanggal.replace(/-/g, '');
  return `PG${angka}${akhir ? '999' : '000'}`;
}

function buildHeaderSql(): string {
  return `
    SELECT
      b.no_faktur, b.tgl_beli,
      COALESCE(s.nama_suplier, '') AS nama_suplier,
      COALESCE(pt.nama, '')        AS nama_petugas,
      COALESCE(g.nm_bangsal, '')   AS nm_bangsal,
      b.total1, b.potongan, b.ppn, b.tagihan
    FROM pembelian b
    LEFT JOIN datasuplier s ON s.kode_suplier = b.kode_suplier
    LEFT JOIN petugas pt    ON pt.nip = b.nip
    LEFT JOIN bangsal g     ON g.kd_bangsal = b.kd_bangsal
    WHERE b.no_faktur >= :awalPrefix AND b.no_faktur <= :akhirPrefix
    ORDER BY b.no_faktur ASC
    LIMIT ${BATAS_JENDELA}
  `;
}

/**
 * Seluruh join di sini LEFT, dan itu koreksi atas Khanza yang disengaja.
 *
 * Layar Khanza menampilkan pembelian lewat INNER JOIN ke `datasuplier` dan
 * `petugas`; sebuah faktur yang pemasoknya sudah dihapus dari master karena itu
 * hilang sama sekali dari daftar. Untuk layar yang dibuka orang, hilangnya satu
 * baris lama terlihat dan bisa ditelusuri. Untuk PEMICU, hilangnya berarti satu
 * pembelian yang benar-benar terjadi tidak pernah diberitahukan, tanpa satu pun
 * galat. `COALESCE(...,'')` melengkapinya: nama yang kosong ditangani sebagai
 * variabel kosong di template, bukan sebagai baris yang lenyap.
 */
export async function pollPengadaanJendela(dariTanggal: string, sampaiTanggal: string): Promise<BarisPengadaan[]> {
  return sikSelect<BarisPengadaan>(buildHeaderSql(), {
    awalPrefix: prefixFaktur(dariTanggal, false),
    akhirPrefix: prefixFaktur(sampaiTanggal, true),
  });
}

/**
 * Rincian barang -- query TERPISAH, bukan satu join yang menggandakan header.
 *
 * Satu faktur berisi 5,7 barang rata-rata dan 58 pada yang terbanyak; menjoinkan
 * keduanya berarti setiap kolom header (termasuk keempat angka rupiahnya)
 * berulang sebanyak barangnya, lalu harus dibuang lagi di sisi Node. Dua query
 * dengan `IN` lebih murah DAN menghasilkan bentuk yang langsung dipakai:
 * satu pesan per faktur, dengan daftar barang di dalamnya.
 *
 * `sertakanHarga` menentukan kolom harga di-SELECT atau TIDAK SAMA SEKALI --
 * bentuk yang sama dengan `farmasi.stok_pakai_batch` dan `sertakan_diagnosa`:
 * pengaturannya dibaca PEMANGGIL lalu diserahkan sebagai parameter, karena modul
 * `khanza/` tidak boleh menyentuh pengaturan (batas itu yang membuat
 * `npm run verify:db` bisa membuktikan `sik` hanya dibaca). Saat mati, harga
 * beli pemasok tidak sekadar tidak dirender -- ia tidak pernah sampai ke proses
 * ini (§5.2).
 *
 * `kadaluarsa` sengaja TIDAK diambil, dan itu temuan dari data bukan pilihan
 * gaya: dari 1.257 baris detail sepanjang 2026, **251 (20%) sudah lewat pada
 * hari barangnya dibeli**. Kolom itu jelas tidak diisi dengan disiplin di sini,
 * dan mencetak "kadaluarsa 2025-02-28" pada barang yang dibeli hari ini
 * membuat seluruh pesannya terbaca sebagai sistem rusak -- lalu yang benar ikut
 * tidak dipercaya.
 */
export async function ambilDetailPengadaan(
  noFaktur: string[],
  sertakanHarga: boolean,
): Promise<BarisDetailPengadaan[]> {
  if (noFaktur.length === 0) return [];
  return sikSelect<BarisDetailPengadaan>(buildDetailSql(sertakanHarga), { fakturs: noFaktur });
}

function buildDetailSql(sertakanHarga: boolean): string {
  return `
    SELECT
      d.no_faktur, d.kode_brng,
      COALESCE(br.nama_brng, '') AS nama_brng,
      COALESCE(sat.satuan, '')   AS satuan,
      d.jumlah${sertakanHarga ? ',\n      d.h_beli, d.total' : ''}
    FROM detailbeli d
    LEFT JOIN databarang br  ON br.kode_brng = d.kode_brng
    LEFT JOIN kodesatuan sat ON sat.kode_sat = d.kode_sat
    WHERE d.no_faktur IN (:fakturs)
    ORDER BY d.no_faktur ASC, br.nama_brng ASC
  `;
}

/** Jendela penuh terbaca = tanda ada yang mungkin luput; dipakai runner untuk memperingatkan. */
export const JENDELA_PENGADAAN_PENUH = BATAS_JENDELA;

/**
 * TANPA izin pindai penuh untuk keduanya, dan itu bukan keberuntungan.
 *
 * Header masuk lewat PRIMARY (`no_faktur` adalah PK, dan prefiksnya terurut
 * leksikal), rincian lewat indeks `no_faktur` di `detailbeli`. Keduanya `range`
 * / `ref`, jadi izinnya tidak perlu ditulis -- dan sengaja TIDAK ditulis walau
 * "aman kalau ada": izin pindai penuh yang menganggur adalah izin yang diam-diam
 * menutupi kemunduran berikutnya (lihat catatan di `stokDarurat.ts`).
 */
registerPlanCheck({
  name: 'FARMASI_PENGADAAN',
  sql: buildHeaderSql(),
  replacements: { awalPrefix: prefixFaktur('2026-08-01', false), akhirPrefix: prefixFaktur('2026-08-14', true) },
  maxRows: 5000,
});

/**
 * Varian berharga didaftarkan TERPISAH dari yang tanpa harga.
 *
 * Bentuk SQL yang berbeda adalah bentuk yang belum terperiksa -- alasan yang
 * sama persis dengan `FARMASI_STOK_DARURAT_JENIS`. Di sini perbedaannya cuma
 * dua kolom tambahan di SELECT, yang memang tidak mengubah rencana; justru
 * karena itu pemeriksaannya murah, dan asumsi "tidak mengubah rencana" adalah
 * hal yang harus GAGAL berisik kalau suatu saat keliru.
 */
registerPlanCheck({
  name: 'FARMASI_PENGADAAN_DETAIL',
  sql: buildDetailSql(false),
  replacements: { fakturs: ['PG20260807001'] },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PENGADAAN_DETAIL_HARGA',
  sql: buildDetailSql(true),
  replacements: { fakturs: ['PG20260807001'] },
  maxRows: 5000,
});
