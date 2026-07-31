import { QueryTypes } from 'sequelize';
import { sik } from './sik';
import { db } from './wakhanza';

export class ReadOnlyViolationError extends Error {}
export class AuditLogWritableError extends Error {}
export class SchemaMismatchError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Kolom sik yang dibutuhkan tidak ditemukan: ${missing.join(', ')}`);
  }
}

/**
 * N1 / ARCHITECTURE §9.1: buktikan SIK_DB_USER benar-benar tidak bisa menulis,
 * bukan cuma percaya nama user-nya "_ro". Dijalankan saat proses mulai
 * (worker/index.ts) dan lewat `npm run verify:db`.
 */
export async function assertSikReadOnly(): Promise<void> {
  const table = `_wakhanza_ro_check_${Date.now()}`;
  try {
    await sik.query(`CREATE TEMPORARY TABLE ${table} (id INT)`);
    // Kalau baris ini tercapai, hak tulis TIDAK tertolak — itu kesalahan konfigurasi fatal.
    await sik.query(`DROP TEMPORARY TABLE ${table}`).catch(() => undefined);
    throw new ReadOnlyViolationError(
      `SIK_DB_USER (${process.env.SIK_DB_USER}) bisa membuat tabel di 'sik'. ` +
        'Prinsip read-only TIDAK ditegakkan. Periksa GRANT MySQL — lihat TECH_STACK.md.',
    );
  } catch (err) {
    if (err instanceof ReadOnlyViolationError) throw err;
    // Error lain (access denied) berarti benar: tulis ditolak, seperti seharusnya.
  }
}

/**
 * ARCHITECTURE §9.5: buktikan audit_log betul-betul append-only untuk
 * WA_DB_USER, bukan berasumsi dari nama grant di dokumentasi.
 */
export async function assertAuditLogAppendOnly(): Promise<void> {
  try {
    await db.query("UPDATE audit_log SET action = action WHERE id = -1");
  } catch {
    return; // ditolak — benar
  }
  throw new AuditLogWritableError(
    `WA_DB_USER (${process.env.WA_DB_USER}) bisa UPDATE audit_log. ` +
      'Sifat append-only TIDAK ditegakkan. Lihat ARCHITECTURE §9.5.',
  );
}

/** Kolom sik yang benar-benar dibaca src/khanza/*.ts. Diperiksa saat mulai (Fase 0.7). */
export const REQUIRED_SIK_COLUMNS: Record<string, string[]> = {
  reg_periksa: ['no_rawat', 'no_reg', 'tgl_registrasi', 'jam_reg', 'no_rkm_medis', 'kd_poli', 'kd_dokter', 'stts', 'kd_pj'],
  pasien: ['no_rkm_medis', 'nm_pasien', 'no_tlp', 'kd_kab', 'kd_kec', 'kd_kel'],
  poliklinik: ['kd_poli', 'nm_poli'],
  dokter: ['kd_dokter', 'nm_dokter'],
  setting: ['nama_instansi', 'alamat_instansi', 'kontak', 'aktifkan'],
  booking_registrasi: ['no_rkm_medis', 'tanggal_periksa', 'jam_booking', 'kd_poli', 'kd_dokter', 'status'],
  periksa_lab: ['no_rawat', 'kd_jenis_prw', 'tgl_periksa', 'jam'],
  periksa_radiologi: ['no_rawat', 'kd_jenis_prw', 'tgl_periksa', 'jam'],
  resep_obat: ['no_resep', 'no_rawat', 'tgl_penyerahan', 'jam_penyerahan'],
  nota_jalan: ['no_rawat', 'no_nota', 'tanggal', 'jam'],
  penjab: ['kd_pj', 'png_jawab'],
  kabupaten: ['kd_kab', 'nm_kab'],
  kecamatan: ['kd_kec', 'nm_kec'],
  kelurahan: ['kd_kel', 'nm_kel'],
};

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
}

export async function assertRequiredSikColumnsExist(): Promise<void> {
  const tables = Object.keys(REQUIRED_SIK_COLUMNS);
  const rows = await sik.query<ColumnRow>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns
     WHERE TABLE_SCHEMA = :schema AND TABLE_NAME IN (:tables)`,
    { replacements: { schema: process.env.SIK_DB_NAME, tables }, type: QueryTypes.SELECT },
  );

  const present = new Set(rows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_SIK_COLUMNS)) {
    for (const col of columns) {
      if (!present.has(`${table}.${col}`)) missing.push(`${table}.${col}`);
    }
  }
  if (missing.length > 0) throw new SchemaMismatchError(missing);
}
