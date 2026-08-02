/**
 * Memuat .env ke dalam `process.env` yang dilihat berkas uji.
 *
 * `src/lib/env.ts` sudah memuat .env sebagai side-effect saat di-import, dan
 * itu cukup untuk worker/skrip/Next.js. Di dalam Jest tidak, dan sebabnya
 * halus: `process.loadEnvFile()` adalah fungsi native yang menulis ke
 * `process.env` milik proses SUNGGUHAN, sementara berkas uji berjalan di dalam
 * sandbox VM yang memegang salinan `process.env`-nya sendiri. Pemuatannya
 * "berhasil" tanpa galat apa pun, lalu `WA_DB_HOST` tetap undefined saat dibaca
 * -- persis kelas kegagalan senyap yang berulang kali muncul di proyek ini.
 *
 * Karena itu di sini berkasnya dibaca dan nilainya ditulis SATU PER SATU ke
 * `process.env` yang aktif.
 *
 * Sengaja MELEMPAR bila .env tidak ada: uji integrasi tanpa kredensial database
 * akan gagal dengan pesan yang membingungkan ("WA_DB_HOST wajib diisi") jauh di
 * dalam tumpukan import; lebih baik berhenti di sini dengan sebab yang jelas.
 */
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '.env');

let isi;
try {
  isi = fs.readFileSync(envPath, 'utf8');
} catch (err) {
  throw new Error(`Uji integrasi butuh .env berisi kredensial database, gagal membaca ${envPath}: ${err.message}`);
}

for (const baris of isi.split(/\r?\n/)) {
  const teks = baris.trim();
  if (!teks || teks.startsWith('#')) continue;
  const pisah = teks.indexOf('=');
  if (pisah < 1) continue;
  const kunci = teks.slice(0, pisah).trim();
  let nilai = teks.slice(pisah + 1).trim();
  // Tanda kutip pembungkus dilepas -- .env.example memakainya di beberapa nilai.
  if (nilai.length >= 2 && ((nilai.startsWith('"') && nilai.endsWith('"')) || (nilai.startsWith("'") && nilai.endsWith("'")))) {
    nilai = nilai.slice(1, -1);
  }
  // Env var yang sudah ada di lingkungan TIDAK ditimpa: itu jalan untuk
  // mengarahkan uji ke database lain tanpa menyunting .env.
  if (process.env[kunci] === undefined) process.env[kunci] = nilai;
}
