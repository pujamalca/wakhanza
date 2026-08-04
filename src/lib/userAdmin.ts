import bcrypt from 'bcrypt';
import { AppUser, logAudit } from '@/models';
import { db } from '@/db/wakhanza';
import {
  bolehHapus,
  bolehNonaktifkan,
  bolehUbahPeran,
  periksaNama,
  periksaSandi,
  periksaUsername,
  type AppUserRole,
  type KeadaanPerubahan,
} from '@/core/userPolicy';

/**
 * Operasi akun dashboard, dipakai BERSAMA oleh `scripts/manage-users.ts` dan
 * server action halaman Pengguna.
 *
 * Kenapa satu berkas dan bukan masing-masing memanggil model sendiri: tiap
 * operasi di sini adalah tiga hal yang harus selalu terjadi bersama -- pagar
 * kebijakan, perubahan baris, dan baris `audit_log`. Dipisah dua jalur, yang
 * paling gampang tertinggal adalah yang ketiga, dan jejak audit yang bolong
 * justru tidak menimbulkan gejala apa pun sampai ada yang mencarinya.
 *
 * Semua fungsi MENGEMBALIKAN kegagalan alih-alih melempar: CLI perlu mencetak
 * lalu keluar dengan kode 1, halaman perlu menampilkannya di dalam form tanpa
 * membuang yang sudah diketik. Melempar memaksa keduanya membungkus try/catch
 * dan menerjemahkan pesan galat sendiri-sendiri.
 */

const BCRYPT_COST = 12; // sama dengan seed-admin.ts & auth.ts -- ARCHITECTURE §9.3

export type Hasil = { ok: true } | { ok: false; error: string };

const berhasil: Hasil = { ok: true };
const gagal = (error: string): Hasil => ({ ok: false, error });

export interface BarisPengguna {
  id: number;
  username: string;
  name: string;
  role: AppUserRole;
  isActive: boolean;
  /** Terkunci SEKARANG karena salah sandi berkali-kali -- bukan sekadar kolom lockedUntil terisi. */
  terkunci: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
}

function keBaris(u: AppUser, now: number): BarisPengguna {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    terkunci: !!u.lockedUntil && u.lockedUntil.getTime() > now,
    lockedUntil: u.lockedUntil,
    createdAt: u.createdAt,
  };
}

/**
 * Satu halaman daftar pengguna. `limit`/`offset` opsional supaya pemanggil
 * lain (skrip CLI `npm run users -- list`) tetap mendapat seluruh baris tanpa
 * perlu tahu apa pun soal paginasi dashboard.
 */
export async function daftarPengguna(potong?: { limit: number; offset: number }): Promise<BarisPengguna[]> {
  const users = await AppUser.findAll({
    order: [['id', 'ASC']],
    ...(potong ? { limit: potong.limit, offset: potong.offset } : {}),
  });
  const now = Date.now();
  return users.map((u) => keBaris(u, now));
}

export async function hitungPengguna(): Promise<number> {
  return AppUser.count();
}

/**
 * SELALU menghitung seluruh tabel, tidak pernah satu halaman.
 *
 * Angka ini menyalakan peringatan "hanya ada satu admin aktif" DAN menjadi
 * masukan pagar di `core/userPolicy.ts`. Kalau ia ikut dipersempit ke halaman
 * yang sedang dilihat, admin ke-30 yang ada di halaman 2 menjadi tak terhitung:
 * peringatannya menyala palsu, dan -- jauh lebih buruk -- pagarnya bisa
 * MENOLAK penonaktifan yang sebenarnya sah, atau sebaliknya.
 */
export async function hitungAdminAktif(): Promise<number> {
  return AppUser.count({ where: { role: 'admin', isActive: true } });
}

/**
 * Mengumpulkan keadaan yang dibutuhkan pagar di core/userPolicy.ts. Dibaca
 * SEKALI di sini alih-alih di tiap pemanggil, supaya tidak ada jalur yang
 * kebetulan lupa mengisi salah satu kolomnya dan membuat pagarnya menilai
 * dengan angka yang salah.
 */
async function keadaanUntuk(user: AppUser, pelakuUsername: string | null): Promise<KeadaanPerubahan> {
  return {
    peranSekarang: user.role,
    aktifSekarang: user.isActive,
    adminAktif: await hitungAdminAktif(),
    diriSendiri: pelakuUsername !== null && pelakuUsername === user.username,
  };
}

async function cari(id: number): Promise<AppUser | null> {
  return AppUser.findByPk(id);
}

export async function buatPengguna(
  input: { username: string; name: string; role: AppUserRole; password: string },
  pelaku: string,
): Promise<Hasil> {
  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();

  const salahUsername = periksaUsername(username);
  if (salahUsername) return gagal(salahUsername);
  const salahNama = periksaNama(name);
  if (salahNama) return gagal(salahNama);
  const salahSandi = periksaSandi(input.password);
  if (salahSandi) return gagal(salahSandi);

  // Diperiksa di depan supaya pesannya bisa dimengerti. UNIQUE KEY di database
  // tetap penjaga terakhirnya untuk dua permintaan yang datang bersamaan.
  const sudahAda = await AppUser.findOne({ where: { username } });
  if (sudahAda) return gagal(`Nama pengguna '${username}' sudah dipakai.`);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await AppUser.create({
    username,
    name,
    passwordHash,
    role: input.role,
    isActive: true,
    lockedUntil: null,
  });

  // Kata sandinya TIDAK ikut dicatat -- audit_log dibaca admin IT dan vendor.
  await logAudit(pelaku, 'user_create', String(user.id), `username=${username} peran=${input.role}`);
  return berhasil;
}

export async function setelSandi(id: number, sandiBaru: string, pelaku: string): Promise<Hasil> {
  const salah = periksaSandi(sandiBaru);
  if (salah) return gagal(salah);

  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');

  const passwordHash = await bcrypt.hash(sandiBaru, BCRYPT_COST);
  // failedAttempts/lockedUntil ikut direset: kata sandi baru yang langsung
  // ditolak karena kunci lama masih berlaku hanya membingungkan.
  await user.update({ passwordHash, failedAttempts: 0, lockedUntil: null });
  await logAudit(pelaku, 'user_password_reset', String(user.id), `username=${user.username}`);
  return berhasil;
}

/**
 * Ganti sandi SENDIRI -- berbeda dari `setelSandi` dan bedanya bukan gaya.
 *
 * Sandi lama WAJIB dicocokkan. Tanpa itu, satu sesi yang terlanjur terbuka di
 * komputer loket cukup untuk mengunci pemilik akunnya keluar dari akunnya
 * sendiri, dan pemiliknya tidak akan tahu sampai ia mencoba masuk lagi.
 * Admin yang menyetel sandi orang lain tidak diminta sandi lama karena ia
 * memang tidak mengetahuinya -- di sana yang menjaga adalah `requireRole` dan
 * `audit_log`.
 */
export async function gantiSandiSendiri(
  id: number,
  sandiLama: string,
  sandiBaru: string,
  pelaku: string,
): Promise<Hasil> {
  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');

  const cocok = await bcrypt.compare(sandiLama, user.passwordHash);
  if (!cocok) {
    await logAudit(pelaku, 'user_password_change_failed', String(user.id), 'kata sandi lama salah');
    return gagal('Kata sandi saat ini salah.');
  }

  const salah = periksaSandi(sandiBaru);
  if (salah) return gagal(salah);
  if (sandiLama === sandiBaru) return gagal('Kata sandi baru sama dengan yang sekarang.');

  const passwordHash = await bcrypt.hash(sandiBaru, BCRYPT_COST);
  await user.update({ passwordHash, failedAttempts: 0, lockedUntil: null });
  await logAudit(pelaku, 'user_password_change', String(user.id), `username=${user.username}`);
  return berhasil;
}

export async function setelAktif(
  id: number,
  aktif: boolean,
  pelaku: string,
  pelakuUsername: string | null,
): Promise<Hasil> {
  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');
  if (user.isActive === aktif) return berhasil; // bukan perubahan

  if (!aktif) {
    const tolak = bolehNonaktifkan(await keadaanUntuk(user, pelakuUsername));
    if (tolak) return gagal(tolak);
    await user.update({ isActive: false });
    await logAudit(pelaku, 'user_disable', String(user.id), `username=${user.username}`);
    return berhasil;
  }

  // Mengaktifkan sekalian melepas kunci: akun yang dinyalakan lagi tapi masih
  // terkunci akan menolak login tanpa satu pun tanda kenapa.
  await user.update({ isActive: true, failedAttempts: 0, lockedUntil: null });
  await logAudit(pelaku, 'user_enable', String(user.id), `username=${user.username}`);
  return berhasil;
}

/**
 * Menghapus barisnya untuk selamanya -- pasangan dari `setelAktif(false)`, bukan
 * penggantinya. Nonaktif untuk akun yang mungkin dipakai lagi; hapus untuk akun
 * yang memang salah dibuat atau tidak akan pernah dipakai lagi.
 *
 * Riwayat `audit_log` orangnya TIDAK ikut terhapus (dan memang tidak bisa --
 * tabel itu tanpa grant DELETE): `actor` menyimpan usernamenya sebagai teks,
 * bukan foreign key ke baris ini. Yang hilang cuma kemampuannya masuk.
 */
export async function hapusPengguna(id: number, pelaku: string, pelakuUsername: string | null): Promise<Hasil> {
  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');

  const tolak = bolehHapus(await keadaanUntuk(user, pelakuUsername));
  if (tolak) return gagal(tolak);

  // Satu transaksi, bukan dua perintah berurutan, dan urutannya di dalam sana
  // tidak menyelamatkan apa pun tanpa itu: begitu barisnya hilang, baris audit
  // adalah SATU-SATUNYA tempat yang masih menyebut akun ini pernah ada. Kalau
  // penghapusannya berhasil sementara pencatatannya gagal, yang tertinggal
  // adalah akun yang lenyap tanpa satu pun jejak siapa menghapusnya kapan --
  // dan tidak ada lagi sumber untuk merekonstruksinya.
  await db.transaction(async (transaction) => {
    await logAudit(
      pelaku,
      'user_delete',
      String(user.id),
      // Username dan peran ikut dicatat justru KARENA barisnya akan hilang:
      // sesudah ini nama itu bisa dipakai orang lain, dan baris inilah batas
      // yang memisahkan riwayat pemakai lama dari pemakai baru.
      `username=${user.username} peran=${user.role} aktif=${user.isActive ? 'ya' : 'tidak'}`,
      { transaction },
    );
    await user.destroy({ transaction });
  });
  return berhasil;
}

export async function bukaKunci(id: number, pelaku: string): Promise<Hasil> {
  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');
  await user.update({ failedAttempts: 0, lockedUntil: null });
  await logAudit(pelaku, 'user_unlock', String(user.id), `username=${user.username}`);
  return berhasil;
}

/**
 * Nama dan peran. Username SENGAJA tidak bisa diubah: ia dipakai sebagai
 * `actor` di `audit_log`, dan menggantinya memutus seluruh jejak lama dari
 * pemiliknya tanpa meninggalkan tanda bahwa keduanya orang yang sama.
 */
export async function ubahPengguna(
  id: number,
  input: { name: string; role: AppUserRole },
  pelaku: string,
  pelakuUsername: string | null,
): Promise<Hasil> {
  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');

  const name = input.name.trim();
  const salahNama = periksaNama(name);
  if (salahNama) return gagal(salahNama);

  const tolak = bolehUbahPeran(await keadaanUntuk(user, pelakuUsername), input.role);
  if (tolak) return gagal(tolak);

  const perubahan: string[] = [];
  if (user.name !== name) perubahan.push(`nama: "${user.name}" -> "${name}"`);
  if (user.role !== input.role) perubahan.push(`peran: ${user.role} -> ${input.role}`);
  if (perubahan.length === 0) return berhasil;

  await user.update({ name, role: input.role });
  await logAudit(pelaku, 'user_update', String(user.id), `username=${user.username}; ${perubahan.join('; ')}`);
  return berhasil;
}

/** Ubah nama tampilan sendiri. Peran tidak ikut -- itu bukan milik pemakainya untuk diubah. */
export async function ubahNamaSendiri(id: number, nama: string, pelaku: string): Promise<Hasil> {
  const user = await cari(id);
  if (!user) return gagal('Pengguna tidak ditemukan.');

  const name = nama.trim();
  const salah = periksaNama(name);
  if (salah) return gagal(salah);
  if (user.name === name) return berhasil;

  const lama = user.name;
  await user.update({ name });
  await logAudit(pelaku, 'user_profile_update', String(user.id), `nama: "${lama}" -> "${name}"`);
  return berhasil;
}
