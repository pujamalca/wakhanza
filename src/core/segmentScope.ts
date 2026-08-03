/**
 * Menentukan BENTUK query segmen broadcast dari filter yang dipilih staf.
 *
 * Sampai fitur ini ada, rentang tanggal kunjungan selalu terisi -- kosong pun
 * diam-diam diganti 30 hari terakhir. Itu benar untuk pemakaian aslinya
 * ("kirim ke pasien yang berkunjung belakangan ini"), tapi salah untuk yang
 * satunya lagi: mencari SATU pasien tertentu lewat nama/no. RM. Pasien yang
 * terakhir datang delapan bulan lalu tidak muncul, dan halaman tidak
 * mengatakan kenapa -- yang terlihat cuma "tidak ada pasien yang cocok",
 * persis seperti kalau namanya salah ketik.
 *
 * Karena itu tanggal jadi OPSIONAL. Konsekuensinya bukan sekadar menghapus
 * satu kondisi WHERE: rentang tanggal itulah pemangkas indeks query segmen
 * (prefix `no_rawat`, §4.4). Tanpa dia, query harus berangkat dari sisi lain
 * -- dari `pasien`, lalu masuk ke `reg_periksa` lewat indeks `no_rkm_medis`.
 * Itu dua bentuk query yang berbeda, dan modul ini yang memutuskan yang mana.
 *
 * Fungsi murni (tanpa database) supaya halaman dan server action memakai
 * keputusan yang SAMA. Kalau keduanya menafsirkan sendiri-sendiri, cukup satu
 * yang lupa diperbarui untuk membuat pratinjau menampilkan segmen yang berbeda
 * dari yang benar-benar dikirimi pesan.
 */

export type SegmentScope =
  /** Ada batas bawah tanggal -- query dipangkas lewat prefix `no_rawat` (bentuk asli). */
  | 'berjendela'
  /** Tanpa batas bawah tanggal, tapi ada filter lain -- query berangkat dari `pasien`. */
  | 'semua-waktu'
  /** Tanpa batas bawah tanggal DAN tanpa filter apa pun -- ditolak, lihat di bawah. */
  | 'tanpa-batas';

export interface SegmentScopeInput {
  dateFrom: Date | null;
  dateTo: Date | null;
  kdKab?: string[];
  kdKec?: string[];
  kdKel?: string[];
  kdPj?: string[];
  cari?: string;
}

/**
 * Yang menentukan bentuk query adalah batas BAWAH, bukan atas: `dateFrom` yang
 * mengizinkan pemangkasan lewat prefix `no_rawat`. `dateTo` sendirian ("semua
 * kunjungan sampai tanggal X") tetap tak berbatas ke belakang, jadi ia bukan
 * jendela -- ia diperlakukan sebagai batas tambahan di dalam bentuk
 * `semua-waktu`, bukan diabaikan dan juga bukan diam-diam diganti tanggal lain.
 *
 * TIDAK SEMUA FILTER SETARA di sini, dan pembedaannya mengikuti bentuk
 * query-nya, bukan selera. Bentuk `semua-waktu` berangkat dari `pasien`, jadi
 * yang bisa mempersempitnya hanyalah filter yang MELEKAT PADA PASIEN:
 * pencarian nama/no. RM, dan wilayah. Cara bayar melekat pada KUNJUNGAN, dan
 * batas atas tanggal juga -- keduanya tidak menyempitkan sisi penggerak sama
 * sekali, sehingga "semua pasien BPJS, sejak kapan pun" praktis sama saja
 * dengan seluruh isi tabel. Ditemukan dari EXPLAIN, bukan dikira-kira:
 * dengan cara bayar sebagai satu-satunya filter, optimizer membalik arah
 * join-nya dan membaca separuh `reg_periksa`.
 */
export function segmentScope(input: SegmentScopeInput): SegmentScope {
  if (input.dateFrom) return 'berjendela';

  const adaFilterPasien =
    !!input.cari?.trim() ||
    (input.kdKab?.length ?? 0) > 0 ||
    (input.kdKec?.length ?? 0) > 0 ||
    (input.kdKel?.length ?? 0) > 0;

  return adaFilterPasien ? 'semua-waktu' : 'tanpa-batas';
}

/**
 * "Tanpa tanggal dan tanpa filter pasien" = SELURUH pasien yang pernah
 * terdaftar, seumur hidup rumah sakit. Ditolak, dan alasannya dua-duanya nyata:
 *
 * - Itu bukan segmen. Tidak ada isi pesan yang masuk akal untuk "semua orang
 *   yang pernah berobat di sini", dan filter yang tidak sengaja terhapus
 *   menghasilkan persis bentuk ini -- tanpa satu pun tanda bahwa yang terpilih
 *   bukan yang dimaksud.
 * - Hasilnya sewenang-wenang, bukan sekadar besar. Query dipotong di LIMIT,
 *   jadi yang terpilih adalah sekian ratus pasien yang kebetulan terurut
 *   paling akhir -- angka yang terlihat pasti padahal isinya kebetulan.
 *
 * `broadcast.max_recipients` memang sudah menolak segmen kelewat besar, tapi
 * ia menolak SESUDAH staf menyusun pesan dan menekan Kirim. Ini menolak
 * sebelum satu baris pun dibaca.
 */
export const PESAN_TANPA_BATAS =
  'Tanpa rentang tanggal, isi minimal satu penyaring pasien: pencarian nama/no. RM/no. pendaftaran, atau wilayah. Cara bayar saja tidak cukup -- ia menyaring kunjungan, bukan pasien, jadi segmennya tetap seluruh pasien yang pernah terdaftar.';
