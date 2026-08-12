/**
 * Membandingkan apa yang PERNAH dikabarkan dengan apa yang MASIH ADA, lalu
 * memutuskan nota mana yang baru dan nota mana yang terhapus.
 *
 * ==========================================================================
 * Kenapa penghapusan menuntut ingatan, dan tidak ada jalan lain
 * ==========================================================================
 *
 * Sebuah baris yang dihapus tidak meninggalkan apa pun untuk dibaca. Poller yang
 * cuma membaca `penjualan` karena itu buta terhadapnya secara struktural: yang
 * hilang terlihat persis sama dengan yang tidak pernah ada. Satu-satunya cara
 * membedakannya adalah menyimpan sendiri daftar nota yang sudah dikabarkan --
 * itulah `penjualan_pantau` (migrations/040), dan itulah satu-satunya alasan
 * tabel itu ada.
 *
 * Alternatifnya (`riwayat_barang_medis` dengan `status='Hapus'`) ditolak lewat
 * tiga pengukuran yang berdiri sendiri -- ringkasnya: `status='Hapus'` di sana
 * tidak berarti notanya dihapus (5 dari 22 nota masih ada), biayanya `type=ALL`
 * atas 96.958 baris yang tumbuh selamanya, dan kolom keterangannya memuat nama
 * pembeli begitu fitur member Khanza dipakai. Uraian lengkapnya di
 * migrations/040_penjualan.sql.
 *
 * ==========================================================================
 * "Hilang dari jendela" SETARA DENGAN "dihapus" -- dan syarat yang membuatnya
 * benar adalah satu-satunya hal yang tidak boleh dilanggar di berkas ini
 * ==========================================================================
 *
 * Jendelanya adalah rentang atas `nota_jual`, dan `nota_jual` adalah PRIMARY KEY
 * yang tidak pernah berubah. Jadi nota yang ada di buku pantau, yang nomornya
 * jatuh DI DALAM jendela yang sedang dibaca, dan yang tidak dikembalikan
 * pembacaan itu, hanya bisa hilang karena barisnya memang tidak ada lagi.
 *
 * Syarat "DI DALAM jendela" itu yang menahan salah tafsir terbesarnya: nota
 * berumur delapan hari keluar sendiri dari jendela tujuh hari karena waktu
 * berjalan, dan tanpa syarat itu SETIAP nota yang menua akan dilaporkan
 * terhapus -- grup menerima pembatalan borongan atas penjualan yang masih hidup.
 *
 * Karena itu jendelanya diserahkan ke fungsi ini dan ditegakkan DI SINI juga,
 * bukan cuma diandalkan dari klausa WHERE pemanggilnya. Itu memang mengulang
 * batas yang sama di dua tempat, dan itu disengaja: yang diulang adalah satu
 * pagar terhadap satu-satunya kesalahan di fitur ini yang mengirim pesan SALAH
 * alih-alih tidak mengirim pesan.
 */

export interface BarisPantau {
  notaJual: string;
  generasi: number;
  /** Terisi bila penghapusannya sudah dikabarkan. NULL = masih dipantau. */
  hapusAt: Date | null;
}

export interface JendelaNota {
  /** Batas bawah nomor nota, inklusif -- mis. `PJ20260805000`. */
  awal: string;
  /** Batas atas nomor nota, inklusif -- mis. `PJ20260819999`. */
  akhir: string;
}

export interface NotaBaru {
  notaJual: string;
  /**
   * 0 untuk nota yang belum pernah dikabarkan; naik satu bila nomornya dipakai
   * ULANG sesudah penghapusan yang sudah dikabarkan. Ikut ke kunci idempoten --
   * lihat `kunciPenjualan()`.
   */
  generasi: number;
}

export interface HasilPantau {
  baru: NotaBaru[];
  terhapus: string[];
}

function diDalam(nota: string, jendela: JendelaNota): boolean {
  return nota >= jendela.awal && nota <= jendela.akhir;
}

/**
 * Kedua masukan WAJIB berasal dari jendela yang SAMA, dihitung sekali lalu
 * diserahkan ke keduanya. Menghitungnya dua kali -- sekali untuk membaca
 * `penjualan`, sekali lagi untuk membaca buku pantau -- membuat keduanya bisa
 * jatuh di sisi berlawanan dari pergantian hari, dan hasilnya adalah kabar
 * pembatalan atas nota yang sebenarnya masih ada.
 */
export function bandingkanPantau(input: {
  /** Nomor nota yang MASIH ADA di `penjualan`, dibaca dengan jendela di bawah. */
  hadir: string[];
  /** Isi buku pantau, dibaca dengan jendela yang SAMA. */
  pantau: BarisPantau[];
  jendela: JendelaNota;
}): HasilPantau {
  const { hadir, pantau, jendela } = input;

  const adaSekarang = new Set(hadir.filter((n) => diDalam(n, jendela)));
  const tercatat = new Map<string, BarisPantau>();
  for (const p of pantau) {
    if (diDalam(p.notaJual, jendela)) tercatat.set(p.notaJual, p);
  }

  const baru: NotaBaru[] = [];
  for (const nota of adaSekarang) {
    const catatan = tercatat.get(nota);
    if (!catatan) {
      baru.push({ notaJual: nota, generasi: 0 });
      continue;
    }
    /**
     * Nomor yang HIDUP LAGI sesudah penghapusannya dikabarkan.
     *
     * Bukan kasus pinggiran yang dikarang: Khanza menomori nota dari
     * `MAX(RIGHT(nota_jual,3))` untuk tanggal itu (`DlgPenjualan.java:3986`),
     * jadi menghapus nota TERAKHIR hari itu membuat nomornya dipakai ulang oleh
     * penjualan berikutnya. Tanpa generasi, penjualan baru tersebut memakai
     * kunci idempoten yang sama persis dengan yang sudah dihapus, ditolak
     * `uq_idem` sebagai duplikat, dan tidak pernah dikabarkan -- tanpa satu pun
     * galat, karena INSERT-nya memang `ignoreDuplicates`.
     */
    if (catatan.hapusAt !== null) {
      baru.push({ notaJual: nota, generasi: catatan.generasi + 1 });
    }
  }

  const terhapus: string[] = [];
  for (const p of tercatat.values()) {
    // Yang penghapusannya SUDAH dikabarkan tidak dikabarkan dua kali.
    if (p.hapusAt !== null) continue;
    if (!adaSekarang.has(p.notaJual)) terhapus.push(p.notaJual);
  }

  // Urutan nomor = urutan kejadian, karena nomornya memuat tanggal lalu urutan
  // hariannya. Grup membaca notanya berurutan alih-alih sesuai urutan Set/Map.
  baru.sort((a, b) => a.notaJual.localeCompare(b.notaJual));
  terhapus.sort((a, b) => a.localeCompare(b));

  return { baru, terhapus };
}

/**
 * Membagi kuota satu siklus antara kabar penghapusan dan kabar penjualan baru.
 *
 * PENGHAPUSAN DIDAHULUKAN, dan itu bukan selera. Ia jauh lebih jarang (22 nota
 * dalam dua setengah tahun, berbanding puluhan penjualan per hari), jadi
 * mendahulukannya praktis tidak pernah menunda apa pun. Yang dibeli: sebuah
 * KOREKSI tidak pernah mengantre di belakang tiga puluh nota baru. Terbalik,
 * satu hari sibuk cukup untuk menahan kabar pembatalan sampai besok, sementara
 * penerimanya sudah terlanjur mencatat nota yang dibatalkan itu sebagai sah.
 *
 * Sisanya TIDAK dibuang -- jendela dibaca ulang tiap siklus, jadi yang tidak
 * kebagian kuota hari ini terkirim pada siklus berikutnya.
 */
export function bagiKuota(hasil: HasilPantau, kuota: number): HasilPantau {
  const batas = Math.max(0, kuota);
  const terhapus = hasil.terhapus.slice(0, batas);
  const sisa = batas - terhapus.length;
  return { terhapus, baru: hasil.baru.slice(0, Math.max(0, sisa)) };
}
