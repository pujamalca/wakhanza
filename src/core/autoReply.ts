/**
 * Pencocokan pesan MASUK ke aturan balasan otomatis.
 *
 * Seluruh berkas ini fungsi murni tanpa akses database maupun WhatsApp --
 * itu yang membuat kotak "Uji coba" di dashboard bisa memakai fungsi yang
 * SAMA PERSIS dengan worker. Kalau logikanya diduplikasi, kotak uji coba akan
 * berbohong tepat pada saat staf paling memercayainya.
 */

export type MatchMode = 'contains' | 'exact';

export interface MatchableRule {
  id: number;
  keywords: string[];
  matchMode: MatchMode;
  /** Kecil = lebih dulu diperiksa. Aturan spesifik harus mengalahkan yang umum. */
  priority: number;
}

export interface RuleMatch<T extends MatchableRule> {
  rule: T;
  /** Kata kunci mana yang cocok -- ditampilkan di kotak uji coba dan disimpan di log. */
  keyword: string;
}

/**
 * Pasien mengetik apa adanya: huruf besar-kecil campur, tanda baca, emoji,
 * "Assalamualaikum, mau tanya jadwal dokter jantung dong 🙏".
 *
 * Normalisasi menyeragamkannya jadi token dipisah satu spasi:
 *   - huruf kecil semua
 *   - aksen dibuang (NFD lalu buang tanda gabung) -- "Ápa" dan "Apa" sama
 *   - apa pun selain huruf/angka jadi spasi; ini sekaligus membuang emoji,
 *     tanda baca, dan baris baru tanpa aturan terpisah
 *   - spasi beruntun dirapatkan
 *
 * Angka SENGAJA dipertahankan: rumah sakit lazim memakai kata kunci berangka
 * ("poli 1", "info 24 jam").
 */
export function normalizeInbound(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Kata kunci disimpan sudah ternormalisasi, tapi tetap dinormalisasi ulang di
 * sini supaya baris lama atau hasil sunting manual di database tidak diam-diam
 * berhenti cocok.
 */
export function normalizeKeyword(keyword: string): string {
  return normalizeInbound(keyword);
}

/**
 * Cocok bila kata kunci muncul sebagai KATA UTUH, bukan potongan kata.
 *
 * Dikerjakan dengan menyelubungi kedua sisi dengan spasi alih-alih menyusun
 * RegExp per kata kunci. Dua alasan: kata kunci berasal dari input staf,
 * jadi menjadikannya RegExp berarti tanda baca yang tak sengaja terketik bisa
 * meledak jadi galat sintaks atau pola yang lambat; dan `includes` di string
 * yang sudah ternormalisasi jauh lebih cepat untuk puluhan aturan × tiap pesan
 * masuk.
 *
 * Tanpa penyelubungan ini, kata kunci "obat" akan ikut cocok pada "obatan",
 * dan yang lebih buruk, kata kunci pendek seperti "rm" cocok di tengah kata
 * mana pun -- balasan otomatis akan meletus di pesan yang sama sekali tidak
 * menanyakannya.
 */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Aturan pertama yang cocok menang -- BUKAN yang paling banyak kata kuncinya
 * atau yang paling panjang cocoknya. Urutannya ditentukan staf lewat kolom
 * `priority`, jadi "kenapa aturan ini yang membalas" selalu bisa dijawab
 * dengan melihat daftar terurut di dashboard, bukan dengan menerka peringkat
 * yang dihitung diam-diam.
 *
 * Satu pesan menghasilkan MAKSIMAL satu balasan. Mengirim dua balasan untuk
 * satu pertanyaan adalah pola pesan beruntun yang persis dihindari F5.2.
 */
export function matchRule<T extends MatchableRule>(inbound: string, rules: readonly T[]): RuleMatch<T> | null {
  const text = normalizeInbound(inbound);
  if (!text) return null;

  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);

  for (const rule of ordered) {
    for (const raw of rule.keywords) {
      const keyword = normalizeKeyword(raw);
      if (!keyword) continue;
      const hit = rule.matchMode === 'exact' ? text === keyword : containsWholeWord(text, keyword);
      if (hit) return { rule, keyword };
    }
  }
  return null;
}

/**
 * Kata pembungkus nama poli di Khanza. Dibuang saat mencocokkan karena pasien
 * mengetik "jantung", bukan "poliklinik jantung" -- dan kalau tidak dibuang,
 * kata "poli" yang muncul di hampir semua nama poli membuat SEMUA poli cocok
 * untuk pesan apa pun yang menyebut kata "poli".
 */
const POLI_STOPWORDS = new Set(['poliklinik', 'poli', 'klinik', 'instalasi', 'unit', 'ruang', 'rawat', 'jalan']);

/** Token sependek 3 huruf ("gigi", "mata", "tht", "kia") masih nama poli yang sah. */
const MIN_POLI_TOKEN = 3;

export function reducePoliName(name: string): string {
  return normalizeInbound(name)
    .split(' ')
    .filter((token) => token && !POLI_STOPWORDS.has(token))
    .join(' ');
}

export interface PoliOption {
  kdPoli: string;
  namaPoli: string;
}

/**
 * Menebak poli mana yang dimaksud pasien dari kalimatnya, mis. "jadwal dokter
 * jantung" -> Poliklinik Jantung.
 *
 * Mengembalikan null bila TIDAK ADA yang cocok maupun bila LEBIH DARI SATU
 * cocok. Ambiguitas sengaja jatuh ke null, bukan ke "ambil yang pertama":
 * pemanggilnya menafsirkan null sebagai "tampilkan seluruh jadwal", yang selalu
 * merupakan jawaban benar-tapi-lebih-panjang. Menebak satu poli dan ternyata
 * salah menghasilkan jawaban yang PERCAYA DIRI DAN KELIRU -- pasien datang di
 * hari yang salah.
 *
 * Pencocokan dua tahap: frasa penuh dulu (mis. "penyakit dalam"), baru per
 * token. Tanpa tahap frasa, "Poliklinik Penyakit Dalam" dan "Poliklinik
 * Penyakit Kulit" sama-sama cocok lewat token "penyakit" -> ambigu -> null,
 * padahal pasien menulis frasa lengkapnya dengan jelas.
 */
export function detectPoli(inbound: string, options: readonly PoliOption[]): PoliOption | null {
  const text = normalizeInbound(inbound);
  if (!text) return null;

  const byPhrase = options.filter((o) => {
    const reduced = reducePoliName(o.namaPoli);
    return reduced.includes(' ') && containsWholeWord(text, reduced);
  });
  if (byPhrase.length === 1) return byPhrase[0]!;
  if (byPhrase.length > 1) return null;

  const byToken = options.filter((o) =>
    reducePoliName(o.namaPoli)
      .split(' ')
      .some((token) => token.length >= MIN_POLI_TOKEN && containsWholeWord(text, token)),
  );
  return byToken.length === 1 ? byToken[0]! : null;
}
