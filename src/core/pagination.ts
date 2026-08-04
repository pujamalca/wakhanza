/**
 * Satu sumber kebenaran untuk paginasi seluruh dashboard.
 *
 * Sebelum berkas ini ada, komponen `Pagination` memang sudah dipakai bersama --
 * tapi itu TAMPILANNYA saja. Penurunan angkanya (baca `?page`, hitung offset,
 * hitung total halaman) disalin di tiap halaman dengan tiga nama konstanta
 * berbeda (`PAGE_SIZE`, `JUMLAH_PER_HALAMAN`, `PER_HALAMAN`) dan **dua tafsir
 * yang berbeda**, dan selisih tafsir itulah yang jadi bug:
 *
 * ```ts
 * const page = Math.max(1, Number(pageParam) || 1);  // audit, log, antrean
 * const halaman = Math.min(page, totalHalaman);       // nomor-bermasalah saja
 * ```
 *
 * Tanpa batas ATAS, `?page=999` menampilkan tabel kosong dengan tombol
 * "Sebelumnya" yang menuju halaman 998 -- juga kosong. Petugas yang sampai ke
 * sana tidak punya jalan kembali selain menyunting URL sendiri, dan yang
 * terlihat di layar persis sama dengan "memang tidak ada datanya".
 *
 * Bentuk kegagalan yang sama sudah dibayar berkali-kali di proyek ini
 * (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`): beberapa
 * tempat berjauhan menafsirkan sendiri satu hal yang sama, dan cukup satu yang
 * berbeda untuk membuat satu halaman diam-diam berperilaku lain.
 *
 * ## Kenapa DUA fungsi, bukan satu
 *
 * Menjepit halaman ke `totalHalaman` menuntut `count` sudah diketahui,
 * sementara query barisnya menuntut `offset` sudah diketahui -- telur dan ayam.
 * Karena itu urutannya dipecah:
 *
 * ```ts
 * const diminta = bacaHalaman(sp.page);
 * const jumlah = await Model.count({ where });
 * const p = hitungPaginasi(diminta, jumlah, UKURAN_HALAMAN.riwayat);
 * const rows = await Model.findAll({ where, order, limit: p.limit, offset: p.offset });
 * ```
 *
 * Tetap dua query, persis seperti `findAndCountAll` yang digantikannya -- yang
 * berubah cuma urutannya, dan itu yang membuat jepitannya mungkin.
 */

/**
 * Ukuran halaman, dinamai menurut JENIS daftarnya alih-alih ditulis sebagai
 * angka telanjang di tiap halaman.
 *
 * Angka `25` di dalam berkas halaman tidak memberi tahu siapa pun kenapa ia
 * bukan 50; namanya yang membawa keputusannya. Barisnya pun memang berbeda
 * bentuk: baris konfigurasi memuat tombol aksi dan teks berbaris-baris,
 * sementara baris riwayat rata-rata satu baris.
 */
export const UKURAN_HALAMAN = {
  /** Daftar yang tumbuh sendiri seiring lalu lintas: antrean, log kirim, audit, pesan masuk, daftar tolak, nomor bermasalah. */
  riwayat: 50,
  /** Daftar yang tumbuh karena staf menambahkannya: pengguna, aturan balasan, jadwal broadcast, template, tujuan farmasi, grup. */
  konfigurasi: 25,
} as const;

export interface Paginasi {
  /** Halaman yang BENAR-BENAR ditampilkan -- sudah dijepit ke rentang yang ada. */
  halaman: number;
  totalHalaman: number;
  /** Jumlah baris yang cocok, sebelum dipotong halaman. */
  jumlah: number;
  limit: number;
  offset: number;
}

/**
 * Membaca `?page` dari query string menjadi nomor halaman yang diminta.
 *
 * Belum dijepit ke batas atas -- `hitungPaginasi()` yang mengerjakannya, karena
 * batas itu baru diketahui sesudah `count`. Yang dijaga di sini cuma batas
 * bawah dan masukan yang bukan bilangan bulat positif: `Number()` menerima
 * `'1e9'`, `'  3  '`, `'2.7'`, dan `'-5'` tanpa mengeluh, dan ketiganya
 * berujung pada `OFFSET` yang tidak masuk akal.
 */
export function bacaHalaman(param: string | string[] | undefined): number {
  const teks = Array.isArray(param) ? param[0] : param;
  const angka = Number(teks);
  if (!Number.isFinite(angka)) return 1;
  return Math.max(1, Math.floor(angka));
}

/**
 * Menghitung seluruh angka paginasi sesudah jumlah baris diketahui.
 *
 * `totalHalaman` minimal 1 walau nol baris: halaman kosong tetap "halaman 1
 * dari 1", bukan "halaman 1 dari 0" yang terbaca seperti kerusakan.
 */
export function hitungPaginasi(halamanDiminta: number, jumlah: number, ukuran: number): Paginasi {
  const limit = Math.max(1, Math.floor(ukuran));
  const totalHalaman = Math.max(1, Math.ceil(Math.max(0, jumlah) / limit));
  // Inilah jepitan yang dulu hanya dipunyai satu halaman. Tanpa ini, nomor
  // halaman di luar rentang menghasilkan tabel kosong yang tak bisa ditinggalkan.
  const halaman = Math.min(Math.max(1, halamanDiminta), totalHalaman);
  return { halaman, totalHalaman, jumlah: Math.max(0, jumlah), limit, offset: (halaman - 1) * limit };
}

/**
 * Merakit URL halaman ke-N sambil MEMPERTAHANKAN parameter penyaring.
 *
 * Tiap halaman dulu merakitnya sendiri dengan rantai
 * `[a ? \`a=${a}\` : '', ...].filter(Boolean).join('&')` berikut
 * `encodeURIComponent` yang dipanggil manual satu per satu -- gampang terlewat
 * pada parameter yang ditambahkan belakangan, dan parameter yang terlewat
 * membuat tombol "Berikutnya" membuang saringan yang sedang aktif. Petugas
 * membacanya sebagai "pasiennya punya puluhan pesan gagal", bukan sebagai
 * saringan yang hilang.
 *
 * Nilai kosong/null/undefined dibuang, jadi pemanggil boleh menyerahkan
 * seluruh saringannya apa adanya tanpa memeriksa satu per satu lebih dulu.
 *
 * **Larik dipertahankan sebagai kunci berulang** (`?kab=A&kab=B`), bukan
 * digabung jadi satu nilai berkoma -- itu bentuk yang dihasilkan `<select
 * multiple>`/checkbox dan yang dibaca kembali oleh `searchParams`. Menggabungkannya
 * berarti pilihan wilayah/cara bayar pulih sebagai SATU pilihan bernama "A,B"
 * yang tidak cocok dengan apa pun. Di `/broadcast-terjadwal` akibatnya lebih
 * dari sekadar saringan hilang: query string yang sama juga mengisi form "buat
 * jadwal baru", jadi menekan Berikutnya akan mengosongkan form yang sedang
 * disusun staf.
 */
export function hrefHalaman(
  path: string,
  saringan: Record<string, string | number | readonly string[] | null | undefined>,
  halaman: number,
  namaParam: string = 'page',
): string {
  const params = new URLSearchParams();
  for (const [kunci, nilai] of Object.entries(saringan)) {
    if (nilai === null || nilai === undefined) continue;
    for (const satu of Array.isArray(nilai) ? nilai : [nilai]) {
      const teks = String(satu);
      if (teks === '') continue;
      params.append(kunci, teks);
    }
  }
  // Ditulis TERAKHIR dan lewat `set`, bukan `append`: nomor halaman yang tak
  // sengaja ikut di saringan harus kalah, bukan menumpuk jadi dua nilai.
  //
  // `namaParam` ada karena satu halaman bisa memuat DUA tabel yang berdiri
  // sendiri (`/pesan-masuk`: pesan dan grup). Menamai keduanya `page` membuat
  // tombol di satu tabel ikut menggeser tabel satunya, dan yang terlihat adalah
  // baris yang "hilang" tanpa sebab. Tabel kedua memakai namanya sendiri
  // (mis. `gpage`) sambil MEMBAWA halaman tabel pertama lewat `saringan`.
  params.set(namaParam, String(halaman));
  return `${path}?${params.toString()}`;
}
