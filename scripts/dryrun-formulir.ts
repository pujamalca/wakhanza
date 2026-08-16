/**
 * Pratinjau FORMULIR LEWAT WHATSAPP -- menjalankan seluruh percakapan seperti
 * yang akan dialami pasien, TANPA mengirim apa pun dan tanpa menulis satu baris
 * pun.
 *
 * Ada karena bentuk percakapan ini mustahil dilihat dari dashboard: yang tampil
 * di sana daftar pertanyaan, sementara yang diterima pasien adalah rentetan
 * pesan berikut penomoran langkah, daftar pilihan, keterangan boleh-dikosongkan,
 * dan ringkasan penutup. Satu-satunya cara lain melihatnya adalah menyalakan
 * fiturnya lalu mengetik sendiri ke nomor rumah sakit -- yaitu mengujinya di
 * hadapan pasien sungguhan.
 *
 * Memakai `cocokFormulir()`, `mulaiFormulir()`, dan `lanjutkanFormulir()` yang
 * SAMA PERSIS dipakai worker. Pratinjau yang berbeda dari kenyataan lebih buruk
 * daripada tanpa pratinjau.
 *
 * Pemakaian:
 *   npm run dryrun:formulir                      -- semua formulir aktif
 *   npm run dryrun:formulir -- "request obat"    -- yang dipicu kalimat ini
 *
 * Kode keluar 1 bila ada formulir yang tersimpan tapi TIDAK BISA berjalan --
 * lihat `periksaKesehatan()`.
 */

import '@/lib/env';
import { WaForm, WaFormField, parseKeywords } from '@/models';
import {
  cocokFormulir,
  mulaiFormulir,
  lanjutkanFormulir,
  isTipeField,
  type FieldFormulir,
  type KeadaanFormulir,
  type RingkasanFormulir,
} from '@/core/waFormulir';
import type { MatchMode } from '@/core/autoReply';
import { db } from '@/db/wakhanza';

function garis(judul: string): void {
  console.log(`\n${'='.repeat(72)}\n${judul}\n${'='.repeat(72)}`);
}

/** Jawaban contoh yang sah menurut tipe pertanyaannya. */
function jawabanContoh(f: FieldFormulir): string {
  if (f.tipe === 'angka') return '10';
  if (f.tipe === 'pilihan') return '1';
  return `(contoh jawaban untuk "${f.label}")`;
}

async function bacaFormulir(): Promise<RingkasanFormulir[]> {
  const forms = await WaForm.findAll({ order: [['priority', 'ASC'], ['id', 'ASC']] });
  if (forms.length === 0) return [];

  const fields = await WaFormField.findAll({
    where: { formId: forms.map((f) => f.id) },
    order: [['urutan', 'ASC'], ['id', 'ASC']],
  });

  const perForm = new Map<number, FieldFormulir[]>();
  for (const f of fields) {
    const daftar = perForm.get(f.formId) ?? [];
    daftar.push({
      id: f.id,
      label: f.label,
      tipe: isTipeField(f.tipe) ? f.tipe : 'teks',
      wajib: f.wajib,
      pilihan: f.pilihanJson ? (JSON.parse(f.pilihanJson) as string[]) : [],
      maksPanjang: f.maksPanjang,
    });
    perForm.set(f.formId, daftar);
  }

  return forms.map((f) => ({
    id: f.id,
    nama: f.nama,
    keywords: parseKeywords(f.kataKunci),
    matchMode: (f.matchMode === 'exact' ? 'exact' : 'contains') as MatchMode,
    priority: f.priority,
    pesanPembuka: f.pesanPembuka,
    pesanPenutup: f.pesanPenutup,
    fields: perForm.get(f.id) ?? [],
    aktif: f.isActive,
    bolehGrup: f.bolehGrup,
  })) as Array<RingkasanFormulir & { aktif: boolean; bolehGrup: boolean }>;
}

/**
 * Keadaan yang membuat sebuah formulir TIDAK PERNAH menjawab walau tampak wajar
 * di dashboard. Semuanya gagal DIAM di produksi -- tidak ada galat, tidak ada
 * baris outbox, cuma pasien yang mengetik kata kuncinya lalu tidak terjadi apa
 * pun.
 */
function periksaKesehatan(f: RingkasanFormulir & { aktif: boolean }): string[] {
  const salah: string[] = [];
  if (f.fields.length === 0) salah.push('tidak punya satu pun pertanyaan, jadi tidak pernah dicocokkan');
  if (f.keywords.length === 0) salah.push('tidak punya kata kunci, jadi tidak ada yang menjaringnya');
  if (!f.pesanPenutup.trim()) salah.push('kalimat penutupnya kosong, jadi pasien tidak diberi tahu apa yang berikutnya');
  for (const q of f.fields) {
    if (q.tipe === 'pilihan' && q.pilihan.length < 2) {
      salah.push(`pertanyaan "${q.label}" bertipe pilihan tapi pilihannya kurang dari dua`);
    }
  }
  return salah;
}

/** Menjalankan satu percakapan penuh dan mencetak tiap pesan apa adanya. */
function mainkan(form: RingkasanFormulir): boolean {
  let hasil = mulaiFormulir(form);
  if (hasil.aksi !== 'tanya') {
    console.log('  [!] formulir ini tidak bisa dimulai sama sekali.');
    return false;
  }

  console.log('\n--- RS ---');
  console.log(hasil.balasan);

  let keadaan: KeadaanFormulir = hasil.keadaan;
  let langkah = 0;

  // Berbatas keras: keadaan yang menyimpang tidak boleh membuat skrip pratinjau
  // berputar selamanya di terminal seseorang.
  while (langkah < 50) {
    const f = keadaan.pertanyaan[keadaan.indeks];
    if (!f) break;
    const jawab = jawabanContoh(f);
    console.log(`\n--- pasien ---\n${jawab}`);

    const berikut = lanjutkanFormulir(keadaan, jawab);
    console.log('\n--- RS ---');
    console.log(berikut.balasan);

    if (berikut.aksi === 'selesai') {
      console.log('\n--- YANG TERSIMPAN ---');
      for (const j of berikut.simpan.jawaban) {
        console.log(`  ${j.pertanyaan}  ->  ${j.jawaban === '' ? '(kosong)' : j.jawaban}`);
      }
      return true;
    }
    if (berikut.aksi === 'batal') return false;
    keadaan = berikut.keadaan;
    langkah++;
  }
  console.log('  [!] percakapan tidak selesai dalam 50 langkah.');
  return false;
}

async function main(): Promise<void> {
  const kalimat = process.argv.slice(2).filter(Boolean);
  const semua = (await bacaFormulir()) as Array<RingkasanFormulir & { aktif: boolean; bolehGrup: boolean }>;

  if (semua.length === 0) {
    console.log('Belum ada satu pun formulir tersimpan. Buat dulu di /formulir?tab=formulir.');
    return;
  }

  garis('FORMULIR TERSIMPAN');
  let adaMasalah = false;
  for (const f of semua) {
    const salah = periksaKesehatan(f);
    const tanda = !f.aktif ? '[nonaktif]' : salah.length > 0 ? '[BERMASALAH]' : '[aktif]';
    console.log(
      `${tanda} ${f.nama}  · kunci: ${f.keywords.join(', ') || '(kosong)'} · ${f.fields.length} pertanyaan · urut ${f.priority}${f.bolehGrup ? ' · boleh grup' : ''}`,
    );
    for (const s of salah) {
      console.log(`    - ${s}`);
      // Hanya yang AKTIF menggagalkan: formulir yang masih disusun staf memang
      // belum lengkap, dan menggagalkan skrip karenanya membuat pemeriksaan ini
      // berbunyi setiap hari lalu berhenti dibaca.
      if (f.aktif) adaMasalah = true;
    }
  }

  const aktif = semua.filter((f) => f.aktif);

  if (kalimat.length > 0) {
    for (const k of kalimat) {
      garis(`KALIMAT: "${k}"`);
      const cocok = cocokFormulir(k, aktif);
      if (!cocok) {
        console.log('Tidak memicu formulir apa pun — pesannya akan lanjut ke balasan stok / balasan otomatis.');
        continue;
      }
      console.log(`Memicu formulir: ${cocok.nama}`);
      mainkan(cocok);
    }
  } else {
    for (const f of aktif) {
      garis(`FORMULIR: ${f.nama}`);
      mainkan(f);
    }
    if (aktif.length === 0) {
      console.log('\nTidak ada formulir yang aktif, jadi tidak ada percakapan untuk dimainkan.');
    }
  }

  if (adaMasalah) {
    console.log('\n[GAGAL] ada formulir AKTIF yang tidak akan pernah menjawab. Lihat tanda [BERMASALAH] di atas.');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
