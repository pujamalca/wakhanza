import type { JamRekap } from './rekapJadwal';

/**
 * JADWAL REKAP BULANAN -- matematika tanggal dan bulan. Fungsi murni, tanpa
 * database.
 *
 * ==========================================================================
 * Kenapa TIDAK menumpang `core/rekapJadwal.ts`
 * ==========================================================================
 *
 * Berkas itu memegang jadwal HARIAN, dan penandanya menyimpan TANGGAL (lalu,
 * sejak migrations/044, tanggal berikut slotnya). Bentuk itu tidak bisa dipakai
 * di sini, dan bukan karena kurang lengkap melainkan karena ia menjawab
 * pertanyaan yang berbeda: yang harian bertanya "apakah HARI INI sudah dikirim",
 * yang bulanan bertanya "apakah BULAN ITU sudah dikirim". Dua pertanyaan yang
 * jawabannya kebetulan sama-sama string.
 *
 * Melebarkan `slotJatuhTempo()` supaya melayani keduanya berarti mengubah
 * perilaku tiga fitur yang sedang berjalan di produksi sebagai efek samping
 * penambahan fitur yang tidak meminta itu -- kejutan yang sudah dihindari saat
 * `jatuhTempoHarian()` sengaja tidak disentuh di migrations/044, dan saat rekap
 * penjualan menolak menyentuh jam tenang keempat pemicu nota barang
 * (migrations/041).
 *
 * `bacaJamRekap()` justru DIPAKAI BERSAMA: "pukul berapa" adalah pertanyaan yang
 * benar-benar sama di kedua tempat, dan dua penurunan untuk itu adalah dua
 * kesempatan berbeda tafsir soal apakah `24:00` sah.
 *
 * ==========================================================================
 * Rekap bulanan yang TERLEWAT justru DIKEJAR -- kebalikan dari slot harian
 * ==========================================================================
 *
 * `slotJatuhTempo()` sengaja tidak mengejar slot yang terlewat, karena isi rekap
 * harian dihitung PADA SAAT KIRIM: dua slot yang dikejar sekaligus menghasilkan
 * dua pesan yang isinya nyaris sama persis berjarak beberapa detik.
 *
 * Di sini alasan itu tidak berlaku, dan kebalikannya yang benar: isinya bulan
 * yang sudah TUTUP, jadi angkanya tidak berubah sedikit pun antara tanggal 3 dan
 * tanggal 20. Worker yang mati sepekan lalu hidup lagi tetap mengirim rekap yang
 * benar dan utuh -- dan membuangnya berarti sebulan penuh data hilang tanpa satu
 * pun cara mendapatkannya kembali selain menyalakannya lagi bulan depan.
 */

/**
 * Tanggal kirim dibatasi 1-28.
 *
 * Alasan yang sama persis dengan `dayOfMonth` pada `broadcast_schedule`
 * (`core/schedule.ts`): tanggal 29-31 tidak ada di Februari, sehingga jadwal
 * "tiap tanggal 30" akan melewatkan satu bulan setiap tahun tanpa satu pun galat
 * -- dan yang terlihat cuma rekap Februari yang tidak pernah datang.
 *
 * Menjepitnya ke akhir bulan (30 -> 28) adalah bentuk perbaikan yang lebih buruk
 * daripada penolakan: ia membuat setelan yang tersimpan berbeda dari yang
 * dijalankan, dan staf yang memeriksanya kembali menemukan angka yang ia tulis
 * sendiri sementara pengirimannya jatuh di hari lain.
 */
export const TANGGAL_KIRIM_MIN = 1;
export const TANGGAL_KIRIM_MAKS = 28;

/** Tanggal kirim bawaan bila pengaturannya kosong atau tidak terbaca. */
export const TANGGAL_KIRIM_BAWAAN = 3;

/** Jam kirim bawaan. Pagi hari kerja -- bulannya sudah tutup, tidak ada yang dikejar. */
export const JAM_REKAP_BULANAN_BAWAAN: JamRekap = { jam: 8, menit: 0 };

/**
 * Baca tanggal kirim dari pengaturan.
 *
 * `null` untuk apa pun di luar 1-28, dan PEMANGGIL yang memutuskan artinya --
 * pembagian yang sama dengan `bacaJamRekap()`: server action MENOLAK simpan di
 * depan orang yang bisa membetulkannya, worker jatuh ke bawaan berikut `warn`
 * karena pukul delapan pagi tanggal 3 tidak ada siapa-siapa untuk diberi tahu.
 */
export function bacaTanggalKirim(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n)) return null;
  if (n < TANGGAL_KIRIM_MIN || n > TANGGAL_KIRIM_MAKS) return null;
  return n;
}

/**
 * Bulan yang direkap: bulan SEBELUM bulan yang sedang berjalan, `"YYYYMM"`.
 *
 * Tidak ada offset yang bisa disetel, dan itu keputusan. Rekap bulanan hanya
 * punya satu arti yang masuk akal -- bulan yang sudah tutup -- dan bulan berjalan
 * selalu setengah jadi. Menyediakan offset berarti menyediakan cara menghasilkan
 * angka yang salah tanpa satu pun galat.
 *
 * `setMonth` dipakai apa adanya (bukan aritmetika sendiri) supaya pergantian
 * tahun ditangani Node -- pola yang sama dengan `hariRekap()` dan
 * `sasaranKontrol()`. Tanggal disetel ke 1 LEBIH DULU: `setMonth` pada tanggal 31
 * meluber ke bulan berikutnya (31 Maret dikurangi sebulan menjadi 3 Maret, bukan
 * 28 Februari), sehingga rekap yang dikirim tanggal 29-31 akan menyebut bulan
 * yang keliru. Tanggal kirim memang dijepit di 28, tapi `sekarang` di sini adalah
 * jam dinding sungguhan dan bisa jatuh di tanggal berapa pun saat worker
 * mengejar rekap yang terlewat.
 */
export function bulanRekap(sekarang: Date): string {
  const d = new Date(sekarang);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * `"202607"` menjadi `"Juli 2026"`.
 *
 * Bentuk yang tidak dikenali dikembalikan APA ADANYA, bukan string kosong.
 * Alasannya berbeda dari `formatTanggalDokumen()`, yang justru mengosongkan
 * penanda tanggal nol Khanza: di sana nilainya datang dari kolom milik orang lain
 * dan "0000-00-00" memang berarti kosong, di sini nilainya kita sendiri yang
 * susun -- jadi bentuk asing berarti ada yang salah di kode ini, dan
 * mengosongkannya menghapus satu-satunya petunjuk ke arahnya.
 */
export function labelBulan(ym: string): string {
  const cocok = /^(\d{4})(\d{2})$/.exec(ym);
  if (!cocok) return ym;
  const bulan = Number(cocok[2]);
  if (bulan < 1 || bulan > 12) return ym;
  return `${NAMA_BULAN[bulan - 1]} ${cocok[1]}`;
}

/**
 * Bulan berikutnya sesudah `ym`, `"YYYYMM"`. Dipakai menyusun batas ATAS rentang.
 */
export function bulanSesudah(ym: string): string {
  const cocok = /^(\d{4})(\d{2})$/.exec(ym);
  if (!cocok) return ym;
  const tahun = Number(cocok[1]);
  const bulan = Number(cocok[2]);
  if (bulan >= 12) return `${tahun + 1}01`;
  return `${tahun}${String(bulan + 1).padStart(2, '0')}`;
}

/**
 * `n` bulan SEBELUM `ym`, `"YYYYMM"`. Pasangan `bulanSesudah()`.
 *
 * Dipakai menyusun jendela beberapa bulan ke belakang -- sejauh ini cuma daftar
 * pilihan "kecualikan tindakan" di `/administrasi?tab=bulanan`, yang berangkat
 * dari tindakan yang benar-benar dikerjakan alih-alih dari katalog 1.312 baris.
 *
 * Aritmetika bulan MURNI, tidak lewat `Date`. `setMonth()` pada tanggal 31 meluber
 * ke bulan berikutnya (31 Maret dikurangi sebulan menjadi 3 Maret), dan
 * `bulanRekap()` harus menyetel tanggal ke 1 lebih dulu justru karena itu. Di sini
 * tidak ada tanggal sama sekali, jadi jebakannya tidak punya tempat untuk hidup.
 */
export function bulanSebelum(ym: string, n = 1): string {
  const cocok = /^(\d{4})(\d{2})$/.exec(ym);
  if (!cocok) return ym;
  const total = Number(cocok[1]) * 12 + (Number(cocok[2]) - 1) - n;
  if (total < 0) return ym;
  return `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Bulan mana yang jatuh tempo SEKARANG, atau `null` bila belum/sudah.
 *
 * Tiga syarat, dan urutan pemeriksaannya tidak mengubah hasil -- semuanya harus
 * benar:
 *
 *  1. tanggal hari ini sudah mencapai tanggal kirim;
 *  2. jam hari ini sudah melewati jam kirim, TAPI hanya diperiksa pada tanggal
 *     kirim itu sendiri. Pada tanggal SESUDAHNYA jamnya tidak lagi menahan apa
 *     pun: worker yang baru hidup tanggal 20 pukul 02:00 sedang mengejar rekap
 *     yang terlewat, dan menahannya sampai pukul 08:00 hanya menunda sesuatu yang
 *     sudah terlambat tujuh belas hari;
 *  3. bulan targetnya belum tercatat di penanda.
 *
 * Perbandingan penanda memakai `>=`, bukan `!==` -- pelajaran `slotJatuhTempo()`,
 * lewat urutan tindakan yang sepenuhnya wajar dan bentuknya sedikit berbeda di
 * sini: staf yang membetulkan jam server mundur sehari, atau baris `app_setting`
 * yang dipulihkan dari cadangan yang lebih baru, akan membuat penanda memuat
 * bulan yang LEBIH BARU daripada target. Dengan `!==` itu terbaca sebagai "belum
 * dikirim" lalu mengirim ulang rekap yang sudah berangkat; dengan `>=` ia diam.
 */
export function bulanJatuhTempo(
  sekarang: Date,
  tanggalKirim: number,
  jamKirim: JamRekap,
  penandaTerakhir: string | null | undefined,
): string | null {
  const tanggalHariIni = sekarang.getDate();
  if (tanggalHariIni < tanggalKirim) return null;

  if (tanggalHariIni === tanggalKirim) {
    const menitSekarang = sekarang.getHours() * 60 + sekarang.getMinutes();
    if (menitSekarang < jamKirim.jam * 60 + jamKirim.menit) return null;
  }

  const target = bulanRekap(sekarang);
  const penanda = (penandaTerakhir ?? '').trim();
  if (penanda && penanda >= target) return null;
  return target;
}

/**
 * Bentuk normal untuk disimpan kembali ke pengaturan.
 *
 * Sengaja SAMA dengan bentuk `bulanRekap()` -- penanda dan target dibandingkan
 * langsung sebagai string di `bulanJatuhTempo()`, dan `"YYYYMM"` adalah salah
 * satu dari sedikit bentuk tanggal yang urutan leksikalnya sama dengan urutan
 * waktunya. Bentuk yang lebih enak dibaca (`"Juli 2026"`) akan membuat
 * perbandingan itu diam-diam salah pada pergantian tahun.
 */
export function tulisPenandaBulan(ym: string): string {
  return ym;
}
