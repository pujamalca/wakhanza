/**
 * PERINTAH LEWAT WHATSAPP -- penguraian perintah dan seluruh mesin keadaan
 * wizardnya.
 *
 * Berkas ini MURNI: tanpa database, tanpa WhatsApp, tanpa jam. Segala yang
 * dibutuhkannya diserahkan pemanggil lewat `KonteksPerintah`. Itu bukan
 * kerapian -- ia yang membuat seluruh alur tiga langkah bisa diuji tanpa
 * MariaDB hidup, dan yang membuat kotak uji coba di dashboard (kalau kelak
 * ditambahkan) mustahil menyimpang dari worker. Pola yang sama sudah dibayar di
 * `core/autoReply.ts`, `core/stokObat.ts`, dan `core/suratOtomatis.ts`.
 *
 * Yang TIDAK ada di sini, dan sengaja: pengiriman, izin, batas waktu sesi, dan
 * penulisan `auto_reply_rule`. Keempatnya milik `worker/commandReply.ts`.
 */

import { matchRule, normalizeKeyword, type MatchMode, type MatchableRule } from './autoReply';
import { extractVariables, findUnknownVariables } from './template';

// ---------------------------------------------------------------------------
// Perintah
// ---------------------------------------------------------------------------

export type JenisPerintah = 'tambah' | 'daftar' | 'hapus' | 'ubah' | 'uji' | 'batal' | 'bantuan';

/**
 * Nama panjang adalah nama RESMI -- ia yang ditulis di halaman dashboard dan di
 * pesan bantuan, dan bentuknya sengaja tidak mungkin terketik tanpa sengaja.
 * Nama pendek ada karena orang yang memakainya tiap hari mengetik dari ponsel,
 * dan "/tambah-jawaban-otomatis" adalah 23 karakter yang salah ketiknya tidak
 * dijawab apa pun.
 */
const NAMA_PERINTAH: ReadonlyMap<string, JenisPerintah> = new Map([
  ['tambah-jawaban-otomatis', 'tambah'],
  ['tambah', 'tambah'],
  ['daftar-jawaban-otomatis', 'daftar'],
  ['daftar', 'daftar'],
  ['hapus-jawaban-otomatis', 'hapus'],
  ['hapus', 'hapus'],
  ['ubah-jawaban-otomatis', 'ubah'],
  ['ubah', 'ubah'],
  ['uji-jawaban-otomatis', 'uji'],
  ['uji', 'uji'],
  ['batal', 'batal'],
  ['bantuan', 'bantuan'],
  ['perintah', 'bantuan'],
  ['help', 'bantuan'],
]);

export interface PerintahTerurai {
  jenis: JenisPerintah;
  /** Sisa teks sesudah nama perintah, mis. `/uji jadwal dokter` -> "jadwal dokter". */
  argumen: string;
}

/**
 * Menguraikan satu pesan menjadi perintah, atau null bila ia bukan perintah.
 *
 * Dibaca dari teks MENTAH, tidak pernah dari `normalizeInbound()` -- normalisasi
 * itu mengubah setiap karakter non-alfanumerik jadi spasi, jadi garis miring
 * pembeda perintah sudah musnah sebelum sempat dilihat.
 *
 * Nama yang TIDAK dikenal mengembalikan null, dan itu penting untuk hal yang
 * tidak kelihatan: isi balasan yang diketik staf boleh saja dimulai dengan
 * garis miring ("/info lengkap ada di ..."), dan kalau setiap kata bergaris
 * miring dianggap perintah, kalimat itu tidak akan pernah bisa disimpan. Yang
 * dikenali cuma daftar tertutup di atas.
 */
export function parsePerintah(teks: string | null | undefined): PerintahTerurai | null {
  const bersih = (teks ?? '').trim();
  if (!bersih.startsWith('/')) return null;

  const spasi = bersih.search(/\s/);
  const kepala = (spasi === -1 ? bersih : bersih.slice(0, spasi)).slice(1);
  const argumen = spasi === -1 ? '' : bersih.slice(spasi + 1).trim();

  // Tanda baca di ekor ("/batal.") dibuang: orang mengetik kalimat, bukan
  // baris perintah. Titik dua dipertahankan karena ia tidak pernah muncul di
  // nama perintah mana pun dan membuangnya tidak menolong apa-apa.
  const nama = kepala.toLowerCase().replace(/[.,!?;]+$/, '');
  const jenis = NAMA_PERINTAH.get(nama);
  return jenis ? { jenis, argumen } : null;
}

// ---------------------------------------------------------------------------
// Keadaan wizard
// ---------------------------------------------------------------------------

export type Langkah =
  | 'tambah:nama'
  | 'tambah:kata_kunci'
  | 'tambah:isi'
  | 'hapus:pilih'
  | 'hapus:konfirmasi'
  | 'ubah:pilih'
  | 'ubah:bagian'
  | 'ubah:nilai'
  | 'uji:kalimat';

const SEMUA_LANGKAH: ReadonlySet<string> = new Set<Langkah>([
  'tambah:nama',
  'tambah:kata_kunci',
  'tambah:isi',
  'hapus:pilih',
  'hapus:konfirmasi',
  'ubah:pilih',
  'ubah:bagian',
  'ubah:nilai',
  'uji:kalimat',
]);

/**
 * Baris `wa_command_session` bisa disunting langsung lewat `mysql`, dan langkah
 * yang tidak dikenal harus membuat sesinya dibuang -- bukan menjatuhkan
 * penanganan pesan masuk untuk semua orang. Pola yang sama dengan
 * `parseKeywords()` yang mengembalikan larik kosong untuk JSON rusak.
 */
export function isLangkah(nilai: string): nilai is Langkah {
  return SEMUA_LANGKAH.has(nilai);
}

export type BagianUbah = 'nama' | 'kata_kunci' | 'isi' | 'aktif';

export interface DataWizard {
  label?: string;
  keywords?: string[];
  body?: string;
  /**
   * Id aturan menurut urutan yang DITAMPILKAN saat pilihan bernomor ditawarkan,
   * dibekukan di sini alih-alih dibaca ulang saat konfirmasi. Aturan bisa
   * dihapus lewat dashboard di sela dua pesan, dan nomor 3 yang berpindah arti
   * antara "pilih" dan "konfirmasi" berarti staf menghapus aturan yang bukan
   * dilihatnya.
   */
  pilihan?: number[];
  targetId?: number;
  bagian?: BagianUbah;
}

export interface KeadaanWizard {
  langkah: Langkah;
  data: DataWizard;
}

/** Ringkasan satu aturan, cukup untuk pencocokan maupun penampilan. */
export interface RingkasanAturan extends MatchableRule {
  id: number;
  label: string;
  keywords: string[];
  matchMode: MatchMode;
  priority: number;
  isActive: boolean;
}

export interface KonteksPerintah {
  aturan: readonly RingkasanAturan[];
  /** `autoreply.wa_tambah_aktif_langsung` -- menentukan `is_active` aturan baru. */
  aktifLangsung: boolean;
  /** `AUTOREPLY_TEMPLATE_VARIABLES`; diserahkan supaya modul ini tidak memilih kebijakan. */
  variabelDikenal: readonly string[];
}

export type EfekPerintah =
  | { jenis: 'simpan_baru'; label: string; keywords: string[]; body: string; aktif: boolean }
  | { jenis: 'hapus'; id: number; label: string }
  | { jenis: 'ubah'; id: number; label?: string; keywords?: string[]; body?: string; aktif?: boolean }
  | { jenis: 'uji'; kalimat: string };

export type HasilPerintah =
  /** Langkah maju: simpan keadaan, kirim balasan. */
  | { aksi: 'tanya'; keadaan: KeadaanWizard; balasan: string }
  /** Masukan tidak sah: keadaan TIDAK maju, pertanyaannya diulang. */
  | { aksi: 'ulangi'; keadaan: KeadaanWizard; balasan: string }
  /** Sesi berakhir. `efek` diisi bila ada yang harus ditulis ke database. */
  | { aksi: 'selesai'; balasan: string; efek?: EfekPerintah };

// ---------------------------------------------------------------------------
// Batas yang ditegakkan
// ---------------------------------------------------------------------------

/**
 * `auto_reply_rule.label` adalah VARCHAR(80), dan MariaDB non-strict MEMOTONG
 * kelebihannya diam-diam. Dashboard tidak pernah kena karena kotaknya punya
 * batas di peramban; WhatsApp tidak punya kotak. Tanpa pemeriksaan ini, nama
 * aturan yang panjang tersimpan terpotong lalu gagal cocok dengan apa pun yang
 * dilihat staf di layar -- kelas kegagalan yang sama dengan kunci idempoten
 * yang terpotong di `template_target` (018).
 */
export const MAKS_LABEL = 80;

/**
 * Isi balasan. TEXT muat jauh lebih banyak; yang membatasi di sini keterbacaan
 * -- balasan yang lebih panjang dari ini akan dipotong WhatsApp di sisi penerima
 * atau dibaca tak seorang pun sampai bawah, dan baris kode pengiriman yang
 * ditempelkan `appendUniqueCode` masih harus muat sesudahnya.
 */
export const MAKS_ISI = 4000;

/** Kata kunci satu huruf cocok pada hampir setiap kalimat -- sama dengan pagar dashboard. */
const MIN_PANJANG_KATA_KUNCI = 2;

/** Daftar aturan di WhatsApp dipotong di sini; `auto_reply_rule` memang tabel konfigurasi kecil. */
const MAKS_DAFTAR = 50;

// ---------------------------------------------------------------------------
// Penolong
// ---------------------------------------------------------------------------

/**
 * Kata kunci dipisah koma atau baris baru, dinormalisasi SEKARANG dengan fungsi
 * yang sama dipakai pencocokan -- persis seperti `parseKeywordInput` di
 * `balasan-otomatis/actions.ts`. Bentuk yang tersimpan harus bentuk yang nanti
 * dibandingkan, bukan bentuk yang kebetulan mirip.
 */
export function uraikanKataKunci(mentah: string): string[] {
  const terlihat = new Set<string>();
  for (const potongan of mentah.split(/[,\n]/)) {
    const k = normalizeKeyword(potongan);
    if (k) terlihat.add(k);
  }
  return [...terlihat];
}

function daftarBernomor(aturan: readonly RingkasanAturan[]): { teks: string; ids: number[] } {
  const tampil = aturan.slice(0, MAKS_DAFTAR);
  const baris = tampil.map((r, i) => {
    const status = r.isActive ? 'aktif' : 'NONAKTIF';
    const kunci = r.keywords.length > 0 ? r.keywords.join(', ') : '(tanpa kata kunci)';
    return `${i + 1}. *${r.label}* (${status})\n   kunci: ${kunci}`;
  });
  const potongan =
    aturan.length > tampil.length ? `\n\n(menampilkan ${tampil.length} dari ${aturan.length})` : '';
  return { teks: baris.join('\n') + potongan, ids: tampil.map((r) => r.id) };
}

/**
 * Kata kunci yang SUDAH dijaring aturan lain. Diperiksa dengan `matchRule()`
 * yang sama dipakai worker, bukan dengan perbandingan string: yang menentukan
 * bukan apakah kata kuncinya kembar, melainkan apakah aturan lain akan
 * MENJAWAB LEBIH DULU -- dan itu ditentukan `priority` plus mode cocoknya.
 *
 * Hanya aturan AKTIF yang dihitung; aturan nonaktif tidak menjawab apa pun,
 * jadi memperingatkannya cuma kebisingan.
 */
function tabrakanKataKunci(
  kataKunci: readonly string[],
  aturan: readonly RingkasanAturan[],
): Array<{ kunci: string; label: string }> {
  const aktif = aturan.filter((r) => r.isActive);
  const hasil: Array<{ kunci: string; label: string }> = [];
  for (const kunci of kataKunci) {
    const cocok = matchRule(kunci, aktif);
    if (cocok) hasil.push({ kunci, label: cocok.rule.label });
  }
  return hasil;
}

function petunjukVariabel(ctx: KonteksPerintah): string {
  return ctx.variabelDikenal.map((v) => `{${v}}`).join(' ');
}

/**
 * Membuat perenderan template menjadi operasi IDENTITAS untuk sebuah balasan
 * wizard: tiap `{variabel}` yang muncul di dalamnya dipetakan ke bentuk
 * literalnya sendiri.
 *
 * Ada karena balasan wizard BUKAN template, tapi tetap melewati
 * `renderTemplate()` di dalam `enqueueMessage`. Tanpa ini ia rusak DUA arah
 * sekaligus, dan keduanya terjadi sungguhan:
 *
 *   1. Variabel yang DIKENAL diganti nilainya. Petunjuk "Variabel yang bisa
 *      dipakai: {nama_rs} {kontak_rs} ..." tampil sebagai nama dan nomor rumah
 *      sakit -- staf lalu tidak pernah tahu apa yang boleh diketiknya.
 *   2. Variabel yang TIDAK dikenal diganti string KOSONG, dan inilah yang
 *      paling mahal: pesan "Variabel tidak dikenal: {nama_pasien}" berubah
 *      menjadi "Variabel tidak dikenal: ." Kalimat yang ada justru untuk
 *      menyebutkan kesalahannya menghapus kesalahannya sendiri, dan staf tidak
 *      punya cara mengetahui variabel mana yang harus dibetulkan.
 *
 * Yang kedua LOLOS dari uji unit mesin keadaan -- di sana yang diperiksa nilai
 * balik fungsi murni, sebelum perenderan pernah terjadi. Ia baru terlihat lewat
 * uji end-to-end yang benar-benar menulis baris `outbox`.
 *
 * Aman HANYA karena substitusi dijamin SATU LINTASAN: hasil substitusi tidak
 * pernah diperiksa ulang, jadi `{nama_rs}` yang menghasilkan `{nama_rs}`
 * berhenti di situ alih-alih berputar. Invarian itu dipatok `template.test.ts`.
 */
export function varsBalasanApaAdanya(balasan: string): Record<string, string> {
  const hasil: Record<string, string> = {};
  for (const nama of extractVariables(balasan)) hasil[nama] = `{${nama}}`;
  return hasil;
}

/** Semua langkah berakhir dengan kalimat yang sama supaya jalan keluarnya selalu terlihat. */
const JALAN_KELUAR = '\n\nKetik */batal* untuk berhenti.';

export const TEKS_BANTUAN = [
  '*Perintah balasan otomatis*',
  '',
  '/tambah-jawaban-otomatis — buat aturan baru',
  '/daftar-jawaban-otomatis — lihat aturan yang ada',
  '/ubah-jawaban-otomatis — ubah aturan',
  '/hapus-jawaban-otomatis — hapus aturan',
  '/uji-jawaban-otomatis — coba kalimat, lihat aturan mana yang menjawab',
  '/batal — batalkan yang sedang dikerjakan',
  '',
  'Boleh disingkat: /tambah /daftar /ubah /hapus /uji',
].join('\n');

// ---------------------------------------------------------------------------
// Titik masuk
// ---------------------------------------------------------------------------

/**
 * Memulai sebuah perintah. Argumen sebaris (`/uji jadwal dokter`) langsung
 * diumpankan sebagai jawaban langkah pertama, jadi bentuk singkat dan bentuk
 * bertahap menempuh kode yang sama persis -- bukan dua jalur yang bisa berbeda
 * tafsir.
 */
export function mulaiPerintah(
  perintah: PerintahTerurai,
  ctx: KonteksPerintah,
  adaSesi: boolean,
): HasilPerintah {
  const awal = langkahAwal(perintah.jenis, ctx, adaSesi);
  if (!perintah.argumen || awal.aksi !== 'tanya') return awal;
  return lanjutkanWizard(awal.keadaan, perintah.argumen, ctx);
}

function langkahAwal(jenis: JenisPerintah, ctx: KonteksPerintah, adaSesi: boolean): HasilPerintah {
  switch (jenis) {
    case 'bantuan':
      return { aksi: 'selesai', balasan: TEKS_BANTUAN };

    case 'batal':
      return {
        aksi: 'selesai',
        balasan: adaSesi ? 'Dibatalkan.' : 'Tidak ada yang sedang dikerjakan.',
      };

    case 'daftar': {
      if (ctx.aturan.length === 0) {
        return {
          aksi: 'selesai',
          balasan: 'Belum ada satu pun aturan balasan otomatis.\n\nKetik */tambah-jawaban-otomatis* untuk membuat yang pertama.',
        };
      }
      const { teks } = daftarBernomor(ctx.aturan);
      return { aksi: 'selesai', balasan: `*Aturan balasan otomatis* (${ctx.aturan.length})\n\n${teks}` };
    }

    case 'tambah':
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'tambah:nama', data: {} },
        balasan: `*Aturan baru — langkah 1 dari 3*\n\nKetik *nama aturan*. Nama ini cuma dilihat staf di dashboard, tidak pernah dikirim ke pasien.${JALAN_KELUAR}`,
      };

    case 'hapus': {
      if (ctx.aturan.length === 0) {
        return { aksi: 'selesai', balasan: 'Belum ada aturan yang bisa dihapus.' };
      }
      const { teks, ids } = daftarBernomor(ctx.aturan);
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'hapus:pilih', data: { pilihan: ids } },
        balasan: `*Hapus aturan*\n\n${teks}\n\nKetik *nomor* aturan yang mau dihapus.${JALAN_KELUAR}`,
      };
    }

    case 'ubah': {
      if (ctx.aturan.length === 0) {
        return { aksi: 'selesai', balasan: 'Belum ada aturan yang bisa diubah.' };
      }
      const { teks, ids } = daftarBernomor(ctx.aturan);
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'ubah:pilih', data: { pilihan: ids } },
        balasan: `*Ubah aturan*\n\n${teks}\n\nKetik *nomor* aturan yang mau diubah.${JALAN_KELUAR}`,
      };
    }

    case 'uji':
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'uji:kalimat', data: {} },
        balasan: `*Uji balasan otomatis*\n\nKetik kalimat seperti yang akan dikirim pasien. Saya jawab aturan mana yang akan membalas — tanpa mengirim apa pun ke siapa pun.${JALAN_KELUAR}`,
      };
  }
}

/**
 * Satu langkah wizard. TIDAK pernah melempar: masukan yang tidak sah menghasilkan
 * `ulangi` berikut sebabnya, bukan galat -- yang mengetiknya adalah orang, dan
 * satu salah ketik tidak boleh membuang tiga langkah yang sudah diisi.
 */
export function lanjutkanWizard(
  keadaan: KeadaanWizard,
  masukanMentah: string,
  ctx: KonteksPerintah,
): HasilPerintah {
  const masukan = masukanMentah.trim();
  const { data } = keadaan;

  switch (keadaan.langkah) {
    // --- TAMBAH ------------------------------------------------------------
    case 'tambah:nama': {
      const salah = periksaLabel(masukan, ctx);
      if (salah) return { aksi: 'ulangi', keadaan, balasan: `${salah}\n\nKetik nama aturan lagi.${JALAN_KELUAR}` };
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'tambah:kata_kunci', data: { ...data, label: masukan } },
        balasan: `Nama: *${masukan}*\n\n*Langkah 2 dari 3*\n\nKetik *kata kunci* yang memicu balasan ini, dipisah koma.\nContoh: jadwal, jadwal dokter, jam praktik${JALAN_KELUAR}`,
      };
    }

    case 'tambah:kata_kunci': {
      const kataKunci = uraikanKataKunci(masukan);
      const salah = periksaKataKunci(kataKunci);
      if (salah) return { aksi: 'ulangi', keadaan, balasan: `${salah}\n\nKetik kata kuncinya lagi.${JALAN_KELUAR}` };

      const bentrok = tabrakanKataKunci(kataKunci, ctx.aturan);
      const peringatan =
        bentrok.length > 0
          ? `\n\n⚠️ Sudah dijaring aturan lain — aturan ITU yang akan menjawab, bukan aturan baru ini:\n${bentrok
              .map((b) => `• "${b.kunci}" → *${b.label}*`)
              .join('\n')}\nAtur urutannya di dashboard kalau yang baru harus menang.`
          : '';

      return {
        aksi: 'tanya',
        keadaan: { langkah: 'tambah:isi', data: { ...data, keywords: kataKunci } },
        balasan: `Kata kunci: ${kataKunci.join(', ')}${peringatan}\n\n*Langkah 3 dari 3*\n\nKetik *isi balasan* yang akan diterima pasien.\nVariabel yang bisa dipakai: ${petunjukVariabel(ctx)}${JALAN_KELUAR}`,
      };
    }

    case 'tambah:isi': {
      const salah = periksaIsi(masukan, ctx);
      if (salah) return { aksi: 'ulangi', keadaan, balasan: `${salah}\n\nKetik isi balasannya lagi.${JALAN_KELUAR}` };

      const label = data.label ?? '';
      const keywords = data.keywords ?? [];
      const aktif = ctx.aktifLangsung;
      return {
        aksi: 'selesai',
        efek: { jenis: 'simpan_baru', label, keywords, body: masukan, aktif },
        balasan: aktif
          ? `✅ Aturan *${label}* tersimpan dan *SUDAH AKTIF*.\n\nPesan pasien yang memuat: ${keywords.join(', ')} — mulai sekarang dijawab dengan balasan ini.`
          : `✅ Aturan *${label}* tersimpan, tapi *BELUM AKTIF*.\n\nAturan baru dari WhatsApp perlu ditinjau dulu. Buka dashboard → Balasan otomatis, lalu centang aktif supaya mulai menjawab pasien.`,
      };
    }

    // --- HAPUS -------------------------------------------------------------
    case 'hapus:pilih': {
      const dipilih = pilihNomor(masukan, data.pilihan ?? [], ctx);
      if ('galat' in dipilih) return { aksi: 'ulangi', keadaan, balasan: `${dipilih.galat}${JALAN_KELUAR}` };
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'hapus:konfirmasi', data: { ...data, targetId: dipilih.aturan.id } },
        balasan: `Hapus aturan *${dipilih.aturan.label}*?\nKata kunci: ${dipilih.aturan.keywords.join(', ')}\n\nIni tidak bisa dibatalkan. Ketik *YA* untuk menghapus.${JALAN_KELUAR}`,
      };
    }

    case 'hapus:konfirmasi': {
      const aturan = ctx.aturan.find((r) => r.id === data.targetId);
      // Aturannya bisa saja sudah dihapus lewat dashboard di sela dua pesan.
      // Dikatakan apa adanya, bukan dilaporkan "berhasil dihapus" -- yang kedua
      // membuat staf mengira tindakannya yang berlaku.
      if (!aturan) return { aksi: 'selesai', balasan: 'Aturan itu sudah tidak ada. Tidak ada yang dihapus.' };
      if (masukan.toLowerCase() !== 'ya') {
        return { aksi: 'selesai', balasan: `Tidak jadi. Aturan *${aturan.label}* tetap ada.` };
      }
      return {
        aksi: 'selesai',
        efek: { jenis: 'hapus', id: aturan.id, label: aturan.label },
        balasan: `🗑️ Aturan *${aturan.label}* dihapus.`,
      };
    }

    // --- UBAH --------------------------------------------------------------
    case 'ubah:pilih': {
      const dipilih = pilihNomor(masukan, data.pilihan ?? [], ctx);
      if ('galat' in dipilih) return { aksi: 'ulangi', keadaan, balasan: `${dipilih.galat}${JALAN_KELUAR}` };
      const r = dipilih.aturan;
      return {
        aksi: 'tanya',
        keadaan: { langkah: 'ubah:bagian', data: { ...data, targetId: r.id } },
        balasan: `*${r.label}*\nKata kunci: ${r.keywords.join(', ')}\nStatus: ${r.isActive ? 'aktif' : 'NONAKTIF'}\n\nMau ubah apa?\n1. Nama aturan\n2. Kata kunci\n3. Isi balasan\n4. ${r.isActive ? 'Nonaktifkan' : 'Aktifkan'}\n\nKetik nomornya.${JALAN_KELUAR}`,
      };
    }

    case 'ubah:bagian': {
      const aturan = ctx.aturan.find((r) => r.id === data.targetId);
      if (!aturan) return { aksi: 'selesai', balasan: 'Aturan itu sudah tidak ada. Tidak ada yang diubah.' };

      const bagian = ({ '1': 'nama', '2': 'kata_kunci', '3': 'isi', '4': 'aktif' } as const)[masukan];
      if (!bagian) {
        return { aksi: 'ulangi', keadaan, balasan: `Ketik 1, 2, 3, atau 4.${JALAN_KELUAR}` };
      }

      // Pilihan 4 tidak punya nilai untuk ditanyakan -- ia sakelar, jadi
      // langsung selesai. Menanyakan "aktif atau nonaktif?" sesudah orangnya
      // memilih "Nonaktifkan" cuma menyuruhnya mengulangi jawaban yang sama.
      if (bagian === 'aktif') {
        const aktif = !aturan.isActive;
        return {
          aksi: 'selesai',
          efek: { jenis: 'ubah', id: aturan.id, aktif },
          balasan: aktif
            ? `✅ Aturan *${aturan.label}* sekarang *AKTIF* dan mulai menjawab pasien.`
            : `⏸️ Aturan *${aturan.label}* sekarang *NONAKTIF* dan berhenti menjawab.`,
        };
      }

      const tanya = {
        nama: `Ketik *nama baru* untuk aturan ini.\nSekarang: ${aturan.label}`,
        kata_kunci: `Ketik *kata kunci baru*, dipisah koma. Yang lama diganti seluruhnya.\nSekarang: ${aturan.keywords.join(', ')}`,
        isi: `Ketik *isi balasan baru*. Yang lama diganti seluruhnya.\nVariabel: ${petunjukVariabel(ctx)}`,
      }[bagian];

      return {
        aksi: 'tanya',
        keadaan: { langkah: 'ubah:nilai', data: { ...data, bagian } },
        balasan: `${tanya}${JALAN_KELUAR}`,
      };
    }

    case 'ubah:nilai': {
      const aturan = ctx.aturan.find((r) => r.id === data.targetId);
      if (!aturan) return { aksi: 'selesai', balasan: 'Aturan itu sudah tidak ada. Tidak ada yang diubah.' };

      if (data.bagian === 'nama') {
        // Aturan yang sedang diubah dikecualikan dari pemeriksaan nama ganda:
        // menyimpan ulang nama yang sama persis bukan tabrakan.
        const salah = periksaLabel(masukan, ctx, aturan.id);
        if (salah) return { aksi: 'ulangi', keadaan, balasan: `${salah}\n\nKetik nama barunya lagi.${JALAN_KELUAR}` };
        return {
          aksi: 'selesai',
          efek: { jenis: 'ubah', id: aturan.id, label: masukan },
          balasan: `✏️ Nama aturan diubah menjadi *${masukan}*.`,
        };
      }

      if (data.bagian === 'kata_kunci') {
        const kataKunci = uraikanKataKunci(masukan);
        const salah = periksaKataKunci(kataKunci);
        if (salah) return { aksi: 'ulangi', keadaan, balasan: `${salah}\n\nKetik kata kuncinya lagi.${JALAN_KELUAR}` };
        const bentrok = tabrakanKataKunci(
          kataKunci,
          ctx.aturan.filter((r) => r.id !== aturan.id),
        );
        const peringatan =
          bentrok.length > 0
            ? `\n\n⚠️ Sudah dijaring aturan lain: ${bentrok.map((b) => `"${b.kunci}" → ${b.label}`).join('; ')}`
            : '';
        return {
          aksi: 'selesai',
          efek: { jenis: 'ubah', id: aturan.id, keywords: kataKunci },
          balasan: `✏️ Kata kunci *${aturan.label}* diganti: ${kataKunci.join(', ')}${peringatan}`,
        };
      }

      const salah = periksaIsi(masukan, ctx);
      if (salah) return { aksi: 'ulangi', keadaan, balasan: `${salah}\n\nKetik isi balasannya lagi.${JALAN_KELUAR}` };
      return {
        aksi: 'selesai',
        efek: { jenis: 'ubah', id: aturan.id, body: masukan },
        balasan: `✏️ Isi balasan *${aturan.label}* diperbarui.`,
      };
    }

    // --- UJI ---------------------------------------------------------------
    case 'uji:kalimat': {
      if (!masukan) {
        return { aksi: 'ulangi', keadaan, balasan: `Ketik dulu kalimatnya.${JALAN_KELUAR}` };
      }
      // Perenderan variabel butuh database (jadwal dokter dibaca dari Khanza),
      // jadi pencocokannya diserahkan ke runner sebagai efek. Yang dijaga: ia
      // memakai matchRule() dan buildReplyVars() yang SAMA dipakai worker.
      return { aksi: 'selesai', efek: { jenis: 'uji', kalimat: masukan }, balasan: '' };
    }
  }
}

// ---------------------------------------------------------------------------
// Pemeriksaan -- sengaja SAMA dengan balasan-otomatis/actions.ts
// ---------------------------------------------------------------------------

function periksaLabel(label: string, ctx: KonteksPerintah, kecualiId?: number): string | null {
  if (!label) return 'Nama aturan tidak boleh kosong.';
  if (label.length > MAKS_LABEL) {
    return `Nama aturan kepanjangan (${label.length} huruf, maksimal ${MAKS_LABEL}).`;
  }
  const kembar = ctx.aturan.find(
    (r) => r.id !== kecualiId && r.label.toLowerCase() === label.toLowerCase(),
  );
  return kembar ? `Sudah ada aturan bernama "${kembar.label}".` : null;
}

function periksaKataKunci(kataKunci: readonly string[]): string | null {
  if (kataKunci.length === 0) return 'Isi minimal satu kata kunci.';
  const pendek = kataKunci.filter((k) => k.length < MIN_PANJANG_KATA_KUNCI);
  if (pendek.length > 0) {
    return `Kata kunci terlalu pendek: ${pendek.join(', ')}. Minimal ${MIN_PANJANG_KATA_KUNCI} huruf.`;
  }
  return null;
}

/**
 * Variabel tak dikenal DITOLAK, sama persis dengan dashboard.
 *
 * Kalau tidak, WhatsApp menjadi jalan pintas yang melewati pagar yang ditegakkan
 * di tempat lain: `{nama_pasien}` yang lolos di sini akan dirender kosong ke
 * setiap pasien yang mengenainya, selamanya, tanpa satu pun galat -- dan
 * ketiadaannya di `AUTOREPLY_TEMPLATE_VARIABLES` justru keputusan privasi
 * (nomor yang mengirim WhatsApp belum tentu pasien terdaftar mana pun).
 */
function periksaIsi(isi: string, ctx: KonteksPerintah): string | null {
  if (!isi) return 'Isi balasan tidak boleh kosong.';
  if (isi.length > MAKS_ISI) {
    return `Isi balasan kepanjangan (${isi.length} huruf, maksimal ${MAKS_ISI}).`;
  }
  const takDikenal = findUnknownVariables(isi, ctx.variabelDikenal);
  if (takDikenal.length > 0) {
    return `Variabel tidak dikenal: ${takDikenal.map((v) => `{${v}}`).join(', ')}.\nYang tersedia: ${petunjukVariabel(ctx)}`;
  }
  return null;
}

function pilihNomor(
  masukan: string,
  pilihan: readonly number[],
  ctx: KonteksPerintah,
): { aturan: RingkasanAturan } | { galat: string } {
  const nomor = Number(masukan);
  if (!Number.isInteger(nomor) || nomor < 1 || nomor > pilihan.length) {
    return { galat: `Ketik nomor antara 1 dan ${pilihan.length}.` };
  }
  const id = pilihan[nomor - 1]!;
  const aturan = ctx.aturan.find((r) => r.id === id);
  // Terhapus lewat dashboard di sela dua pesan. Nomornya sengaja TIDAK digeser
  // ke aturan lain -- daftar yang dibekukan itulah yang dilihat staf.
  return aturan ? { aturan } : { galat: 'Aturan itu sudah tidak ada. Ketik nomor lain.' };
}
