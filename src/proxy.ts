import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

// auth.config.ts saja -- BUKAN '@/auth' penuh. proxy.ts (dulu middleware.ts,
// diganti nama di Next 16) jalan di Edge Runtime; mengimpor auth.ts akan
// menyeret Sequelize (lewat Credentials provider) yang butuh Node.js
// runtime penuh dan gagal di-build.
//
// Next.js mendeteksi export proxy/middleware lewat analisis statis berkas
// ini -- pola destructuring `export const { auth: proxy } = ...` tidak
// terdeteksi meski valid saat runtime, jadi wajib lewat variabel antara.
const { auth } = NextAuth(authConfig);
export const proxy = auth;

/**
 * F6.1: seluruh HALAMAN dashboard wajib berautentikasi -- redirect ke
 * /login yang cocok untuk browser. Seluruh /api/* SENGAJA dikecualikan di
 * sini: rute API sudah memeriksa sesi/peran sendiri lewat lib/authz.ts dan
 * mengembalikan 401/403 JSON, bukan redirect HTML. Menyatukan keduanya lewat
 * proxy ini membuat pemanggil API (curl, IMPLEMENTATION_PLAN Fase 3 DoD)
 * menerima 307 ke halaman login alih-alih 401/403 yang semestinya.
 */
export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
