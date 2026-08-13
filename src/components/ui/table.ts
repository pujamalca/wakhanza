/**
 * Kelas tabel data.
 *
 * Kepala tabel memakai `text-label` (13px/500) di atas `bg-surface-sunken`,
 * bukan `text-xs` di atas `bg-muted/50` seperti sebelumnya. Dua hal yang
 * diperbaiki sekaligus:
 *
 * 1. **Kepala dan isi tabel dulu berukuran sama.** Keduanya 12px, dan satu-
 *    satunya pembedanya warna latar setengah tembus. Pada tabel panjang yang
 *    kepalanya sudah tergulir keluar layar, tidak ada apa pun yang menandai
 *    baris mana yang menamai kolom.
 * 2. **`bg-muted/50` tembus pandang**, jadi warnanya berubah mengikuti apa pun
 *    yang kebetulan ada di belakangnya -- kartu, halaman, atau kartu di dalam
 *    kartu. `--surface-sunken` bidang penuh: kepala tabel mundur satu tingkat
 *    dari permukaan yang memuatnya, sama di mana pun ia dipasang.
 *
 * Angka di dalam `<table>` otomatis TABULAR (aturan di globals.css), jadi kolom
 * jumlah dan rupiah tidak lagi bergoyang baris demi baris.
 */
export const tableWrapperClass = 'overflow-x-auto rounded-lg border';

export const theadClass =
  'bg-surface-sunken text-left text-label text-muted-foreground [&_th]:font-medium';

export const rowClass = 'border-t align-top transition-colors hover:bg-muted/40';

/**
 * `px-3 py-2` -- 12px mendatar, 8px menurun.
 *
 * Sebelumnya `p-2` seragam (8px). Padding mendatar yang sama dengan menurun
 * membuat kolom bersebelahan nyaris bersentuhan, sehingga mata membaca dua sel
 * sebagai satu; yang dibutuhkan tabel padat justru kebalikannya -- rapat ke
 * bawah (banyak baris terlihat sekaligus), lapang ke samping (kolomnya
 * terpisah).
 */
export const cellClass = 'px-3 py-2';
