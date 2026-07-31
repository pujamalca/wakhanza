import { QueryTypes } from 'sequelize';
import { sik } from '../src/db/sik';
import { db } from '../src/db/wakhanza';
import { assertSikReadOnly, assertAuditLogAppendOnly, assertRequiredSikColumnsExist } from '../src/db/guards';

function ok(msg: string) {
  console.log(`[ok] ${msg}`);
}
function fail(msg: string) {
  console.error(`[gagal] ${msg}`);
}

async function main() {
  let failed = false;

  try {
    await sik.authenticate();
    const sikCountRows = await sik.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = :schema',
      { replacements: { schema: process.env.SIK_DB_NAME }, type: QueryTypes.SELECT },
    );
    await assertRequiredSikColumnsExist();
    ok(`sik      : tersambung, ${sikCountRows[0]?.n ?? '?'} tabel, kolom lengkap`);
  } catch (err) {
    failed = true;
    fail(`sik      : ${(err as Error).message}`);
  }

  try {
    await assertSikReadOnly();
    ok('sik      : tulis DITOLAK (benar)');
  } catch (err) {
    failed = true;
    fail(`sik      : ${(err as Error).message}`);
  }

  try {
    await db.authenticate();
    const waCountRows = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = :schema',
      { replacements: { schema: process.env.WA_DB_NAME }, type: QueryTypes.SELECT },
    );
    ok(`wakhanza : tersambung, ${waCountRows[0]?.n ?? '?'} tabel`);
  } catch (err) {
    failed = true;
    fail(`wakhanza : ${(err as Error).message}`);
  }

  try {
    await assertAuditLogAppendOnly();
    ok('audit_log: DELETE/UPDATE DITOLAK (benar)');
  } catch (err) {
    failed = true;
    fail(`audit_log: ${(err as Error).message}`);
  }

  await sik.close();
  await db.close();

  if (failed) {
    console.error('\nverify:db GAGAL — jangan jalankan worker sampai ini semua [ok].');
    process.exit(1);
  }
  console.log('\nverify:db lolos.');
}

main().catch((err) => {
  console.error('[verify:db] error tak terduga:', err);
  process.exit(1);
});
