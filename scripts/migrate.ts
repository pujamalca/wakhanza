import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { wakhanzaDbConfig } from '../src/lib/env';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main() {
  const config = wakhanzaDbConfig();
  const conn = await mysql.createConnection({ ...config, multipleStatements: true });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename as string));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[migrate] tidak ada berkas migrasi di migrations/');
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] lewati  ${file} (sudah diterapkan)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] jalankan ${file} ...`);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`[migrate] selesai  ${file}`);
      ran++;
    }

    console.log(ran === 0 ? '[migrate] sudah mutakhir, tidak ada yang dijalankan' : `[migrate] ${ran} migrasi diterapkan`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate] gagal:', err.message);
  process.exit(1);
});
