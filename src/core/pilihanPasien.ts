/**
 * PILIHAN PASIEN -- penerima yang dicentang staf satu per satu, sebagai lawan
 * dari segmen yang diturunkan dari filter.
 *
 * Sampai modul ini ada, /broadcast dan /broadcast-terjadwal semua-atau-tidak:
 * siapa pun yang cocok dengan filter dikirimi, dan tidak ada cara mengirim ke
 * lima orang tertentu selain menyempitkan filter sampai kebetulan tinggal
 * mereka. Untuk sebagian pekerjaan itu memang benar (pengumuman ke segmen),
 * untuk sebagian lagi mustahil dipakai.
 *
 * DAFTAR INI MENGGANTIKAN SEGMEN, BUKAN MENYARINGNYA, dan itu keputusan yang
 * paling menentukan di sini. Bentuk yang satunya -- daftar sebagai filter
 * tambahan di atas filter yang sudah ada -- terlihat lebih rapi dan salah pada
 * pemakaian yang paling wajar: staf mencentang seorang pasien, lalu rentang
 * tanggal yang kebetulan masih terpasang membuangnya lagi karena kunjungan
 * terakhirnya di luar jendela. Yang muncul bukan galat melainkan pasien yang
 * dicentang sendiri lalu tidak dikirimi, tanpa satu pun keterangan. Dengan
 * daftar sebagai penerima, "saya centang lima, lima yang dikirimi" selalu benar.
 *
 * Akibat lanjutan yang disengaja: selama mode `semua`, daftar centang TIDAK
 * menyaring apa pun -- ia cuma dititipkan di query string. Itulah yang membuat
 * staf bisa mencari "Budi", mencentangnya, lalu mencari "Siti" dan mencentangnya
 * juga tanpa yang pertama hilang. Kalau daftarnya ikut menyaring saat menjelajah,
 * pencarian kedua akan selalu nol hasil.
 *
 * Fungsi murni (tanpa database) supaya halaman dan server action memakai
 * penurunan yang SAMA. Bentuk kegagalan yang dihindari sudah berkali-kali
 * dibayar di proyek ini (`respectsOptOut()`, `core/outboxStatus.ts`,
 * `kunciPesanMasuk()`, `core/tujuanPemicu.ts`): dua tempat berjauhan
 * menafsirkan sendiri satu hal yang sama, dan cukup satu yang berbeda untuk
 * membuat pratinjau menampilkan penerima yang bukan penerima sungguhan.
 */

export type ModePenerima =
  /** Semua pasien yang cocok dengan filter -- perilaku asli, dan tetap bawaannya. */
  | 'semua'
  /** Hanya no. RM yang dicentang staf. */
  | 'pilih';

/**
 * Batas jumlah yang dicentang. Bukan kebijakan produk melainkan batas bentuk:
 * daftarnya melintas sebagai query string lalu mendarat di satu `IN (...)`,
 * dan keduanya menerima apa pun yang diketik ke URL. Isi tiap unsurnya sendiri
 * aman berapa pun bentuknya -- ia diserahkan sebagai replacement Sequelize,
 * tidak pernah dirangkai ke dalam SQL.
 *
 * `broadcast.max_recipients` (bawaan 500) tetap penjaga sebenarnya saat kirim;
 * angka ini disamakan dengannya supaya batas yang menggigit lebih dulu adalah
 * batas yang punya pesan galatnya sendiri, bukan yang ini.
 */
export const MAX_PILIHAN_PASIEN = 500;

export interface HasilPilihan {
  /** No. RM unik, urut sesuai urutan dicentang, sudah dipotong ke MAX_PILIHAN_PASIEN. */
  daftar: string[];
  /**
   * True bila ada yang dibuang karena melewati batas. WAJIB dilaporkan ke
   * layar: pilihan yang menyusut diam-diam terlihat persis seperti pilihan yang
   * utuh, dan yang hilang justru yang dicentang paling akhir -- yang paling
   * segar di ingatan staf, sehingga ketiadaannya paling lama tidak disadari.
   */
  terpotong: boolean;
}

export function bacaModePenerima(raw: string | string[] | undefined): ModePenerima {
  const nilai = Array.isArray(raw) ? raw[0] : raw;
  // Apa pun selain 'pilih' jatuh ke 'semua' -- perilaku sebelum fitur ini ada.
  // Arah yang aman bila salah: yang gagal adalah "kirim ke lebih sedikit orang
  // daripada yang dimaksud", bukan sebaliknya.
  return nilai === 'pilih' ? 'pilih' : 'semua';
}

export function bacaPilihanRm(raw: string | string[] | undefined): HasilPilihan {
  if (!raw) return { daftar: [], terpotong: false };
  const masuk = Array.isArray(raw) ? raw : [raw];

  // Set menjaga urutan sisip di JS, jadi dedup di sini tidak mengacak urutan
  // centang staf -- itu yang menentukan siapa yang bertahan saat dipotong.
  const unik = new Set<string>();
  for (const nilai of masuk) {
    const bersih = String(nilai).trim();
    if (bersih) unik.add(bersih);
  }

  const semua = [...unik];
  return {
    daftar: semua.slice(0, MAX_PILIHAN_PASIEN),
    terpotong: semua.length > MAX_PILIHAN_PASIEN,
  };
}

/**
 * No. RM yang dicentang tapi TIDAK sedang tampil di tabel -- yang perlu
 * dititipkan sebagai input tersembunyi supaya centangnya bertahan saat staf
 * mengganti filter atau mencari nama lain.
 *
 * Yang sedang tampil WAJIB dikecualikan, dan inilah satu-satunya aturan di
 * fitur ini yang gagal DIAM kalau keliru: baris yang punya checkbox DAN input
 * tersembunyi sekaligus selalu mengirim nilainya, sehingga centangnya mustahil
 * dilepas. Staf menghilangkan centang, menekan Terapkan, dan pasiennya tetap
 * ada di daftar penerima -- tanpa galat, tanpa perubahan yang terlihat, dan
 * satu-satunya gejalanya adalah orang yang dikirimi pesan padahal sudah
 * dikeluarkan. Karena itu ia tinggal di sini sebagai fungsi murni berikut
 * ujinya, bukan sebagai satu baris filter di dalam komponen.
 */
export function pilihanTersembunyi(daftar: string[], tampil: Iterable<string>): string[] {
  const terlihat = tampil instanceof Set ? tampil : new Set(tampil);
  return daftar.filter((rm) => !terlihat.has(rm));
}
