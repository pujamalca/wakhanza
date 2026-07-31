import { Sequelize, QueryTypes } from 'sequelize';
import { sikDbConfig } from '@/lib/env';

const cfg = sikDbConfig();

/**
 * Koneksi HANYA BACA ke database SIMRS Khanza. Hak tulis ditegakkan di tingkat
 * MariaDB oleh user `wakhanza_ro` (lihat TECH_STACK.md) — lihat db/guards.ts
 * untuk pemeriksaan yang membuktikannya saat proses mulai.
 *
 * pool.max: 2 disengaja: SIMRS Khanza desktop membuka banyak koneksi dari tiap
 * komputer petugas, poller tidak boleh ikut menghabiskan jatah max_connections.
 */
export const sik = new Sequelize(cfg.database, cfg.user, cfg.password, {
  host: cfg.host,
  port: cfg.port,
  dialect: 'mysql',
  logging: false,
  pool: { max: 2, min: 0, idle: 10000 },
  dialectOptions: {
    // resep_obat.tgl_penyerahan pakai '0000-00-00' sebagai penanda "belum" —
    // wajib string, bukan Date JS (ARCHITECTURE §4.6).
    dateStrings: true,
    typeCast: true,
    connectTimeout: 10_000,
  },
});

const DEFAULT_TIMEOUT_SEC = Number(process.env.QUERY_TIMEOUT_SEC ?? '5');

/**
 * SELECT dengan batas waktu eksekusi MariaDB (ARCHITECTURE §12.3). Query yang
 * tersendat karena penguncian tabel oleh SIMRS harus gagal cepat, bukan
 * menahan siklus polling tanpa batas.
 */
export async function sikSelect<T extends object = Record<string, unknown>>(
  sql: string,
  replacements?: Record<string, unknown>,
  timeoutSec: number = DEFAULT_TIMEOUT_SEC,
): Promise<T[]> {
  const wrapped = `SET STATEMENT max_statement_time=${timeoutSec} FOR ${sql}`;
  return sik.query<T>(wrapped, { replacements, type: QueryTypes.SELECT });
}
