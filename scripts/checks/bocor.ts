import { barisDari, baca, berkasTerlacak, type Pemeriksaan, type Temuan } from './tipe';

/**
 * Repo ini PUBLIK (`github.com/pujamalca/wakhanza`) sementara isinya adalah
 * alat yang memegang nomor telepon 4.857 pasien. Kedua fakta itu bertemu di
 * satu titik yang gampang terlewat: berkas uji dan dokumen verifikasi.
 *
 * Nilai contoh untuk `normalizePhone()` paling gampang diambil dari data yang
 * ADA -- satu `SELECT no_tlp FROM pasien LIMIT 5` menghasilkan lima nomor yang
 * bentuknya persis seperti yang perlu diuji. Nomor itu lalu ikut ter-commit,
 * dan sejak itu ia publik selamanya: menghapusnya di commit berikutnya TIDAK
 * menariknya kembali, karena riwayat git menyimpan yang lama.
 *
 * Karena itu pemeriksaan ini berjalan SEBELUM push, bukan sesudah.
 */

/**
 * Nomor yang boleh muncul di berkas terlacak, seluruhnya SINTETIS.
 *
 * Daftar-IZIN, bukan daftar-tolak, dan itu keputusan yang menempel: nomor
 * sungguhan tidak punya ciri yang bisa dikenali mesin: nomor pasien dan nomor
 * contoh sama-sama sebelas sampai tiga belas digit, berawalan operator yang
 * sama-sama sah, dan tidak ada digit yang menandai salah satunya. Satu-
 * satunya cara memisahkannya adalah menuntut tiap nomor didaftarkan dengan
 * sadar. Konsekuensinya disengaja: menambah nilai uji baru berarti menambah
 * satu baris di sini, dan itu jauh lebih murah daripada menariknya dari repo
 * publik.
 *
 * Bentuk yang dianjurkan untuk nomor uji BARU: `62812000000NN` -- jelas palsu
 * bagi manusia, tetap lolos `normalizePhone()`.
 */
const NOMOR_CONTOH = new Set([
  '081234567890',
  '6281234567890',
  '628123456789',
  '62812345678',
  '6280123456789',
  '6262812345678',
  '6281200000001',
  '6281200000002',
  '6281200000009',
  '628000000001',
  '628000000002',
  '628000000009',
  '628000000011',
  '628000000012',
  // Pengganti nomor SUNGGUHAN yang sempat ikut ter-commit sebagai nilai uji
  // (lihat "Nomor pasien yang ikut ter-commit" di VERIFICATION.md). Bentuknya
  // dipertahankan persis -- panjang sama, awalan operator sama-sama sah --
  // supaya tiap uji tetap menguji hal yang sama.
  '081200000048',
  '6281200000048',
  '81200000086',
  '6281200000086',
  '6281200000016',
]);

/** Nomor Indonesia: `62…` atau `08…`, panjang yang dipakai ponsel sungguhan. */
const POLA_NOMOR = /\b(?:62|08)\d{9,13}\b/g;

/**
 * Alamat WhatsApp yang MENGIDENTIFIKASI obrolan nyata. `@c.us` sengaja TIDAK
 * ikut: ia muncul sah di kode sebagai akhiran yang dibentuk (`${nomor}@c.us`),
 * dan nomornya sendiri sudah dijaga POLA_NOMOR.
 */
const POLA_ALAMAT = /\b\d{8,}(?:-\d+)?@(?:g\.us|s\.whatsapp\.net|lid)\b/g;

/**
 * Alamat yang boleh muncul, seluruhnya SINTETIS. Daftar-IZIN dengan alasan
 * yang sama seperti NOMOR_CONTOH: JID grup apotek yang NYATA dan JID contoh
 * sama-sama delapan belas digit berawalan `120363`. Tidak ada satu pun ciri
 * yang membedakannya, jadi yang boleh lewat harus disebut satu per satu.
 */
const ALAMAT_CONTOH = new Set([
  '120363000000000000@g.us',
  '120363000000000001@g.us',
  '120363000000000002@g.us',
  '120363999999999999@g.us',
  '12036304@g.us',
  '6281234567890-1614840000@g.us',
  '628123456789@lid',
  '205000000000001@lid',
  '205000000000002@lid',
  '205000000000015@lid',
]);

/** Token bot Telegram: `<id>:<35 karakter>`. Bentuknya khas dan tidak ambigu. */
const POLA_TOKEN_TELEGRAM = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;


function pindai(pola: RegExp, pesan: (nilai: string) => string | null): Temuan[] {
  const temuan: Temuan[] = [];

  for (const berkas of berkasTerlacak()) {
    if (!/\.(ts|tsx|js|cjs|mjs|sql|md|json|ps1|sh|yml|yaml|css)$/.test(berkas)) continue;

    let isi: string;
    try {
      isi = baca(berkas);
    } catch {
      continue; // berkas terlacak yang sedang dihapus
    }

    for (const cocok of isi.matchAll(pola)) {
      const catatan = pesan(cocok[0]);
      if (catatan === null) continue;
      temuan.push({ berkas, baris: barisDari(isi, cocok.index ?? 0), pesan: catatan });
    }
  }

  return temuan;
}

export const pemeriksaanNomor: Pemeriksaan = {
  nama: 'nomor',
  judul: 'Tidak ada nomor telepon sungguhan di berkas terlacak',
  alasan:
    'Repo ini publik dan nomor pasien tidak bisa ditarik kembali sesudah ter-push. ' +
    'Kalau nomor ini memang sintetis, daftarkan di NOMOR_CONTOH pada scripts/checks/bocor.ts ' +
    'supaya keputusannya tercatat; kalau bukan, ganti dengan bentuk 62812000000NN.',
  jalankan: () =>
    pindai(POLA_NOMOR, (nilai) =>
      NOMOR_CONTOH.has(nilai) ? null : `nomor telepon tidak terdaftar sebagai contoh: ${samarkan(nilai)}`,
    ),
};

export const pemeriksaanAlamatWa: Pemeriksaan = {
  nama: 'alamat-wa',
  judul: 'Tidak ada JID grup / alamat WhatsApp sungguhan di berkas terlacak',
  alasan:
    'JID grup mengidentifikasi grup staf yang nyata. Ia pernah ikut ter-commit sekali ' +
    'di repo ini dan tidak bisa ditarik. Pakai bentuk contoh 000000000000000@g.us.',
  jalankan: () =>
    pindai(POLA_ALAMAT, (nilai) =>
      ALAMAT_CONTOH.has(nilai) ? null : `alamat WhatsApp yang tampak nyata: ${samarkan(nilai)}`,
    ),
};

export const pemeriksaanToken: Pemeriksaan = {
  nama: 'token',
  judul: 'Tidak ada token bot Telegram di berkas terlacak',
  alasan:
    'Token bot memberi kendali penuh atas botnya kepada siapa pun yang membacanya. ' +
    'Tempatnya app_setting.alert.webhook_url di database, tidak pernah di berkas.',
  jalankan: () => pindai(POLA_TOKEN_TELEGRAM, () => 'token bot Telegram'),
};

/**
 * Yang dicetak ke layar TIDAK boleh jadi kebocoran keduanya. Terminal ini
 * ikut tersalin ke tiket dukungan dan transkrip; sudah terjadi di proyek ini.
 */
function samarkan(nilai: string): string {
  if (nilai.length <= 6) return '***';
  return `${nilai.slice(0, 4)}${'*'.repeat(nilai.length - 6)}${nilai.slice(-2)}`;
}
