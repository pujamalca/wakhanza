/**
 * Menyeberangkan waktu ke SQL mentah tanpa kehilangan tujuh jam.
 *
 * ==========================================================================
 * Jebakannya, diukur bukan dibaca dari dokumentasi
 * ==========================================================================
 *
 * Objek `Date` yang diserahkan lewat `replacements` pada `db.query()` TIDAK
 * sampai sebagai UTC. Ia diserialisasi ke waktu LOKAL server:
 *
 *   new Date('2026-08-15T01:03:40Z')  ->  SQL menerima '2026-08-15 08:03:40'
 *
 * Sementara kolom DATETIME di database `wakhanza` menyimpan UTC (Sequelize
 * memakai `timezone: '+00:00'`, sehingga `NOW()` dan `UTC_TIMESTAMP()` di sesi
 * itu bernilai sama). Akibatnya setiap perbandingan `kolom >= :tanggal` meleset
 * TEPAT TUJUH JAM di mesin berzona WIB -- dan melesetnya ke arah yang paling
 * senyap: query tetap berhasil, tetap mengembalikan baris yang masuk akal,
 * cuma jendelanya bukan jendela yang diminta.
 *
 * Terukur atas batas yang sama persis, tiga jalur:
 *
 *   lewat model `Op.gte`      -> 10 baris   (BENAR)
 *   lewat `replacements` Date ->  0 baris   (salah 7 jam)
 *   lewat literal SQL UTC     -> 10 baris   (BENAR)
 *
 * Jadi yang terkena HANYA `db.query()` mentah. Jalur model Sequelize
 * (`findAll`, `count`, `Op.gte`, `destroy`) aman dan tidak perlu disentuh --
 * itulah kenapa pemangkasan `cleanup.ts` dan dispatcher tidak pernah keliru.
 *
 * KERABAT dari jebakan yang sudah tercatat di CLAUDE.md ("baris yang di-INSERT
 * lewat SQL mentah tidak cocok dengan `Op.lte` Sequelize"), tapi bukan yang
 * sama: yang itu soal nilai yang DITULIS di luar Sequelize, yang ini soal nilai
 * yang DIBANDINGKAN dari dalamnya.
 *
 * ==========================================================================
 * Dua jalan keluar, dan kapan memakai yang mana
 * ==========================================================================
 *
 * 1. Bila batasnya RELATIF ("enam jam terakhir"), kerjakan di SQL:
 *    `UTC_TIMESTAMP() - INTERVAL :n HOUR`. Yang menyeberang cuma bilangan
 *    bulat, jadi tidak ada yang bisa dikonversi. Dipakai `lib/ackPantau.ts`.
 *
 * 2. Bila batasnya sebuah TITIK WAKTU yang sudah dihitung di JS -- misalnya
 *    tengah malam WIB, yang bukan kelipatan jam dari sekarang -- pakai
 *    `keSqlUtc()` di bawah.
 */

/**
 * Format `Date` menjadi literal DATETIME MariaDB dalam **UTC**.
 *
 * `toISOString()` selalu UTC apa pun zona server, jadi tidak ada tempat bagi
 * zona lokal untuk menyelinap masuk -- itu seluruh gunanya. Bagian milidetik
 * dibuang karena kolomnya DATETIME tanpa presisi pecahan; membiarkannya
 * membuat MariaDB membulatkan diam-diam, yang bisa menggeser batas satu detik.
 */
export function keSqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Selisih zona server terhadap UTC, dalam MENIT (WIB = +420).
 *
 * Dipakai untuk MENGELOMPOKKAN baris per hari kalender lokal: kolomnya UTC,
 * jadi `DATE_FORMAT(created_at, '%Y-%m-%d')` mengelompokkan per hari UTC, dan
 * pesan pukul 02:00 WIB jatuh ke ember HARI SEBELUMNYA. Menambahkan offset ini
 * lebih dulu memindahkannya ke jam dinding lokal.
 *
 * Diturunkan dari `Date` dan BUKAN ditulis `'+07:00'` mati di dalam SQL, supaya
 * ia tidak bisa menyimpang dari `startOfDay()` yang memakai getter/setter Date
 * lokal: keduanya berangkat dari satu sumber yang sama, yaitu zona server.
 * Menuliskannya dua kali berarti dua tempat yang harus ingat diubah bersamaan
 * bila servernya pindah zona -- dan yang lupa tidak mendapat satu pun galat,
 * cuma grafik yang embernya bergeser.
 *
 * Sengaja menerima `pada`: zona yang memakai DST punya offset berbeda menurut
 * tanggalnya. Indonesia tidak, jadi di sini nilainya tetap -- tapi memaksa
 * pemanggil menyebutkan titik acuannya membuat asumsi itu terlihat alih-alih
 * tersembunyi.
 */
export function offsetLokalMenit(pada: Date = new Date()): number {
  return -pada.getTimezoneOffset();
}
