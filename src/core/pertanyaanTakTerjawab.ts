import { normalizeInbound } from './autoReply';

/**
 * KATA yang sering muncul di pesan masuk yang TIDAK terjawab -- diubah menjadi
 * daftar kerja penulisan aturan.
 *
 * Terukur di produksi: 207 dari 218 pesan masuk 30 hari terakhir (95%) tidak
 * pernah dibalas apa pun. Teksnya sudah tersimpan (`inbox.simpan_teks` menyala)
 * dan bisa dibaca satu per satu di /pesan-masuk, tapi membaca 207 baris untuk
 * mencari polanya adalah pekerjaan yang tidak akan pernah dilakukan siapa pun.
 * Yang hilang bukan datanya melainkan PENGELOMPOKANNYA.
 *
 * Dua hal yang membuat modul ini lebih dari sekadar penghitung kata:
 *
 * 1. Memakai `normalizeInbound()` yang SAMA dipakai pencocokan aturan. Kalau
 *    berbeda, kata yang ditampilkan di sini bukan kata yang dilihat mesin saat
 *    mencocokkan, dan staf akan menulis aturan yang tidak pernah cocok -- lalu
 *    menyimpulkan fiturnya rusak.
 * 2. Membuang kata yang SUDAH punya aturan. Tanpa itu, daftar teratas akan
 *    dikuasai kata yang justru sudah tertangani, dan yang benar-benar belum
 *    punya jawaban tenggelam di bawahnya.
 *
 * Murni: tanpa database, supaya keputusannya bisa diuji tanpa satu baris pesan
 * pasien pun.
 */

/**
 * Kata yang tidak pernah berguna sebagai kata kunci aturan.
 *
 * Sengaja SEMPIT dan berisi kata fungsi belaka -- sapaan, kata ganti, partikel,
 * angka. Daftar yang terlalu agresif akan membuang justru kata yang menandai
 * pokok pertanyaan; "obat", "dokter", "daftar" TIDAK ada di sini walau sering,
 * karena seringnya itulah yang menjadikannya kandidat aturan terbaik.
 */
const KATA_UMUM = new Set([
  'yang', 'untuk', 'dari', 'dengan', 'pada', 'ini', 'itu', 'ada', 'apa', 'apakah',
  'saya', 'aku', 'kami', 'kita', 'anda', 'kamu', 'bapak', 'ibu', 'pak', 'bu', 'mas', 'mbak',
  'di', 'ke', 'dan', 'atau', 'juga', 'sudah', 'belum', 'tidak', 'bukan', 'nya', 'nya',
  'mau', 'bisa', 'boleh', 'gimana', 'bagaimana', 'kalau', 'jika', 'biar', 'supaya',
  'ya', 'yaa', 'iya', 'oke', 'ok', 'baik', 'terima', 'kasih', 'makasih', 'maaf', 'permisi',
  'assalamualaikum', 'salam', 'halo', 'hallo', 'hai', 'selamat', 'pagi', 'siang', 'sore', 'malam',
  'tolong', 'mohon', 'min', 'admin', 'kak', 'dok', 'nih', 'sih', 'dong', 'deh', 'kok', 'lah',
  'nanti', 'tadi', 'sekarang', 'masih', 'lagi', 'saja', 'aja', 'hanya', 'cuma', 'akan',
]);

/** Kata sependek ini nyaris selalu partikel atau potongan, dan tidak pernah jadi kata kunci yang baik. */
const PANJANG_MINIMAL = 3;

/**
 * Potongan alamat web. Nomor rumah sakit menerima pesan promosi berisi tautan,
 * dan tanpa ini daftar teratas dikuasai `https`, `bit`, `com` -- kata yang tidak
 * seorang pun akan jadikan aturan.
 */
const POTONGAN_TAUTAN = new Set(['http', 'https', 'www', 'com', 'net', 'org', 'bit', 'wa', 'me', 'chat']);

/**
 * Token yang MENCAMPUR huruf dan angka: kode promo, id transaksi, plat, captcha
 * (`40y4th4`, `cd260781880`). Kata Indonesia tidak pernah berbentuk begitu, dan
 * tiap token semacam ini praktis unik sehingga tidak pernah menandai pola --
 * ia cuma memenuhi daftar dan mendorong turun kata yang sungguhan.
 *
 * Angka murni sudah dibuang terpisah; ini khusus yang bercampur.
 */
function campurHurufAngka(kata: string): boolean {
  return /[a-z]/.test(kata) && /\d/.test(kata);
}

export interface KataTakTerjawab {
  kata: string;
  /** Berapa PESAN yang memuatnya -- bukan berapa kali kata itu muncul. */
  jumlahPesan: number;
}

/**
 * @param pesan            teks mentah pesan yang tidak terjawab
 * @param kataKunciTerpasang kata kunci seluruh aturan yang ADA (aktif maupun tidak)
 * @param batas            berapa banyak yang dikembalikan
 *
 * Dihitung per PESAN, bukan per kemunculan: satu orang yang mengetik "obat obat
 * obat" tidak boleh terlihat seperti tiga orang yang menanyakan obat. Yang
 * dicari adalah berapa ORANG menanyakan hal serupa, karena itu yang menentukan
 * apakah sebuah aturan layak ditulis.
 */
export function hitungKataTakTerjawab(
  pesan: readonly (string | null | undefined)[],
  kataKunciTerpasang: readonly string[] = [],
  batas = 15,
): KataTakTerjawab[] {
  // Kata kunci yang terpasang bisa berupa frasa; tiap katanya dianggap sudah
  // tertangani, karena aturan berfrasa toh dicocokkan atas kata-kata itu juga.
  const sudahAda = new Set<string>();
  for (const kk of kataKunciTerpasang) {
    for (const kata of normalizeInbound(kk ?? '').split(' ')) {
      if (kata) sudahAda.add(kata);
    }
  }

  const jumlah = new Map<string, number>();
  for (const teks of pesan) {
    if (!teks) continue;
    const normal = normalizeInbound(teks);
    if (!normal) continue;

    // Set per pesan -- inilah yang membuat hitungannya "berapa pesan", bukan
    // "berapa kemunculan".
    const unik = new Set(normal.split(' '));
    for (const kata of unik) {
      if (kata.length < PANJANG_MINIMAL) continue;
      if (KATA_UMUM.has(kata)) continue;
      if (POTONGAN_TAUTAN.has(kata)) continue;
      if (sudahAda.has(kata)) continue;
      // Angka murni (tanggal, nomor RM, jam) bukan kandidat kata kunci.
      if (/^\d+$/.test(kata)) continue;
      if (campurHurufAngka(kata)) continue;
      jumlah.set(kata, (jumlah.get(kata) ?? 0) + 1);
    }
  }

  return [...jumlah.entries()]
    .map(([kata, jumlahPesan]) => ({ kata, jumlahPesan }))
    // Urut menurun; seri diputus alfabetis supaya urutannya stabil antar
    // pemuatan halaman -- daftar yang berubah urutan tanpa sebab membuat staf
    // mengira datanya berubah.
    .sort((a, b) => b.jumlahPesan - a.jumlahPesan || a.kata.localeCompare(b.kata))
    .filter((k) => k.jumlahPesan > 1)
    .slice(0, batas);
}
