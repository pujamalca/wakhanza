import { FarmasiTarget, getSetting, getSettingNumber } from '@/models';
import { deteksiPermintaanStok, parseStokKeywords, formatStokObat } from '@/core/stokObat';
import { cariStokObat } from '@/khanza/stokObat';
import { loadAutoReplyContext, identityVars, enqueueMessage } from './pipeline';
import { logger, maskPhone } from '@/lib/logger';
import type { InboundMessage } from './autoReply';

/**
 * BALASAN STOK & HARGA OBAT -- cabang di dalam alur pesan masuk.
 *
 * Berdiri sendiri dari `autoreply.enabled`: apotek bisa menyalakan jawaban stok
 * tanpa menyalakan balasan otomatis umum, dan sebaliknya. Keduanya tetap berbagi
 * pemeriksaan yang mendahuluinya di `handleInboundMessage` (pesan kosong,
 * penyerahan ulang, kuota per nomor) -- memisahkan itu berarti satu nomor bisa
 * menghabiskan kuota lewat satu jalur lalu tetap dilayani lewat jalur lain.
 *
 * `trigger_code`-nya tetap AUTO_REPLY, bukan kode baru. Ini memang balasan atas
 * pesan yang penanya kirim sendiri, jadi seluruh perlakuannya harus sama:
 * melewati jam tenang (menahannya sampai 07.00 membuat jawaban datang sembilan
 * jam setelah pertanyaannya), dan tidak tunduk pada daftar tolak (mendiamkan
 * orang yang baru saja bertanya bukan menghormati permintaannya). Kode baru
 * berarti kedua keputusan itu harus didaftarkan ulang di `core/optOut.ts` dan
 * `core/quietHours.ts` -- dan yang lupa mendaftarkannya tidak akan mendapat
 * satu pun galat.
 */

export type ModeStok = 'mati' | 'petugas' | 'semua';

export interface HasilStokReply {
  /** true = pertanyaannya sudah ditangani di sini; jangan lanjut ke aturan kata kunci. */
  ditangani: boolean;
  /** Untuk log dan pengujian: cabang mana yang dipakai. */
  cabang?: 'ketemu' | 'kosong' | 'tanpa_nama';
}

const TIDAK_DITANGANI: HasilStokReply = { ditangani: false };

export async function bacaModeStok(): Promise<ModeStok> {
  const nilai = (await getSetting('farmasi.stok_mode', 'mati')) ?? 'mati';
  return nilai === 'petugas' || nilai === 'semua' ? nilai : 'mati';
}

/**
 * Mode 'petugas': hanya nomor yang terdaftar sebagai tujuan farmasi jenis
 * `personal` yang dijawab.
 *
 * Memakai ulang `farmasi_target` alih-alih membuat daftar putih kedua. Daftar
 * kedua berarti dua tempat yang harus diingat saat seorang petugas apotek
 * berganti nomor, dan yang terlupakan akan gagal DIAM -- petugasnya sekadar
 * tidak pernah dijawab.
 *
 * Grup tidak perlu diperiksa di sini: pesan grup memang tidak pernah sampai ke
 * jalur balasan sama sekali (lihat `wa-client.ts`), karena menjawab di dalam
 * grup berarti seluruh anggota menerima jawaban atas pertanyaan satu orang.
 */
async function bolehBertanya(mode: ModeStok, phoneE164: string): Promise<boolean> {
  if (mode === 'semua') return true;
  const jumlah = await FarmasiTarget.count({
    where: { chatId: `${phoneE164}@c.us`, isActive: true },
  });
  return jumlah > 0;
}

/**
 * Menyusun jawaban untuk sebuah pertanyaan stok. FUNGSI YANG SAMA dipakai kotak
 * uji coba di dashboard -- yang membedakan cuma pengirimannya.
 *
 * @returns null bila pesannya bukan pertanyaan stok sama sekali.
 */
export async function susunJawabanStok(
  teks: string,
  identity: { namaRs: string; alamatRs: string; kontakRs: string },
): Promise<{ body: string; cabang: 'ketemu' | 'kosong' | 'tanpa_nama'; cari: string } | null> {
  const keywords = parseStokKeywords((await getSetting('farmasi.stok_keywords', 'stok,harga')) ?? '');
  const permintaan = deteksiPermintaanStok(teks, keywords);
  if (!permintaan.cocok) return null;

  const vars = { ...identityVars(identity), cari_obat: permintaan.cari };

  if (!permintaan.cari) {
    const body = (await getSetting('farmasi.stok_template_tanpa_nama', '')) ?? '';
    return { body: renderDenganVars(body, vars), cabang: 'tanpa_nama', cari: '' };
  }

  const maks = await getSettingNumber('farmasi.stok_max_hasil', 5);
  const hargaDipakai = (await getSetting('farmasi.stok_harga', 'jualbebas')) === 'ralan' ? 'ralan' : 'jualbebas';

  // maks + 1 dibaca supaya "ada yang terpotong" bisa dibedakan dari "kebetulan
  // pas" -- pola yang sama dipakai jadwal dokter.
  const rows = await cariStokObat(permintaan.cari, maks + 1);

  if (rows.length === 0) {
    const body = (await getSetting('farmasi.stok_template_kosong', '')) ?? '';
    return { body: renderDenganVars(body, vars), cabang: 'kosong', cari: permintaan.cari };
  }

  const ditampilkan = rows.slice(0, maks);
  const daftar = formatStokObat(ditampilkan, {
    // Angka persediaan hanya untuk petugas. Bagi penanya umum yang perlu
    // diketahui adalah perlu-tidaknya ia datang, bukan berapa banyak sisa di
    // gudang -- itu informasi dagang apotek.
    tampilkanJumlah: (await bacaModeStok()) === 'petugas',
    hargaDipakai,
    truncatedFrom: rows.length,
  });

  const body = (await getSetting('farmasi.stok_template', '')) ?? '';
  return { body: renderDenganVars(body, { ...vars, stok_obat: daftar }), cabang: 'ketemu', cari: permintaan.cari };
}

/**
 * Dirender DI SINI, bukan diserahkan ke `enqueueMessage` lewat `vars`.
 *
 * Sebabnya `{stok_obat}` berbentuk banyak baris dan sudah dirakit
 * `formatStokObat()` -- yang memanggil `sanitizeValue()` sendiri untuk tiap nama
 * obat dan satuan. Menyerahkannya sebagai variabel biasa akan membuat seluruh
 * daftar dipotong di 60 karakter dan baris barunya dibuang. Ia memang terdaftar
 * di MULTILINE_VARIABLES, tapi merendernya di sini membuat teks yang tersimpan
 * di `outbox.body` persis sama dengan yang dilihat staf di kotak uji coba.
 */
function renderDenganVars(body: string, vars: Record<string, string>): string {
  // Satu lintasan kiri-ke-kanan, sama seperti renderTemplate -- hasil
  // substitusi tidak pernah diperiksa ulang, jadi nama obat yang kebetulan
  // berisi `{kontak_rs}` tetap tampil apa adanya.
  return body.replace(/\{([a-z_]+)\}/g, (cocok, kunci: string) => vars[kunci] ?? cocok);
}

/**
 * Cabang stok di dalam `handleInboundMessage`. Mengembalikan `ditangani: false`
 * bila pesannya bukan urusan stok, sehingga alur lanjut ke aturan kata kunci
 * biasa seperti sebelum fitur ini ada.
 */
export async function cobaBalasStok(msg: InboundMessage, idempotencyKey: string): Promise<HasilStokReply> {
  const mode = await bacaModeStok();
  if (mode === 'mati') return TIDAK_DITANGANI;

  /**
   * Pemeriksaan izin dikerjakan SEBELUM kata kunci dibaca, dan urutan itu
   * disengaja: nomor yang tidak berhak harus jatuh ke aturan kata kunci biasa
   * seolah fitur ini tidak ada. Membalikkannya berarti pertanyaan stok dari
   * nomor tak berhak "tertangani" lalu didiamkan -- dan aturan /balasan-otomatis
   * yang sebenarnya cocok tidak pernah sempat dijalankan.
   */
  if (!(await bolehBertanya(mode, msg.phoneE164))) return TIDAK_DITANGANI;

  const ctxAwal = await loadAutoReplyContext('');
  const jawaban = await susunJawabanStok(msg.text, ctxAwal.identity);
  if (!jawaban) return TIDAK_DITANGANI;

  // Template yang dikosongkan admin = sengaja diam untuk cabang itu, sama
  // seperti `autoreply.fallback_body` yang kosong berarti tidak menjawab.
  // Tetap `ditangani`, supaya tidak jatuh ke aturan kata kunci yang akan
  // menjawab pertanyaan stok dengan sesuatu yang tidak berhubungan.
  if (!jawaban.body.trim()) {
    logger.info(
      { phone: maskPhone(msg.phoneE164), cabang: jawaban.cabang },
      'balasan stok: template cabang ini kosong, sengaja tidak menjawab',
    );
    return { ditangani: true, cabang: jawaban.cabang };
  }

  const ctx = await loadAutoReplyContext(jawaban.body);
  await enqueueMessage(
    {
      idempotencyKey,
      noRkmMedis: null,
      rawPhone: null,
      phoneOverride: msg.phoneE164,
      eventAt: new Date(),
      // Body-nya sudah jadi; `vars` kosong supaya tidak dirender dua kali --
      // perenderan berulang persis yang dilarang aturan satu lintasan.
      vars: {},
    },
    ctx,
  );

  logger.info(
    { phone: maskPhone(msg.phoneE164), cabang: jawaban.cabang, cari: jawaban.cari },
    'balasan stok obat terkirim ke antrean',
  );
  return { ditangani: true, cabang: jawaban.cabang };
}
