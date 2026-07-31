import { sikSelect } from '@/db/sik';

/**
 * Format tanggal sesuai enkode di primary key Khanza (`YYYY/MM/DD/...` pada
 * no_rawat, dst — ARCHITECTURE §4.4). Dipakai sebagai pemangkas indeks, BUKAN
 * penentu ketepatan (itu tugas kolom timestamp asli + poll_cursor).
 *
 * Sengaja memakai komponen tanggal LOKAL (bukan toISOString/UTC) — proses ini
 * diasumsikan berjalan di server RS berzona WIB, dan pergeseran UTC dekat
 * tengah malam bisa membuat prefix meleset satu hari.
 */
export function formatRawatPrefix(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/** Sama seperti formatRawatPrefix tapi untuk no_resep (YYYYMMDDNNNN, §4.4). */
export function formatResepPrefix(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Format tanggal SQL biasa (YYYY-MM-DD) -- untuk tabel dengan kolom tanggal yang benar-benar terindeks (nota_jalan/nota_inap, §4.4). */
export function formatSqlDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function lookbackDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export interface HospitalIdentity {
  namaRs: string;
  alamatRs: string;
  kontakRs: string;
}

let identityCache: { value: HospitalIdentity; at: number } | null = null;
const IDENTITY_CACHE_TTL_MS = 60 * 60 * 1000; // §12.2: tabel setting dimuat sekali, disegarkan tiap jam

/**
 * F3.3: nama rumah sakit TIDAK BOLEH ditulis tetap di kode — selalu dari
 * sik.setting. Tabel ini kecil dan nyaris tidak pernah berubah, jadi aman
 * di-cache di memori worker selama satu jam.
 */
export async function getHospitalIdentity(): Promise<HospitalIdentity> {
  if (identityCache && Date.now() - identityCache.at < IDENTITY_CACHE_TTL_MS) {
    return identityCache.value;
  }
  const rows = await sikSelect<{ nama_instansi: string; alamat_instansi: string | null; kontak: string }>(
    'SELECT nama_instansi, alamat_instansi, kontak FROM setting LIMIT 1',
  );
  const row = rows[0];
  const value: HospitalIdentity = {
    namaRs: row?.nama_instansi ?? '',
    alamatRs: row?.alamat_instansi ?? '',
    kontakRs: row?.kontak ?? '',
  };
  identityCache = { value, at: Date.now() };
  return value;
}
