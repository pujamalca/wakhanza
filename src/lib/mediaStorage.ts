import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { namaBerkasSimpanan } from '@/core/media';

/**
 * Penyimpanan berkas lampiran broadcast.
 *
 * SENGAJA di luar `public/`. Apa pun di bawah public/ dilayani Next.js tanpa
 * autentikasi apa pun, jadi menaruhnya di sana berarti setiap surat edaran
 * rumah sakit bisa diunduh siapa saja yang menebak namanya -- termasuk berkas
 * yang kebetulan memuat nama pasien di dalamnya.
 *
 * Berkasnya juga tidak disimpan di database: satu broadcast ke 500 pasien
 * menghasilkan 500 baris outbox yang menunjuk SATU berkas yang sama.
 */

const DIR_MEDIA = path.resolve(process.cwd(), 'uploads', 'broadcast');

export function mediaDir(): string {
  return DIR_MEDIA;
}

/**
 * Mengubah lintasan tersimpan (relatif) menjadi lintasan absolut, dan MENOLAK
 * apa pun yang keluar dari direktori media.
 *
 * Nilainya memang kita sendiri yang menulis, tapi ia melewati database dan
 * kembali lagi -- pemeriksaan ini yang memastikan satu baris outbox yang
 * disunting lewat SQL tidak bisa membuat worker membaca berkas sembarang di
 * server (mis. `.env`) lalu mengirimkannya ke pasien.
 */
export function resolveMediaPath(relatif: string): string | null {
  if (!relatif || path.isAbsolute(relatif)) return null;
  const absolut = path.resolve(DIR_MEDIA, relatif);
  const batas = DIR_MEDIA + path.sep;
  return absolut.startsWith(batas) ? absolut : null;
}

export interface BerkasTersimpan {
  /** Relatif terhadap direktori media -- inilah yang masuk ke outbox.media_path. */
  relativePath: string;
  mime: string;
  originalName: string;
  size: number;
}

/**
 * Menulis berkas unggahan ke disk dengan nama yang DIBUAT SENDIRI.
 *
 * Nama unggahan tidak pernah ikut menentukan lokasi tulis -- lihat
 * `namaBerkasSimpanan` di core/media.ts. Nama aslinya tetap disimpan terpisah,
 * karena itulah yang dilihat pasien saat menerima dokumen.
 */
export async function simpanBerkasLampiran(berkas: File): Promise<BerkasTersimpan | null> {
  const nama = namaBerkasSimpanan(berkas.type, randomBytes(8).toString('hex'));
  if (!nama) return null;

  await mkdir(DIR_MEDIA, { recursive: true });
  const buffer = Buffer.from(await berkas.arrayBuffer());
  await writeFile(path.join(DIR_MEDIA, nama), buffer);

  return {
    relativePath: nama,
    mime: berkas.type,
    originalName: berkas.name.slice(0, 255),
    size: buffer.byteLength,
  };
}

/**
 * Menulis PDF surat yang DIRENDER SENDIRI (bukan unggahan) ke direktori yang
 * sama.
 *
 * Direktori yang sama, bukan direktori baru: `cleanupOrphanMedia()` memangkas
 * berkas yang tidak lagi ditunjuk baris `outbox` mana pun dengan MEMINDAI
 * direktori itu, jadi direktori kedua berarti setiap surat yang pernah dikirim
 * menetap di disk selamanya berikut nama dan alamat pasien di dalamnya.
 *
 * Dipakai DUA jalur -- kirim manual dari dashboard dan pengiriman otomatis di
 * worker. Dulu hanya ada di berkas `'use server'` milik dashboard, dan worker
 * tidak boleh mengimpor berkas itu; menyalinnya ke worker berarti dua tempat
 * memutuskan sendiri di mana surat pasien disimpan, dan yang menyimpang di
 * antaranya tidak akan pernah ikut terpangkas.
 */
export async function simpanPdfSurat(pdf: Buffer): Promise<string> {
  // Nama di disk selalu acak, tidak pernah diturunkan dari nama pasien -- nama
  // yang dilihat pasien disimpan terpisah di `outbox.media_name`.
  //
  // Ekstensinya `.pdf` mati di kode, dan itu bukan sekadar kerapian:
  // `MessageMedia.fromFilePath()` milik whatsapp-web.js menurunkan MIME
  // kiriman dari ekstensi berkas di disk, jadi ekstensi yang salah sampai ke
  // pasien sebagai berkas yang ditolak pembacanya tanpa satu pun keterangan.
  const nama = `${randomBytes(8).toString('hex')}.pdf`;
  await mkdir(DIR_MEDIA, { recursive: true });
  await writeFile(path.join(DIR_MEDIA, nama), pdf);
  return nama;
}

export async function hapusBerkasLampiran(relatif: string): Promise<void> {
  const absolut = resolveMediaPath(relatif);
  if (!absolut) return;
  await unlink(absolut).catch(() => {});
}

/**
 * Berkas yang tidak lagi ditunjuk baris outbox mana pun, untuk dipangkas
 * cleanup berkala.
 *
 * Sengaja mengembalikan daftar alih-alih menghapus sendiri: keputusan "berkas
 * ini sudah tidak dipakai" butuh query ke database, dan modul ini tidak
 * menyentuh database sama sekali. `umurMinimalMs` melindungi berkas yang BARU
 * diunggah tapi baris outbox-nya belum sempat ditulis.
 */
export async function daftarBerkasMedia(umurMinimalMs: number): Promise<string[]> {
  const batasWaktu = Date.now() - umurMinimalMs;
  let isi: string[];
  try {
    isi = await readdir(DIR_MEDIA);
  } catch {
    return []; // direktori belum pernah dibuat -- belum ada lampiran sama sekali
  }

  const hasil: string[] = [];
  for (const nama of isi) {
    const absolut = resolveMediaPath(nama);
    if (!absolut) continue;
    const info = await stat(absolut).catch(() => null);
    if (info?.isFile() && info.mtimeMs < batasWaktu) hasil.push(nama);
  }
  return hasil;
}
