/**
 * Pratinjau BALASAN STOK & KETERSEDIAAN OBAT tanpa mengirim apa pun
 * (migrations/019, 022, 039).
 *
 *   npm run dryrun:stok                          -- daftar pertanyaan bawaan
 *   npm run dryrun:stok -- "ada paracetamol?"    -- pertanyaan sendiri
 *   npm run dryrun:stok -- "adakah amlodipin" "ada poli apa"
 *
 * Ada karena pertanyaan yang datang ke nomor rumah sakit ditulis MANUSIA, dan
 * bentuknya tidak bisa ditebak dari kode. Yang perlu dibuktikan bukan "kata
 * kuncinya cocok" melainkan tiga hal sekaligus untuk tiap kalimat:
 *
 *   1. dijawab atau dilepas ke aturan /balasan-otomatis, dan KENAPA;
 *   2. berapa banyak yang disebut kepada petugas apotek; dan
 *   3. berapa banyak yang disebut kepada nomor umum.
 *
 * Yang ketiga itu yang paling sulit dilihat dengan cara lain: selama
 * `farmasi.stok_mode` masih `petugas`, satu-satunya jalan melihat bentuk
 * jawaban untuk nomor umum adalah menyalakan mode `semua` lebih dulu -- yaitu
 * mengujinya di hadapan orang sungguhan.
 *
 * Memanggil `susunJawabanStok()` yang SAMA dipakai worker, berikut pemeriksa
 * aturan yang sama, jadi yang tercetak di sini memang yang akan terkirim.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim, TIDAK mengubah satu pun pengaturan.
 */
import './../src/lib/env';

/**
 * Bentuk pertanyaan yang benar-benar wajar diketik orang, DITAMBAH tiga
 * kalimat yang justru TIDAK boleh dibajak ke jalur obat. Yang terakhir itu
 * bagian terpentingnya: daftar yang isinya cuma pertanyaan obat akan selalu
 * terlihat berhasil.
 */
const BAWAAN = [
  'apotek adakah obat paracetamol',
  'ada paracetamol?',
  'jual obat amlodipin tidak',
  'ready paracetamol ga',
  'stok paracetamol',
  'berapa harga paracetamol',
  'adakah obat yang-tidak-ada-di-katalog',
  'ada poli apa',
  'ada dokter jaga hari ini',
  'jadwal dokter',
  'apotek',
];

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { getSetting } = await import('../src/models');
  const { susunJawabanStok, bacaModeStok, bacaRincianUmum } = await import('../src/worker/stokReply');
  const { loadActiveRules } = await import('../src/worker/autoReply');
  const { matchRule } = await import('../src/core/autoReply');
  const { getHospitalIdentity } = await import('../src/khanza/common');

  const pertanyaan = process.argv.slice(2).filter(Boolean);
  const daftar = pertanyaan.length > 0 ? pertanyaan : BAWAAN;

  console.log(`Database Khanza : ${sikDbConfig().database}`);
  console.log(`Mode akses      : ${await bacaModeStok()}`);
  console.log(`Kata kunci ketat: ${(await getSetting('farmasi.stok_keywords', '')) ?? ''}`);
  console.log(`Kata ketersediaan: ${(await getSetting('farmasi.stok_keywords_ketersediaan', '')) ?? ''}`);
  console.log(`Rincian umum    : ${await bacaRincianUmum()}`);

  const identitas = await getHospitalIdentity();

  for (const teks of daftar) {
    console.log(`\n${'='.repeat(72)}\nTANYA: ${teks}`);

    // Pemeriksa aturan yang SAMA diserahkan worker -- tanpa ini, pratinjau
    // menjawab pertanyaan yang di produksi justru dimenangkan sebuah aturan.
    const aturanCocok = async () => matchRule(teks, await loadActiveRules()) !== null;

    for (const penanya of ['petugas', 'umum'] as const) {
      const j = await susunJawabanStok(teks, identitas, penanya, aturanCocok);
      if (j.aksi === 'lanjut') {
        console.log(`  [${penanya.padEnd(7)}] DILEPAS ke /balasan-otomatis — ${j.sebab}${j.cari ? ` (cari "${j.cari}")` : ''}`);
        continue;
      }
      const isi = j.body.trim() ? j.body.replace(/\n/g, '\n            ') : '(teks cabang ini dikosongkan = sengaja diam)';
      console.log(`  [${penanya.padEnd(7)}] ${j.cabang}\n            ${isi}`);
    }
  }

  await sik.close();
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
