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
try {
  process.loadEnvFile('.env');
} catch (err) {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code !== 'ENOENT') throw err;
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
