/**
 * Pratinjau pemicu BPJS terhadap database Khanza MANA PUN, bukan hanya yang
 * sedang dipakai produksi.
 *
 * Kenapa terpisah dari `poll:dryrun`: kedua tabel BPJS sering KOSONG di
 * instalasi yang baru menyalakan bridging Mobile JKN, sementara salinan atau
 * arsip yang memuat riwayatnya ada di database lain di mesin yang sama. Tanpa
 * cara mengarahkan ke sana, satu-satunya "bukti" yang bisa didapat adalah nol
 * baris -- yang sama sekali tidak membedakan "query-nya benar dan datanya
 * memang belum ada" dari "query-nya salah".
 *
 *   npm run dryrun:bpjs -- <nama-database> [tanggal-contoh-kontrol]
 *
 * Yang WAJIB diperhatikan kalau berkas ini diubah: nama database di-override
 * SESUDAH `lib/env` selesai memuat `.env` (yang menimpa process.env), lalu
 * modul yang membaca konfigurasi diimpor SECARA DINAMIS. Mengubah impor di
 * dalam main() menjadi `import` biasa di puncak berkas membuat override-nya
 * tidak berpengaruh sama sekali -- dan gejalanya bukan galat, melainkan hasil
 * yang diam-diam berasal dari database yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK memajukan cursor, TIDAK mengirim apa pun.
 * `.env` tidak disentuh, jadi worker yang sedang berjalan tidak terpengaruh.
 */
import './../src/lib/env';
// Impor TIPE saja -- terhapus saat kompilasi, jadi ia tidak memuat modulnya dan
// tidak membekukan konfigurasi database sebelum override di bawah berjalan.
import type { BpjsKontrolRow } from '../src/khanza/bpjsKontrol';

const dbArg = process.argv[2];
if (dbArg) process.env.SIK_DB_NAME = dbArg;

/** Tanggal contoh, untuk melihat BENTUK pesan saat hari ini kebetulan kosong. */
const tanggalContoh = process.argv[3];

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { pollBpjsBatal } = await import('../src/khanza/bpjsBatal');
  const { pollBpjsKontrol } = await import('../src/khanza/bpjsKontrol');
  const { varsBatal, varsKontrol } = await import('../src/worker/bpjsRunner');
  const { bacaHariSebelum, sasaranKontrol } = await import('../src/core/bpjs');
  const { renderTemplate } = await import('../src/core/template');
  const { checkPrivacy } = await import('../src/core/privacy');
  const { normalizePhone } = await import('../src/core/phone');
  const { getSetting, getSettingJson } = await import('../src/models');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(`=== dryrun:bpjs terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`);

  const sensitivePoli = await getSettingJson<string[]>('privacy.sensitive_poli_codes', []);
  const sensitiveExam = await getSettingJson<string[]>('privacy.sensitive_exam_codes', []);
  const idVars = identityVars(await getHospitalIdentity());
  const aman = (kdPoli: string | null) => checkPrivacy({ kdPoli }, sensitivePoli, sensitiveExam).safe;
  const kutip = (teks: string) => teks.replace(/^/gm, '  | ');

  /**
   * Baris kode pengiriman ikut ditampilkan, memakai template yang SAMA dibaca
   * enqueueMessage. Pratinjau yang menampilkan bentuk pesan berbeda dari yang
   * benar-benar terkirim adalah persis yang dilarang di CLAUDE.md -- di sini
   * akibatnya konkret: staf menghitung panjang pesan tanpa baris itu.
   */
  const kodeTemplate = await loadUniqueCodeTemplate();
  const jadi = (body: string, vars: Record<string, string>, kunci: string) =>
    kutip(appendUniqueCode(renderTemplate(body, vars), kunci, kodeTemplate, new Date()));

  try {
    // ----------------------------------------------------------------------
    // Pembatalan Mobile JKN -> loket
    // ----------------------------------------------------------------------
    const batal = await pollBpjsBatal(new Date('2000-01-01'));
    console.log(`BPJS_BATAL: ${batal.length} baris (tujuan GRUP/PETUGAS, bukan pasien)`);

    if (batal.length > 0) {
      const body = (await getSetting('bpjs.template_batal', '')) ?? '';
      const generik = (await getSetting('bpjs.template_batal_generic', '')) ?? '';
      console.log(`  poli sensitif        : ${batal.filter((r) => !aman(r.kd_poli)).length}`);
      console.log(`  poli tak terpetakan  : ${batal.filter((r) => !r.kd_poli).length}  (maping_poli_bpjs tidak punya barisnya)`);
      for (const r of batal.slice(0, 2)) {
        console.log(`\n  --- booking ${r.nobooking} | kd_poli Khanza: ${r.kd_poli ?? '(tak terpetakan)'} ---`);
        console.log(
          jadi(
            aman(r.kd_poli) ? body : generik,
            { ...idVars, ...varsBatal(r) },
            buildIdempotencyKey('BPJS_BATAL', r.nobooking, 'contoh@g.us'),
          ),
        );
      }
      // Pagar privasi diperiksa pada OBJEK BARISNYA, bukan dengan membaca SQL:
      // kolom yang tidak ada di sini tidak mungkin bocor lewat template mana pun.
      console.log(`\n  kolom yang benar-benar terbaca: ${Object.keys(batal[0] ?? {}).join(', ')}`);
    }

    // ----------------------------------------------------------------------
    // Pengingat surat kontrol -> pasien
    // ----------------------------------------------------------------------
    const rawHari = (await getSetting('bpjs.kontrol_hari_sebelum', '1')) ?? '1';
    const sasaran = sasaranKontrol(bacaHariSebelum(rawHari), new Date());
    const hariIni = await pollBpjsKontrol(sasaran.map((s) => s.tanggal));
    console.log(
      `\n\nBPJS_KONTROL: ${hariIni.length} baris untuk tanggal ${sasaran.map((s) => s.tanggal).join(', ')} (H-${rawHari})`,
    );

    let rows: BpjsKontrolRow[] = hariIni;
    let hariSebelum = sasaran[0]?.hariSebelum ?? 0;
    if (rows.length === 0 && tanggalContoh) {
      rows = await pollBpjsKontrol([tanggalContoh]);
      hariSebelum = 1;
      console.log(`  (kosong hari ini; memakai contoh tanggal ${tanggalContoh}: ${rows.length} baris)`);
    }

    if (rows.length > 0) {
      let sepMenyelamatkan = 0;
      let tanpaNomor = 0;
      for (const r of rows) {
        if (normalizePhone(r.no_tlp).ok) continue;
        if (normalizePhone(r.notelep).ok) sepMenyelamatkan++;
        else tanpaNomor++;
      }
      console.log(`  no_tlp tak terpakai, diselamatkan SEP : ${sepMenyelamatkan}`);
      console.log(`  benar-benar tanpa nomor              : ${tanpaNomor}`);

      const body = (await getSetting('bpjs.template_kontrol', '')) ?? '';
      for (const r of rows.slice(0, 2)) {
        console.log(`\n  --- surat ${r.no_surat} | rencana ${r.tgl_rencana} | kd_poli Khanza: ${r.kd_poli ?? '(tak terpetakan)'} ---`);
        console.log(
          jadi(
            body,
            { ...idVars, ...varsKontrol(r, hariSebelum) },
            buildIdempotencyKey('BPJS_KONTROL', r.no_surat, r.tgl_rencana, String(hariSebelum)),
          ),
        );
      }
      console.log(`\n  kolom yang benar-benar terbaca: ${Object.keys(rows[0] ?? {}).join(', ')}`);
    }
  } finally {
    await sik.close();
    await db.close();
  }
}

main().catch((err) => {
  console.error('[dryrun:bpjs] gagal:', err);
  process.exit(1);
});
