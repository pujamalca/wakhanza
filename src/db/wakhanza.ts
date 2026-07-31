import { Sequelize } from 'sequelize';
import { wakhanzaDbConfig } from '@/lib/env';

const cfg = wakhanzaDbConfig();

/**
 * Koneksi BACA & TULIS ke database aplikasi wakhanza sendiri. Skema dibentuk
 * lewat migrations/*.sql bernomor — sequelize.sync() TIDAK PERNAH dipanggil
 * di mana pun dalam proyek ini (lihat TECH_STACK.md "Migrasi Skema").
 */
export const db = new Sequelize(cfg.database, cfg.user, cfg.password, {
  host: cfg.host,
  port: cfg.port,
  dialect: 'mysql',
  logging: false,
  define: { underscored: true, timestamps: false },
  pool: { max: 10, min: 0, idle: 10000 },
});
