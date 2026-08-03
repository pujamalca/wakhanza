import { QueryTypes } from 'sequelize';
import { sik } from '../src/db/sik';
import { allPlanChecks } from '../src/khanza/planChecks';
import '../src/khanza'; // side-effect: setiap modul mendaftarkan query-nya

interface ExplainRow {
  table: string | null;
  type: string | null;
  key: string | null;
  rows: number | null;
  Extra: string | null;
}

/**
 * MariaDB memberi nama tabel turunan/materialized subquery seperti
 * `<derived2>` atau `<union1,2>`. Memindai tabel-tabel INI penuh itu wajar
 * dan murah -- ia sudah berupa hasil query dalam yang sudah disaring lebih
 * dulu, bukan tabel dasar sik yang besar. Yang harus dijaga adalah query
 * TERHADAP tabel dasar (mis. periksa_lab, reg_periksa), bukan terhadap hasil
 * antaranya sendiri.
 */
function isDerivedTable(table: string | null): boolean {
  return !!table && table.startsWith('<');
}

/**
 * MariaDB memakai `table = NULL` untuk baris EXPLAIN yang TIDAK menyentuh tabel
 * sama sekali: "Impossible WHERE noticed after reading const tables", "Select
 * tables optimized away", "No tables used". Semuanya berarti optimizer sudah
 * membuktikan hasilnya tanpa membaca apa pun -- kebalikan dari pemindaian
 * penuh, bukan bentuk terburuknya.
 *
 * Tanpa pengecualian ini, `type ?? 'ALL'` di bawah membaca kolom kosong itu
 * sebagai full scan dan pemeriksaannya GAGAL untuk query yang justru paling
 * murah. Ketahuan lewat query pencarian no. pendaftaran, yang nilai contohnya
 * memang sengaja tidak ada di database mana pun -- dan nilai contoh yang tidak
 * cocok dengan data nyata adalah keadaan normal untuk pemeriksaan rencana,
 * bukan kekecualian.
 */
function isTanpaTabel(row: ExplainRow): boolean {
  return row.table === null;
}

const DEFAULT_MAX_ROWS = 500;

async function main() {
  const checks = allPlanChecks();
  if (checks.length === 0) {
    console.log('[verify:plans] tidak ada query terdaftar (belum ada modul src/khanza/*.ts yang diimpor)');
    return;
  }

  let failed = false;

  for (const check of checks) {
    const label = check.name.padEnd(20, ' ');
    try {
      const rows = await sik.query<ExplainRow>(`EXPLAIN ${check.sql}`, {
        replacements: check.replacements,
        type: QueryTypes.SELECT,
      });

      for (const row of rows) {
        const type = row.type ?? 'ALL';
        const key = row.key;
        const rowCount = row.rows ?? 0;
        const maxRows = check.maxRows ?? DEFAULT_MAX_ROWS;
        const usingIndex = row.Extra?.includes('Using index') ? '  (Using index)' : '';
        const table = row.table ?? '?';

        if (isTanpaTabel(row)) {
          console.log(`[ok] ${label} (tanpa akses tabel: ${row.Extra ?? 'tidak ada tabel dipakai'})`);
          continue;
        }

        if (isDerivedTable(row.table)) {
          console.log(`[ok] ${label} ${table} (hasil subquery, sudah tersaring)  rows~${rowCount}`);
          continue;
        }

        // Izin pemindaian penuh berlaku per tabel, dan HANYA menggugurkan dua
        // pemeriksaan yang memang jadi tidak berlaku. Ambang `rows` tetap
        // ditegakkan: justru pada tabel yang boleh dipindai penuh itulah
        // asumsi "tabel ini kecil" perlu gagal berisik saat ternyata keliru.
        const bolehDipindai = check.allowFullScan?.includes(table) ?? false;

        const problems: string[] = [];
        if (type === 'ALL' && !bolehDipindai) problems.push(`type=ALL (full scan)`);
        if (!key && !bolehDipindai) problems.push('key=NULL (tidak pakai indeks)');
        if (rowCount > maxRows) problems.push(`rows=${rowCount} melampaui ambang ${maxRows}`);

        if (problems.length > 0) {
          failed = true;
          console.error(`[GAGAL] ${label} ${table} ${problems.join(', ')}`);
        } else if (bolehDipindai && type === 'ALL') {
          console.log(`[--] ${label} ${table} ${type} — pemindaian penuh yang disengaja  rows~${rowCount}`);
        } else {
          console.log(`[ok] ${label} ${table} ${type} ${key ?? ''}  rows~${rowCount}${usingIndex}`);
        }
      }
    } catch (err) {
      failed = true;
      console.error(`[GAGAL] ${label} error saat EXPLAIN: ${(err as Error).message}`);
    }
  }

  await sik.close();

  if (failed) {
    console.error(
      '\nverify:plans GAGAL — ada query poller yang berubah jadi mahal (lihat ARCHITECTURE §4.4, §4.8).',
    );
    process.exit(1);
  }
  console.log('\nverify:plans lolos.');
}

main().catch((err) => {
  console.error('[verify:plans] error tak terduga:', err);
  process.exit(1);
});
