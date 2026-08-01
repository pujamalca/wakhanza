import path from 'node:path';

/**
 * Next.js memuat .env sendiri lewat mekanismenya sendiri sebelum kode aplikasi
 * berjalan. Skrip mandiri (worker, migration runner, verify:*) tidak lewat
 * Next.js sama sekali, jadi modul ini memuatnya sendiri sebagai side-effect
 * SAAT MODUL INI DI-IMPORT — bukan lewat pemanggilan eksplisit di titik masuk
 * skrip. Alasannya bukan gaya penulisan: `import` di ESM/CJS (lewat tsx)
 * di-hoist ke atas berkas, jadi memanggil loadEnv() sebagai baris pertama di
 * scripts/*.ts TIDAK menjamin ia jalan sebelum modul lain (mis. db/sik.ts)
 * selesai dievaluasi dan sempat membaca process.env di top-level-nya sendiri.
 * Menjadikannya side-effect di sini memastikan urutan yang benar tanpa
 * bergantung pada disiplin "loadEnv() harus jadi baris pertama" di tiap skrip.
 */
/**
 * Path .env dihitung dari lokasi MODUL INI, bukan dibiarkan relatif.
 *
 * `process.loadEnvFile('.env')` yang relatif ternyata GAGAL dengan ENOENT saat
 * worker dijalankan lewat PM2 -- dan itu TERUKUR, bukan dikira: proses yang
 * diluncurkan PM2 melaporkan `process.cwd()` yang sudah benar
 * (D:\laragon\www\wakhanza) tapi loadEnvFile relatif tetap tidak menemukan
 * berkasnya, sehingga worker mati berulang dengan "SIK_DB_HOST wajib diisi".
 * Lewat `npm run worker` tidak pernah terlihat karena npm meluncurkannya
 * dengan cara yang berbeda.
 *
 * Path absolut membuat pemuatan .env tidak lagi bergantung pada siapa yang
 * meluncurkan proses maupun dari direktori mana -- yang juga menutup kelas
 * kegagalan yang sama untuk migrate/verify/seed bila dijalankan dari luar
 * folder proyek.
 *
 * Fallback ke bentuk relatif tetap dipertahankan untuk konteks yang
 * __dirname-nya bukan lokasi berkas sungguhan (bundel webpack Next.js). Di
 * sana keduanya boleh gagal tanpa akibat: Next.js memuat .env sendiri sebelum
 * kode aplikasi berjalan.
 */
const ENV_CANDIDATES = [path.resolve(__dirname, '..', '..', '.env'), '.env'];

for (const candidate of ENV_CANDIDATES) {
  try {
    process.loadEnvFile(candidate);
    break;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') throw err;
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabel lingkungan ${name} wajib diisi (lihat .env.example)`);
  return v;
}

export function sikDbConfig() {
  return {
    host: required('SIK_DB_HOST'),
    port: Number(process.env.SIK_DB_PORT ?? '3306'),
    database: required('SIK_DB_NAME'),
    user: required('SIK_DB_USER'),
    password: process.env.SIK_DB_PASS ?? '',
  };
}

export function wakhanzaDbConfig() {
  return {
    host: required('WA_DB_HOST'),
    port: Number(process.env.WA_DB_PORT ?? '3306'),
    database: required('WA_DB_NAME'),
    user: required('WA_DB_USER'),
    password: process.env.WA_DB_PASS ?? '',
  };
}
