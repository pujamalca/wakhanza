/**
 * Nama penjamin/cara bayar sebuah kunjungan -- `penjab.png_jawab`, BUKAN
 * `reg_periksa.kd_pj`.
 *
 * Kode `A02` tidak memberi tahu pasien apa pun; `BPJS Kesehatan` memberi tahu
 * segalanya. Karena itu query pemicu (`khanza/antrian.ts` dan kawan-kawan)
 * meng-SELECT `pj.png_jawab` saja dan TIDAK pernah `r.kd_pj` -- kodenya
 * memang dibutuhkan untuk join, tapi tidak pernah ikut keluar dari SQL. Sekali
 * kolomnya tidak ada di tipe barisnya, merender kodenya bukan cuma terlarang,
 * melainkan mustahil. Prinsip yang sama dipakai untuk kolom sensitif di
 * ARCHITECTURE §5.2.
 *
 * DUA hal yang gampang keliru, dan keduanya sudah pernah dibayar di tempat
 * lain di proyek ini:
 *
 * 1. **`penjab.status` sengaja TIDAK disaring.** Pelajaran `d.status='1'` DAN
 *    `p.status='1'` pada jadwal dokter berlaku untuk pertanyaan "layanan apa
 *    yang masih dilayani" -- di sana baris mati harus dibuang, kalau tidak
 *    pasien disuruh datang ke poli yang sudah tutup. Di sini pertanyaannya
 *    berbeda: siapa penjamin sebuah kunjungan yang SUDAH terjadi. Asuransi
 *    yang dinonaktifkan bulan lalu tetap penjamin kunjungan bulan lalu, dan
 *    menyaringnya akan mengganti fakta yang benar dengan kekosongan.
 *
 * 2. **`-` adalah penanda "tidak diisi", bukan nama.** Tabel `penjab` di
 *    instalasi ini punya baris `kd_pj = '-'` yang `png_jawab`-nya juga `'-'`
 *    (`khanza/pasienSegment.ts`'s `listPenjab()` sudah membuangnya dari daftar
 *    pilihan dengan alasan yang sama). Meneruskannya apa adanya menghasilkan
 *    pesan berbunyi "Cara bayar: -", yang bagi pasien terbaca seperti sistem
 *    yang rusak. Dikembalikan sebagai string kosong supaya perlakuannya sama
 *    dengan variabel lain yang tidak terisi.
 *
 * Fungsi ini MURNI dan berdiri sendiri justru karena ada ENAM pemanggil
 * (lima poller + scheduler BOOK_REMIND). Penurunan yang sama ditafsirkan
 * sendiri-sendiri di enam tempat adalah bentuk kegagalan yang sudah dibayar
 * di `respectsOptOut()`, `core/outboxStatus.ts`, dan `kunciPesanMasuk()`:
 * cukup satu yang berbeda untuk membuat satu pemicu diam-diam berperilaku
 * lain, tanpa satu pun galat.
 */

/** Nilai `png_jawab` yang berarti "tidak diisi" alih-alih sebuah nama. */
const BUKAN_NAMA = new Set(['-', '--', 'null', 'undefined']);

/**
 * Ubah `penjab.png_jawab` mentah jadi teks yang layak dibaca pasien.
 *
 * Mengembalikan string kosong bila tidak ada penjamin yang berarti -- bukan
 * `'-'`, bukan `'Umum'` karangan kita. Menebak "Umum" akan salah: `UMUM` ada
 * sebagai baris `penjab` tersendiri (`A01`), jadi kekosongan di sini berarti
 * datanya memang belum diisi petugas, bukan bahwa pasiennya bayar sendiri.
 */
export function namaPenjamin(pngJawab: string | null | undefined): string {
  const teks = (pngJawab ?? '').trim();
  if (!teks) return '';
  return BUKAN_NAMA.has(teks.toLowerCase()) ? '' : teks;
}
