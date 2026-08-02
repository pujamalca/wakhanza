/**
 * Mengisi `patient_contact` untuk SELURUH pasien sekaligus, sekali jalan.
 *
 * Kenapa ini perlu ada terpisah dari pipeline: `worker/contactResolver.ts`
 * menulis satu baris hanya SAAT sebuah pemicu sudah melewati pasien itu. Jadi
 * nomor yang tidak bisa dipakai baru muncul di halaman "Nomor bermasalah"
 * SESUDAH pasiennya gagal dikirimi -- satu per satu, seorang demi seorang.
 * Padahal ~40% nomor di `sik.pasien` tidak lolos normalisasi (core/phone.ts
 * diverifikasi terhadap 8.117 baris nyata: 59,5% langsung valid). Tanpa
 * pemindaian awal, ribuan pasien itu tak terlihat sampai gilirannya tiba dan
 * pesannya telanjur hilang.
 *
 * Sifatnya:
 * - `sik` tetap READ-ONLY (SELECT saja) -- F2.4, nomor di Khanza tidak pernah disentuh.
 * - Baris `source='manual'` TIDAK PERNAH ditimpa: koreksi petugas mengalahkan
 *   hasil normalisasi otomatis (F2.1-F2.3), dan skrip ini tidak boleh
 *   membatalkan pekerjaan yang sudah dilakukan orang.
 * - Aman dijalankan berulang.
 *
 * Pemakaian:
 *   npm run scan:contacts -- --dry-run    # hitung saja, tanpa menulis
 *   npm run scan:contacts
 */
import { QueryTypes } from 'sequelize';
import { PatientContact } from '../src/models';
import { normalizePhone } from '../src/core/phone';
import { sik } from '../src/db/sik';
import { db } from '../src/db/wakhanza';

/**
 * Dibaca per-batch lewat keyset pagination pada PRIMARY KEY, bukan OFFSET:
 * `WHERE no_rkm_medis > :terakhir` tetap lewat indeks berapa pun dalamnya,
 * sementara OFFSET besar memaksa MariaDB membaca-lalu-membuang baris sebelumnya.
 */
const UKURAN_BATCH = 1000;

/**
 * Jeda antar batch. `sik` sengaja dibatasi `pool.max: 2` supaya tidak berebut
 * koneksi dengan SIMRS yang sedang dipakai petugas (ARCHITECTURE §9.1); skrip
 * sekali-jalan ini tidak punya alasan untuk memakai jatah itu serakus mungkin.
 */
const JEDA_BATCH_MS = 50;

interface BarisPasien {
  no_rkm_medis: string;
  no_tlp: string | null;
}

function jeda(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await sik.authenticate();
  await db.authenticate();

  // Diambil sekali di depan: jumlahnya kecil (hanya yang pernah dikoreksi
  // petugas) dan memeriksanya per baris berarti satu query tambahan per pasien.
  const manual = await PatientContact.findAll({ where: { source: 'manual' }, attributes: ['noRkmMedis'] });
  const dilindungi = new Set(manual.map((m) => m.noRkmMedis));

  let terakhir = '';
  let dipindai = 0;
  let valid = 0;
  let ditulis = 0;
  const alasan = new Map<string, number>();

  console.log(`Memindai sik.pasien${dryRun ? ' (DRY RUN -- tidak menulis apa pun)' : ''}...`);
  if (dilindungi.size > 0) console.log(`  ${dilindungi.size} koreksi manual akan dilewati (tidak ditimpa).`);

  for (;;) {
    const batch = await sik.query<BarisPasien>(
      `SELECT no_rkm_medis, no_tlp FROM pasien
        WHERE no_rkm_medis > :terakhir
        ORDER BY no_rkm_medis
        LIMIT ${UKURAN_BATCH}`,
      { replacements: { terakhir }, type: QueryTypes.SELECT },
    );
    if (batch.length === 0) break;
    terakhir = batch[batch.length - 1]!.no_rkm_medis;
    dipindai += batch.length;

    const now = new Date();
    const untukTulis = [];

    for (const p of batch) {
      if (dilindungi.has(p.no_rkm_medis)) continue;

      const hasil = normalizePhone(p.no_tlp);
      if (hasil.ok) {
        valid++;
      } else {
        alasan.set(hasil.reason, (alasan.get(hasil.reason) ?? 0) + 1);
      }

      untukTulis.push({
        noRkmMedis: p.no_rkm_medis,
        rawValue: p.no_tlp?.slice(0, 40) ?? null,
        phoneE164: hasil.ok ? hasil.value : null,
        source: 'auto' as const,
        reason: hasil.ok ? null : hasil.reason,
        checkedAt: now,
        updatedBy: null,
      });
    }

    if (!dryRun && untukTulis.length > 0) {
      // `updatedBy` sengaja TIDAK ikut diperbarui -- kolom itu milik koreksi
      // petugas, dan baris yang sampai ke sini memang bukan baris manual.
      await PatientContact.bulkCreate(untukTulis, {
        updateOnDuplicate: ['rawValue', 'phoneE164', 'source', 'reason', 'checkedAt'],
      });
    }
    ditulis += untukTulis.length;

    process.stdout.write(`\r  ${dipindai} pasien dipindai...`);
    await jeda(JEDA_BATCH_MS);
  }

  const tidakValid = ditulis - valid;
  const persen = ditulis > 0 ? ((valid / ditulis) * 100).toFixed(1) : '0,0';

  console.log(`\n\nSelesai. ${dipindai} pasien dipindai.`);
  console.log(`  ${dilindungi.size} dilewati (koreksi manual)`);
  console.log(`  ${valid} nomor terpakai (${persen}%)`);
  console.log(`  ${tidakValid} nomor TIDAK bisa dipakai:`);
  for (const [r, n] of [...alasan.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(6)}  ${r}`);
  }
  if (dryRun) {
    console.log('\n(DRY RUN -- tidak ada yang ditulis. Jalankan tanpa --dry-run untuk menyimpan.)');
  } else {
    console.log('\nBuka /nomor-bermasalah untuk memperbaikinya sebelum pasien kehilangan pesan.');
  }

  await sik.close();
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
