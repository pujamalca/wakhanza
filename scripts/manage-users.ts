/**
 * Pengelolaan akun dashboard dari baris perintah.
 *
 * Sejak halaman `/pengguna` ada, ini bukan lagi SATU-SATUNYA jalan -- tapi ia
 * tetap perlu, dan justru untuk keadaan saat halamannya tidak bisa dipakai:
 * admin terakhir terkunci, sandi admin hilang, atau dashboard tidak mau hidup.
 * Itu sebabnya ia tidak dihapus setelah halamannya jadi.
 *
 * Seluruh logikanya ada di `src/lib/userAdmin.ts`, dipakai bersama halaman
 * Pengguna. Berkas ini hanya menerjemahkan argumen dan mencetak hasil. Pagar
 * seperti "admin aktif terakhir" hidup di sana, bukan di sini -- pagar yang
 * ditulis dua kali adalah pagar yang cepat atau lambat berbeda di satu sisi.
 *
 * Tindakan dari sini tercatat ke `audit_log` dengan pelaku `cli:<akun OS>`,
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
 *   npm run users -- add     <username> "<nama>" <peran> <kata-sandi>
 *   npm run users -- disable <username>
 *   npm run users -- enable  <username>
 *   npm run users -- unlock  <username>
 *   npm run users -- passwd  <username> <kata-sandi-baru>
 *   npm run users -- delete  <username>
 */
import os from 'node:os';
import { AppUser } from '../src/models';
import { db } from '../src/db/wakhanza';
import {
  daftarPengguna,
  buatPengguna,
  setelSandi,
  setelAktif,
  bukaKunci,
  hapusPengguna,
  type Hasil,
} from '../src/lib/userAdmin';
import type { AppUserRole } from '../src/core/userPolicy';

const PELAKU = `cli:${os.userInfo().username}`;

function pakai(): never {
  console.error(
    [
      'Pemakaian:',
      '  npm run users -- list',
      '  npm run users -- add     <username> "<nama>" <admin|operator> <kata-sandi>',
      '  npm run users -- disable <username>',
      '  npm run users -- enable  <username>',
      '  npm run users -- unlock  <username>',
      '  npm run users -- passwd  <username> <kata-sandi-baru>',
      '  npm run users -- delete  <username>   (permanen -- pakai disable kalau mungkin dipakai lagi)',
    ].join('\n'),
  );
  process.exit(1);
}

async function cariId(username: string): Promise<number> {
  const user = await AppUser.findOne({ where: { username } });
  if (!user) {
    console.error(`[gagal] pengguna '${username}' tidak ada.`);
    process.exit(1);
  }
  return user.id;
}

/** Pelaku CLI bukan salah satu akun dashboard, jadi tidak ada "diri sendiri" di sini. */
const BUKAN_AKUN_DASHBOARD = null;

function laporkan(hasil: Hasil, pesanSukses: string): void {
  if (!hasil.ok) {
    console.error(`[gagal] ${hasil.error}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesanSukses}`);
}

async function main(): Promise<void> {
  const [, , perintah, arg1, arg2, arg3, arg4] = process.argv;

  switch (perintah) {
    case 'list': {
      const users = await daftarPengguna();
      console.log('id  username        peran     aktif  terkunci  nama');
      console.log('--  --------------  --------  -----  --------  ----------------');
      for (const u of users) {
        console.log(
          [
            String(u.id).padEnd(2),
            u.username.padEnd(14),
            u.role.padEnd(8),
            (u.isActive ? 'ya' : 'TIDAK').padEnd(5),
            (u.terkunci ? 'ya' : '-').padEnd(8),
            u.name,
          ].join('  '),
        );
      }
      break;
    }

    case 'add': {
      if (!arg1 || !arg2 || !arg3 || !arg4) pakai();
      if (arg3 !== 'admin' && arg3 !== 'operator') {
        console.error("[gagal] peran harus 'admin' atau 'operator'.");
        process.exit(1);
      }
      const hasil = await buatPengguna(
        { username: arg1, name: arg2, role: arg3 as AppUserRole, password: arg4 },
        PELAKU,
      );
      laporkan(hasil, `pengguna '${arg1}' dibuat sebagai ${arg3}.`);
      break;
    }

    case 'disable': {
      if (!arg1) pakai();
      const id = await cariId(arg1);
      const hasil = await setelAktif(id, false, PELAKU, BUKAN_AKUN_DASHBOARD);
      laporkan(hasil, `'${arg1}' dinonaktifkan -- tidak bisa login lagi.`);
      if (hasil.ok) {
        console.log('     Sesi yang SEDANG berjalan tetap sah sampai kedaluwarsa (JWT, lihat komentar di skrip ini).');
      }
      break;
    }

    case 'enable': {
      if (!arg1) pakai();
      const id = await cariId(arg1);
      laporkan(await setelAktif(id, true, PELAKU, BUKAN_AKUN_DASHBOARD), `'${arg1}' diaktifkan kembali.`);
      break;
    }

    case 'unlock': {
      if (!arg1) pakai();
      const id = await cariId(arg1);
      laporkan(await bukaKunci(id, PELAKU), `kunci login '${arg1}' dilepas.`);
      break;
    }

    case 'delete': {
      if (!arg1) pakai();
      const id = await cariId(arg1);
      const hasil = await hapusPengguna(id, PELAKU, BUKAN_AKUN_DASHBOARD);
      laporkan(hasil, `'${arg1}' dihapus permanen.`);
      if (hasil.ok) {
        // Dicetak SESUDAH berhasil, bukan sebagai peringatan sebelum bertanya:
        // skrip ini tidak interaktif (dijalankan lewat npm, tanpa prompt di
        // mana pun), jadi kalimat yang meminta pertimbangan ulang tidak punya
        // tempat untuk dijawab. Yang berguna di sini adalah memberi tahu apa
        // yang BARU SAJA terjadi -- terutama bahwa jejaknya tidak ikut hilang.
        console.log(`     Riwayat audit atas nama '${arg1}' tetap tersimpan; nama itu kini bisa dipakai akun baru.`);
      }
      break;
    }

    case 'passwd': {
      if (!arg1 || !arg2) pakai();
      const id = await cariId(arg1);
      laporkan(await setelSandi(id, arg2, PELAKU), `kata sandi '${arg1}' diganti.`);
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
