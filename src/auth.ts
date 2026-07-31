import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { AppUser, getSettingNumber, logAudit } from '@/models';
import { authConfig } from './auth.config';

/**
 * F6.1 / N10: dashboard wajib berautentikasi. Kunci 15 menit setelah 5
 * kegagalan BERTURUT-TURUT per nama pengguna (bukan per IP -- banyak
 * komputer RS berbagi satu IP lewat NAT, kunci per-IP akan mengunci
 * seluruh loket sekaligus, ARCHITECTURE §9.3).
 *
 * Config penuh (berbeda dari auth.config.ts): file ini boleh mengimpor
 * Sequelize/bcrypt karena hanya dipakai route handler/Server Component/
 * Server Action, yang jalan di Node.js runtime penuh -- TIDAK PERNAH oleh
 * middleware.ts (Edge Runtime, lihat catatan di auth.config.ts).
 *
 * Sesi JWT (bukan session di database) -- selaras dengan prinsip "sesedikit
 * mungkin komponen" (TECH_STACK.md): tidak perlu tabel session terpisah.
 * SESSION_MAX_AGE_HOURS dibaca dari .env, bukan app_setting, karena nilai
 * ini dipakai saat NextAuth() dikonfigurasi (sinkron, sebelum ada request
 * untuk membaca database) -- beda dari auth.login_max_attempts/
 * login_lockout_minutes yang dibaca di dalam authorize() (async, aman).
 */
const sessionMaxAgeHours = Number(process.env.SESSION_MAX_AGE_HOURS ?? '8');

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: 'jwt', maxAge: sessionMaxAgeHours * 60 * 60 },
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Nama pengguna' },
        password: { label: 'Kata sandi', type: 'password' },
      },
      async authorize(credentials) {
        const username = String(credentials?.username ?? '').trim();
        const password = String(credentials?.password ?? '');
        if (!username || !password) return null;

        const user = await AppUser.findOne({ where: { username } });
        if (!user || !user.isActive) return null;

        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const maxAttempts = await getSettingNumber('auth.login_max_attempts', 5);
          const lockoutMinutes = await getSettingNumber('auth.login_lockout_minutes', 15);
          const failedAttempts = user.failedAttempts + 1;
          const willLock = failedAttempts >= maxAttempts;

          await user.update({
            failedAttempts: willLock ? 0 : failedAttempts,
            lockedUntil: willLock ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
          });

          if (willLock) {
            await logAudit(username, 'login_locked', undefined, `terkunci setelah ${failedAttempts} kegagalan berturut-turut`);
          }
          return null;
        }

        await user.update({ failedAttempts: 0, lockedUntil: null });
        await logAudit(username, 'login_success');

        return { id: String(user.id), name: user.name, username: user.username, role: user.role };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.username = user.username;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.user.username = token.username;
      session.user.role = token.role;
      return session;
    },
  },
});
