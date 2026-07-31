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
  providers: [],
  callbacks: {
    authorized({ auth: session, request }) {
      if (session?.user) return true;
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    },
  },
} satisfies NextAuthConfig;
