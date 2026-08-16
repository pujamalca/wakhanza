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
import { findUnknownVariables } from './template';

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

/**
 * Apa yang bisa dilakukan ALAMAT INI -- bukan apa yang bisa dilakukan sistem.
 *
 * Diserahkan pemanggil, dan bentuknya per-alamat karena nomor RS menjawab
 * beberapa hal lewat daftar putih yang BERBEDA-BEDA: `wa_command_admin` untuk
 * perintah di berkas ini, `farmasi_target.boleh_tanya` untuk stok dan rekap
 * gudang. Pemisahan itu disengaja (migrations/045) -- "boleh menanyakan stok"
 * dan "boleh mengubah apa yang dikatakan RS kepada pasien" dua wewenang yang
 * beratnya sama sekali berbeda.
 *
 * Akibatnya bantuan TIDAK BOLEH menyebutkan kemampuan secara umum. Menyuruh
 * seseorang mengetik "stok paracetamol" saat alamatnya tidak ada di daftar
 * satunya menghasilkan persis kelas kegagalan termahal di proyek ini: orang
 * mengetik apa yang disuruh, tidak terjadi apa-apa, dan tidak ada satu pun galat
 * yang menyebut sebabnya -- karena memang tidak ada yang salah, alamatnya saja
 * yang tidak berhak.
 */
export interface KemampuanAlamat {
  /**
   * `autoreply.enabled`. Selama MATI, tidak satu pun aturan menjawab pasien --
   * termasuk yang berstatus aktif. Itu keadaan yang mustahil dilihat dari
   * WhatsApp, dan orang yang baru saja menulis aturan lalu mengujinya wajar
   * menyimpulkan aturannyalah yang salah.
   */
  balasanOtomatisAktif: boolean;
  /** Alamat ini boleh menanyakan stok/harga obat. */
  bolehTanyaStok: boolean;
  /** Jawaban stoknya memuat sisa, satuan, dan harga -- bukan tersedia/kosong saja. */
  stokRinci: boolean;
  /** Alamat ini boleh meminta rekap barang di bawah stok minimal. */
  bolehTanyaDarurat: boolean;
  /** Kata kunci yang menjaring pertanyaan stok, apa adanya dari pengaturan. */
  kataKunciStok: readonly string[];
  /** Frasa yang menjaring permintaan rekap gudang. */
  frasaDarurat: readonly string[];
  /** Formulir (051) yang bisa diisi dari alamat ini. */
  formulir: KemampuanFormulir;
}

/**
 * Formulir yang bisa diisi DARI ALAMAT INI.
 *
 * Gerbangnya sama sekali berbeda dari kedua kemampuan di atasnya: formulir
 * TIDAK dijaga daftar putih -- siapa pun boleh mengisinya, karena formulir yang
 * cuma bisa diisi orang terdaftar bukan formulir pasien. Yang menggantikannya
 * dua hal yang tetap membuat jawabannya per-alamat: sakelar utama
 * `formulir.enabled`, dan `wa_form.boleh_grup` per formulir.
 *
 * Karena itu bantuan tidak boleh menyebut sebuah formulir hanya karena ia ada di
 * dashboard. Di dalam grup, formulir pasien yang wajar dibatasi ke chat pribadi
 * tidak akan menjawab apa pun -- dan menyuruh orang mengetiknya menghasilkan
 * persis kegagalan yang membuat SELURUH bagian ini per-alamat.
 *
 * Bentuknya struktural, bukan `RingkasanFormulir` dari `core/waFormulir.ts`:
 * berkas ini tidak perlu tahu apa-apa tentang mesin keadaan pengisiannya, dan
 * pemanggil yang menyusunnya (`worker/commandReply.ts`) memang cuma memetakan
 * dua kolom. Pola `core/broadcastVars.ts`.
 */
export interface KemampuanFormulir {
  /**
   * `formulir.enabled`. Mati = tidak satu pun formulir menjawab, di alamat mana
   * pun -- jadi bantuan diam sama sekali soal formulir alih-alih menyebutnya
   * sebagai sesuatu yang "belum bisa dari sini". Bandingkan
   * `balasanOtomatisAktif`, yang JUSTRU disebut saat mati: di sana yang mati
   * adalah subjek seluruh pesan ini.
   */
  aktif: boolean;
  /** Yang benar-benar menjawab dari sini. Sudah tersaring `formulirYangMenjawab()`. */
  daftar: readonly { nama: string; keywords: readonly string[] }[];
  /**
   * Ada formulir yang menjawab dari chat pribadi tapi TIDAK dari sini karena
   * alamat ini grup. Dibedakan dari daftar kosong: yang satu berarti "belum ada
   * formulir sama sekali", yang satu "ada, tapi bukan dari sini" -- dan hanya
   * yang kedua punya jalan keluar yang bisa ditempuh orangnya saat itu juga.
   */
  adaKhususPribadi: boolean;
}

export interface KonteksPerintah {
  aturan: readonly RingkasanAturan[];
  /** `autoreply.wa_tambah_aktif_langsung` -- menentukan `is_active` aturan baru. */
  aktifLangsung: boolean;
  /** `AUTOREPLY_TEMPLATE_VARIABLES`; diserahkan supaya modul ini tidak memilih kebijakan. */
  variabelDikenal: readonly string[];
  kemampuan: KemampuanAlamat;
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

/**
 * Aturan yang disebut di `/bantuan`, jauh lebih sedikit daripada `/daftar`.
 * Tugas bantuan adalah orientasi, bukan pencacahan -- dan pesan yang dibuka
 * dengan tiga puluh baris aturan menenggelamkan daftar perintah yang justru
 * dicari orang yang mengetik `/bantuan`. Kelebihannya disebut jumlahnya berikut
 * perintah yang menampilkan semuanya.
 */
const MAKS_BANTUAN = 10;

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

/**
 * Satu aturan sebagaimana ditulis ke layar. SATU penurunan, dipakai daftar
 * bernomor `/hapus`-`/ubah`-`/daftar` maupun ringkasan `/bantuan` -- yang
 * berbeda cuma awalannya. Dua penurunan berarti dua bentuk keterangan untuk satu
 * aturan yang sama, dan yang menyimpang biasanya yang paling jarang dilihat.
 */
function barisAturan(r: RingkasanAturan, awalan: string): string {
  const status = r.isActive ? 'aktif' : 'NONAKTIF';
  const kunci = r.keywords.length > 0 ? r.keywords.join(', ') : '(tanpa kata kunci)';
  return `${awalan}*${r.label}* (${status})\n   kunci: ${kunci}`;
}

function daftarBernomor(aturan: readonly RingkasanAturan[]): { teks: string; ids: number[] } {
  const tampil = aturan.slice(0, MAKS_DAFTAR);
  const baris = tampil.map((r, i) => barisAturan(r, `${i + 1}. `));
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
 * Naik ke `core/template.ts` begitu pemakainya jadi tiga (wizard perintah,
 * balasan manual `/pesan-masuk`, dan formulir 051) -- ia memang tentang
 * `renderTemplate()`, bukan tentang wizard. DIRE-EXPORT dengan nama lamanya
 * supaya nol impor yang sudah ada berubah; pola yang sama dipakai saat
 * `bacaJamRekap` dan kawan-kawannya pindah dari `penjualanRekap.ts` ke
 * `rekapJadwal.ts` (migrations/042).
 */
export { varsApaAdanya as varsBalasanApaAdanya } from './template';

/** Semua langkah berakhir dengan kalimat yang sama supaya jalan keluarnya selalu terlihat. */
const JALAN_KELUAR = '\n\nKetik */batal* untuk berhenti.';

/** Daftar perintah, satu-satunya bagian bantuan yang tidak bergantung keadaan. */
const DAFTAR_PERINTAH = [
  '/tambah-jawaban-otomatis — buat aturan baru',
  '/daftar-jawaban-otomatis — lihat aturan yang ada',
  '/ubah-jawaban-otomatis — ubah nama, kata kunci, isi, atau aktif/nonaktifnya',
  '/hapus-jawaban-otomatis — hapus aturan',
  '/uji-jawaban-otomatis — coba kalimat, lihat aturan mana yang menjawab',
  '/batal — batalkan yang sedang dikerjakan',
  '/bantuan — pesan ini',
  '',
  'Boleh disingkat: /tambah /daftar /ubah /hapus /uji',
].join('\n');

/**
 * Bagian formulir pada `/bantuan`, atau null saat tidak ada yang BENAR untuk
 * dikatakan.
 *
 * Tiga keadaan, dan ketiganya menuntut kalimat berbeda -- menyatukannya
 * mengirim sebagian pembaca ke arah yang salah:
 *
 *   * fiturnya mati                      -> diam (lihat `KemampuanFormulir.aktif`)
 *   * menyala, ada yang menjawab di sini -> sebut nama dan kata kuncinya
 *   * menyala, semuanya khusus pribadi   -> sebut jalan keluarnya, bukan diam
 *
 * Kata kuncinya dicetak APA ADANYA, dan itu aman lewat jalan yang sama dengan
 * nama aturan di `barisAturan()`: balasan ini melewati `renderTemplate()` di
 * dalam `enqueueMessage`, dan `varsBalasanApaAdanya()` membuat perenderannya
 * jadi operasi identitas. Tanpa itu, kata kunci yang memuat `{apa pun}` akan
 * lenyap dari bantuan -- yaitu bantuan yang menghapus justru bagian yang harus
 * diketik orangnya.
 */
function bagianFormulir(f: KemampuanFormulir): string | null {
  if (!f.aktif) return null;

  if (f.daftar.length === 0) {
    return f.adaKhususPribadi
      ? '*Formulir*\n\nRumah sakit punya formulir yang bisa diisi lewat WhatsApp, tapi tidak dari dalam grup. Kirim dari chat pribadi ke nomor ini.'
      : null;
  }

  const baris = f.daftar.map((x) => `• *${x.nama}*\n   ketik: ${x.keywords.join(', ')}`);
  const ekor = f.adaKhususPribadi
    ? '\n\n(ada formulir lain yang hanya bisa diisi dari chat pribadi)'
    : '';
  return [
    `*Formulir yang bisa diisi dari sini* (${f.daftar.length})`,
    baris.join('\n') + ekor,
    '_Pertanyaannya datang satu per satu. Ketik *batal* untuk berhenti._',
  ].join('\n\n');
}

/**
 * `/bantuan` (juga `/help`, `/perintah`) -- bukan sekadar daftar perintah.
 *
 * Yang sampai ke sini SELALU alamat berwenang: `cobaPerintahWa()` mendiamkan
 * yang bukan, jauh sebelum perintahnya diuraikan. Jadi pesan ini boleh menyebut
 * keadaan konfigurasi, dan justru itu gunanya -- tanpanya, seseorang yang
 * mengatur balasan otomatis lewat WhatsApp tidak punya SATU PUN cara mengetahui
 * dua hal yang menentukan apakah pekerjaannya berbuah:
 *
 *   1. apakah `autoreply.enabled` menyala (kalau mati, tidak satu pun aturannya
 *      pernah menjawab pasien, dan tidak ada galat yang mengatakannya);
 *   2. apakah aturan yang baru ia buat langsung aktif atau menunggu ditinjau.
 *
 * Bagian kemampuan di bawah dibaca dari `ctx.kemampuan`, yang per-ALAMAT --
 * lihat `KemampuanAlamat`.
 */
export function susunBantuan(ctx: KonteksPerintah): string {
  const { kemampuan } = ctx;
  const bagian: string[] = [];

  bagian.push(
    '*Bantuan — perintah lewat WhatsApp*\n\nAlamat ini terdaftar *berwenang*, jadi balasan otomatis rumah sakit bisa diatur langsung dari sini.',
  );

  // --- Keadaan sekarang ----------------------------------------------------
  const jumlahAktif = ctx.aturan.filter((r) => r.isActive).length;
  bagian.push(
    [
      '*Keadaan sekarang*',
      // Disebut paling dulu karena ia membatalkan seluruh sisa pesan ini.
      kemampuan.balasanOtomatisAktif
        ? '• Balasan otomatis: *menyala*'
        : '• Balasan otomatis: *MATI*. Selama mati, tidak satu pun aturan di bawah menjawab pasien — termasuk yang bertanda aktif. Nyalakan di dashboard → Balasan otomatis.',
      `• Aturan tersimpan: ${ctx.aturan.length} (${jumlahAktif} aktif)`,
      ctx.aktifLangsung
        ? '• Aturan baru dari sini: *langsung aktif*'
        : '• Aturan baru dari sini: disimpan *nonaktif* dulu, perlu dicentang di dashboard',
    ].join('\n'),
  );

  // --- Aturan yang sudah ada -----------------------------------------------
  if (ctx.aturan.length === 0) {
    bagian.push(
      '*Aturan yang ada*\n\nBelum ada satu pun. Ketik */tambah-jawaban-otomatis* untuk membuat yang pertama.',
    );
  } else {
    const tampil = ctx.aturan.slice(0, MAKS_BANTUAN);
    const sisa = ctx.aturan.length - tampil.length;
    const ekor = sisa > 0 ? `\n\n(dan ${sisa} lagi — ketik */daftar* untuk semuanya)` : '';
    bagian.push(
      `*Aturan yang ada* (${ctx.aturan.length})\n\n${tampil.map((r) => barisAturan(r, '• ')).join('\n')}${ekor}`,
    );
  }

  // --- Perintah ------------------------------------------------------------
  bagian.push(`*Yang bisa Anda lakukan*\n\n${DAFTAR_PERINTAH}`);

  // --- Kemampuan lain, per-ALAMAT ------------------------------------------
  const lain: string[] = [];
  if (kemampuan.bolehTanyaStok) {
    const kunci =
      kemampuan.kataKunciStok.length > 0
        ? `Ketik salah satu kata: ${kemampuan.kataKunciStok.join(', ')} — diikuti nama obatnya.`
        : 'Kata kuncinya belum diisi di dashboard → Farmasi, jadi belum ada yang menjaringnya.';
    const rinci = kemampuan.stokRinci
      ? 'Alamat ini menerima sisa stok, satuan, dan harga.'
      : 'Alamat ini menerima tersedia/kosong saja, tanpa angka sisa.';
    lain.push(`• *Stok & harga obat.* ${kunci} ${rinci}`);
  }
  if (kemampuan.bolehTanyaDarurat) {
    const frasa =
      kemampuan.frasaDarurat.length > 0
        ? `Ketik: ${kemampuan.frasaDarurat.join(', ')}`
        : 'Frasanya belum diisi di dashboard → Farmasi, jadi belum ada yang menjaringnya.';
    lain.push(`• *Rekap barang di bawah stok minimal.* ${frasa}`);
  }
  bagian.push(
    lain.length > 0
      ? `*Yang juga bisa ditanyakan dari alamat ini*\n\n${lain.join('\n')}`
      : // Dikatakan apa adanya BERIKUT sebabnya. Diam di sini membuat orang
        // mencoba menanyakan stok, tidak dijawab, lalu menyimpulkan nomornya
        // rusak -- padahal wewenangnya memang daftar yang lain.
        '*Yang belum bisa dari alamat ini*\n\nMenanyakan stok obat dan rekap gudang punya daftar wewenangnya sendiri. Kalau perlu, tambahkan alamat ini di dashboard → Farmasi → Tujuan, lalu centang "Boleh tanya".',
  );

  /**
   * Bagian TERSENDIRI, bukan butir di dalam daftar di atasnya, dan itu bukan
   * kerapian: kalimat penutup bagian itu menyebut daftar wewenang Farmasi
   * sebagai jalan keluarnya, sementara formulir tidak dijaga daftar wewenang
   * apa pun. Digabung, orang yang tidak melihat formulirnya akan dikirim
   * mencentang "Boleh tanya" -- setelan yang tidak ada hubungannya, dan yang
   * sesudah dicentang tetap tidak memunculkan satu pun formulir.
   */
  const formulir = bagianFormulir(kemampuan.formulir);
  if (formulir) bagian.push(formulir);

  bagian.push('_Urutan prioritas dan mode pencocokan hanya bisa diatur di dashboard._');

  return bagian.join('\n\n');
}

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
      return { aksi: 'selesai', balasan: susunBantuan(ctx) };

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
