import { NextResponse } from 'next/server';
import type { NextAuthConfig } from 'next-auth';

/**
 * Bagian config yang aman dipakai middleware.ts (Edge Runtime). TIDAK BOLEH
 * mengimpor apa pun yang menyeret Sequelize/bcrypt/mysql2 -- Edge Runtime
 * tidak mendukung modul Node.js native yang dipakai paket-paket itu (TCP
 * socket ke MariaDB, dsb). Providers (yang butuh akses database penuh)
 * ditambahkan terpisah di auth.ts, dipakai oleh route handler/Server
 * Component/Server Action -- semuanya jalan di Node.js runtime biasa.
 */
export const authConfig = {
  pages: { signIn: '/login' },
  /**
   * WAJIB, dan sempat luput sampai dashboard diuji lewat `npm start`.
   *
   * Auth.js v5 hanya mengaktifkan sendiri kepercayaan pada Host header saat
   * `next dev`. Pada build produksi -- persis yang dijalankan PM2 lewat
   * `ecosystem.config.js` -- tanpa baris ini SETIAP permintaan ke /api/auth/*
   * ditolak `UntrustedHost` dan dijawab HTTP 500, sehingga tidak seorang pun
   * bisa masuk. Perbedaan dev/produksi ini tidak pernah muncul selama
   * pengujian memakai `npm run dev`.
   *
   * Aman di sini karena topologinya tetap: satu server RS, prosesnya diikat ke
   * 127.0.0.1 (`next start -H 127.0.0.1`), tidak melayani banyak host dan
   * tidak menerima Host header dari luar mesin. `NEXTAUTH_URL` di .env tetap
   * jadi sumber URL kanonik untuk penautan balik.
   */
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth: session, request }) {
      if (session?.user) return true;
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    },
  },
} satisfies NextAuthConfig;
