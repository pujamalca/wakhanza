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

/**
 * Apakah sebuah kunjungan lolos penyaring cara bayar (migrations/048).
 *
 * Dipakai memutuskan apakah LAMPIRAN hasil/tagihan jadi dikirim -- bukan apakah
 * pesannya dikirim. Pasien yang tersaring tetap menerima pemberitahuannya, cuma
 * tanpa berkas.
 *
 * Berkunci pada KODE (`kd_pj`), bukan nama. Nama penjamin adalah teks yang bisa
 * disunting staf di Khanza, dan penyaring yang berkunci padanya berhenti cocok
 * DIAM-DIAM pada hari seseorang mengganti "BPJS Kesehatan" jadi "BPJS" -- yang
 * muncul bukan galat melainkan pasien yang berhenti menerima lampirannya.
 *
 * TIGA keputusan yang menempel, dan ketiganya bisa salah ke arah yang berbeda:
 *
 * 1. **Daftar KOSONG = semua lolos.** Itu yang membuat migrasinya nol-perubahan:
 *    rumah sakit yang tidak menyentuh setelan ini mendapat perilaku yang sama
 *    persis seperti sebelum fitur ini ada. Menafsirkannya sebagai "tidak ada yang
 *    lolos" akan mematikan lampiran yang sedang berjalan pada detik migrasinya
 *    diterapkan.
 *
 * 2. **Kode yang tidak diketahui = TIDAK lolos.** Ini penyaring berbentuk
 *    DAFTAR-IZIN, dan daftar-izin yang gagal ke arah "izinkan" bukan daftar-izin.
 *    Kunjungan yang barisnya tidak ditemukan (`null`) masuk golongan ini; toh
 *    jalur lampirannya akan gagal juga beberapa langkah kemudian, karena
 *    `ambilIdentitasKunjungan()` mengembalikan null untuk kunjungan yang sama.
 *
 * 3. **Penanda `'-'` diperlakukan sebagai kode biasa**, bukan dikosongkan seperti
 *    di `namaPenjamin()`. Bedanya karena pertanyaannya berbeda: di sana yang
 *    dicari teks yang layak DIBACA pasien, di sini yang dicari kunci yang bisa
 *    DICOCOKKAN. Akibatnya kunjungan ber-`kd_pj = '-'` tidak akan pernah lolos
 *    begitu penyaringnya dipasang, karena `'-'` memang tidak bisa dipilih dari
 *    daftar penjamin (`fetchPaymentOptions()` membuangnya). Terukur 2 dari 1.900
 *    nota dalam 90 hari; keadaannya jarang, tapi ia harus disebut alih-alih
 *    ditemukan belakangan.
 */
export function lolosSaringPenjamin(
  kdPj: string | null | undefined,
  daftarKode: readonly string[],
): boolean {
  if (daftarKode.length === 0) return true;
  const kode = (kdPj ?? '').trim();
  if (!kode) return false;
  return daftarKode.some((k) => k.trim() === kode);
}
