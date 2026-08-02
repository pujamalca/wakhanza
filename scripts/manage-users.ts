/**
 * Pengelolaan akun dashboard dari baris perintah.
 *
 * Kenapa perlu ada: `seed:admin` MENOLAK bila username sudah ada, dan tidak ada
 * halaman pengelolaan pengguna di dashboard. Artinya sampai sekarang tidak ada
 * satu pun jalan yang didukung untuk mengganti kata sandi, menonaktifkan akun
 * petugas yang sudah pindah, atau membuka akun yang terkunci -- selain menyunting
 * `app_user` lewat SQL mentah, yang berarti menghitung hash bcrypt sendiri di luar
 * aplikasi dan tidak meninggalkan jejak di `audit_log`.
 *
 * Semua tindakan di sini tercatat ke `audit_log` dengan pelaku `cli:<akun OS>`,
 * supaya jelas bedanya dari tindakan lewat dashboard.
 *
 * CATATAN PENTING soal menonaktifkan: sesi dashboard memakai JWT (TECH_STACK.md),
 * bukan session di database. `is_active=0` menghentikan LOGIN BERIKUTNYA, tapi
 * sesi yang sedang berjalan tetap sah sampai kedaluwarsa sendiri
 * (`SESSION_MAX_AGE_HOURS`, default 8 jam). Untuk petugas yang harus diputus
 * saat itu juga, nonaktifkan DAN ganti `AUTH_SECRET` di .env lalu mulai ulang
 * `wakhanza-web` -- itu membatalkan SEMUA sesi sekaligus, termasuk milik orang
 * lain, jadi lakukan sadar-sadar.
 *
 * Pemakaian:
 *   npm run users -- list
 *   npm run users -- disable <username>
 *   npm run users -- enable  <username>
 *   npm run users -- unlock  <username>
 *   npm run users -- passwd  <username> <kata-sandi-baru>
 */
import os from 'node:os';
import bcrypt from 'bcrypt';
import { AppUser, logAudit } from '../src/models';
import { db } from '../src/db/wakhanza';

const BCRYPT_COST = 12; // sama dengan seed-admin.ts & auth.ts -- ARCHITECTURE §9.3
const PELAKU = `cli:${os.userInfo().username}`;

function pakai(): never {
  console.error(
    [
      'Pemakaian:',
      '  npm run users -- list',
      '  npm run users -- disable <username>',
      '  npm run users -- enable  <username>',
      '  npm run users -- unlock  <username>',
      '  npm run users -- passwd  <username> <kata-sandi-baru>',
    ].join('\n'),
  );
  process.exit(1);
}

async function cari(username: string): Promise<AppUser> {
  const user = await AppUser.findOne({ where: { username } });
  if (!user) {
    console.error(`[gagal] pengguna '${username}' tidak ada.`);
    process.exit(1);
  }
  return user;
}

/**
 * Pagar yang tidak boleh dilewati: menonaktifkan admin aktif TERAKHIR mengunci
 * semua orang keluar dari dashboard selamanya, dan satu-satunya jalan kembali
 * adalah menyunting database langsung. Halaman pengaturan, template, broadcast,
 * dan audit semuanya admin-only.
 */
async function pastikanBukanAdminTerakhir(user: AppUser): Promise<void> {
  if (user.role !== 'admin' || !user.isActive) return;
  const adminAktif = await AppUser.count({ where: { role: 'admin', isActive: true } });
  if (adminAktif <= 1) {
    console.error(
      `[gagal] '${user.username}' adalah satu-satunya admin yang masih aktif.\n` +
        '        Menonaktifkannya mengunci semua orang keluar dari dashboard.\n' +
        '        Buat admin pengganti dulu: npm run seed:admin -- <username> "<nama>" <password>',
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [, , perintah, username, argumen] = process.argv;

  switch (perintah) {
    case 'list': {
      const users = await AppUser.findAll({ order: [['id', 'ASC']] });
      const now = Date.now();
      console.log('id  username        peran     aktif  terkunci  nama');
      console.log('--  --------------  --------  -----  --------  ----------------');
      for (const u of users) {
        const terkunci = u.lockedUntil && u.lockedUntil.getTime() > now ? 'ya' : '-';
        console.log(
          [
            String(u.id).padEnd(2),
            u.username.padEnd(14),
            u.role.padEnd(8),
            (u.isActive ? 'ya' : 'TIDAK').padEnd(5),
            terkunci.padEnd(8),
            u.name,
          ].join('  '),
        );
      }
      break;
    }

    case 'disable': {
      if (!username) pakai();
      const user = await cari(username);
      if (!user.isActive) {
        console.log(`[-] '${username}' memang sudah nonaktif.`);
        break;
      }
      await pastikanBukanAdminTerakhir(user);
      await user.update({ isActive: false });
      await logAudit(PELAKU, 'user_disable', String(user.id), `username=${username}`);
      console.log(`[ok] '${username}' dinonaktifkan -- tidak bisa login lagi.`);
      console.log('     Sesi yang SEDANG berjalan tetap sah sampai kedaluwarsa (JWT, lihat komentar di skrip ini).');
      break;
    }

    case 'enable': {
      if (!username) pakai();
      const user = await cari(username);
      await user.update({ isActive: true, failedAttempts: 0, lockedUntil: null });
      await logAudit(PELAKU, 'user_enable', String(user.id), `username=${username}`);
      console.log(`[ok] '${username}' diaktifkan kembali.`);
      break;
    }

    case 'unlock': {
      if (!username) pakai();
      const user = await cari(username);
      await user.update({ failedAttempts: 0, lockedUntil: null });
      await logAudit(PELAKU, 'user_unlock', String(user.id), `username=${username}`);
      console.log(`[ok] kunci login '${username}' dilepas.`);
      break;
    }

    case 'passwd': {
      if (!username || !argumen) pakai();
      if (argumen.length < 8) {
        console.error('Kata sandi minimal 8 karakter.');
        process.exit(1);
      }
      const user = await cari(username);
      const passwordHash = await bcrypt.hash(argumen, BCRYPT_COST);
      // failedAttempts/lockedUntil ikut direset: kata sandi baru yang langsung
      // ditolak karena kunci lama masih berlaku hanya membingungkan.
      await user.update({ passwordHash, failedAttempts: 0, lockedUntil: null });
      // Kata sandinya TIDAK ikut dicatat -- audit_log dibaca admin IT dan vendor.
      await logAudit(PELAKU, 'user_password_reset', String(user.id), `username=${username}`);
      console.log(`[ok] kata sandi '${username}' diganti.`);
      break;
    }

    default:
      pakai();
  }

  await db.close();
}

main().catch((err) => {
  console.error('[users] gagal:', err.message);
  process.exit(1);
});
