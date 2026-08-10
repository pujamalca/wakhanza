/**
 * Membaca PERMINTAAN stok/harga obat dari sebuah pesan WhatsApp.
 *
 * Seluruh berkas ini fungsi murni -- tanpa database, tanpa WhatsApp -- karena
 * kotak "Uji coba" di halaman /farmasi memakainya persis sama dengan yang
 * dipakai worker. Alasan yang sama seperti `core/autoReply.ts`: pratinjau yang
 * berbeda dari kenyataan lebih buruk daripada tanpa pratinjau.
 */
import { normalizeInbound } from './autoReply';
import { sanitizeValue } from './template';

export interface BarisStokObat {
  kode_brng: string;
  nama_brng: string;
  /** Harga rawat jalan -- yang dibayar pasien poliklinik. */
  ralan: number;
  /** Harga jual bebas -- pembelian langsung di loket tanpa resep. */
  jualbebas: number;
  stokminimal: number;
  satuan: string;
  stok: number;
}

/**
 * Kata yang dibuang saat menyisakan nama obat.
 *
 * Isinya kata pengapit pertanyaan sehari-hari, BUKAN daftar lengkap bahasa
 * Indonesia -- yang tersisa nanti dipakai sebagai pencarian `LIKE '%..%'`, jadi
 * satu kata sisa yang tidak terbuang cuma membuat pencarian tidak menemukan
 * apa-apa, bukan menemukan yang salah. Sengaja tidak memuat nama obat mana pun.
 */
export const KATA_PENGAPIT = new Set([
  'apakah', 'apa', 'ada', 'adakah', 'berapa', 'brp', 'harganya', 'stoknya',
  'sisa', 'sisanya', 'masih', 'punya', 'tersedia', 'ketersediaan', 'cek',
  // Kata keadaan persediaan. Ditambahkan bersama tanya-jawab darurat stok:
  // tanpa ini "stok habis paracetamol" menyisakan "habis paracetamol" sebagai
  // pencarian `LIKE`, yang tidak pernah cocok dengan satu pun nama barang --
  // pertanyaan yang jelas maksudnya dijawab "tidak ditemukan". Tidak satu pun
  // di antaranya bisa menjadi nama obat, jadi membuangnya tidak berisiko.
  'habis', 'kosong', 'menipis', 'kritis', 'darurat', 'rekap', 'menipisnya',
  'tolong', 'mohon', 'minta', 'mau', 'ingin', 'beli', 'obat', 'obatnya',
  'ya', 'yah', 'ka', 'kak', 'min', 'admin', 'pak', 'bu', 'bapak', 'ibu',
  'selamat', 'pagi', 'siang', 'sore', 'malam', 'permisi', 'assalamualaikum',
  'di', 'ke', 'dari', 'untuk', 'buat', 'yang', 'dan', 'atau', 'nya', 'itu',
  'ini', 'saya', 'aku', 'kami', 'anda', 'gimana', 'bagaimana', 'info',
  // Partikel percakapan dan kata daftar. Ditambahkan bersama tanya-jawab
  // darurat stok, karena di sana sisa kata yang tak terbuang MEMBATALKAN
  // kecocokan -- "rekap stok dong" berhenti dibaca sebagai permintaan rekap
  // hanya karena kata "dong". Semuanya himpunan tertutup bahasa sehari-hari,
  // dan tidak satu pun bisa menjadi nama obat.
  'dong', 'deh', 'sih', 'kok', 'nih', 'tuh', 'lah', 'aja', 'saja', 'juga',
  'dulu', 'sekarang', 'daftar', 'list', 'semua', 'oke', 'ok', 'makasih',
  'terima', 'kasih', 'hari', 'kalau', 'kalo', 'boleh',
  // Kata INGKAR di ekor kalimat. Ditambahkan bersama kata tanya ketersediaan
  // (migrations/039), dan ditemukan lewat uji bukan lewat perkiraan: "jual obat
  // amlodipin tidak" menyisakan "amlodipin tidak" sebagai satu pola
  // `LIKE '%amlodipin tidak%'`, yang tidak pernah cocok dengan satu pun nama
  // barang. Bentuk "X ada tidak?" adalah cara paling wajar orang bertanya
  // ketersediaan di sini, jadi tanpa ini golongan barunya meleset justru pada
  // pertanyaan yang paling sering. Himpunan tertutup; tidak satu pun bisa
  // menjadi nama obat.
  'tidak', 'ndak', 'nggak', 'ngga', 'gak', 'ga', 'enggak', 'engga', 'kagak',
]);

export interface PermintaanStok {
  /** Ada kata kunci stok/harga di pesannya. */
  cocok: boolean;
  /** Kata kunci yang membuatnya cocok -- untuk log dan pratinjau. */
  keyword?: string;
  /**
   * Yang cocok berasal dari golongan KETAT ("stok", "harga"), bukan golongan
   * ketersediaan ("adakah", "apotek").
   *
   * Bedanya bukan soal kecocokan melainkan soal APA YANG BOLEH DILAKUKAN saat
   * obatnya tidak ketemu. Orang yang mengetik "stok xyz" jelas sedang bertanya
   * persediaan, jadi "tidak ditemukan di daftar obat kami" adalah jawaban yang
   * membantu. Orang yang mengetik "ada dokter jaga" tidak sedang bertanya obat
   * sama sekali -- menjawabnya dengan "dokter jaga tidak ditemukan di daftar
   * obat kami" adalah jawaban percaya-diri-dan-keliru, kesalahan yang sama yang
   * membuat `detectPoli()` mengembalikan null saat ambigu.
   *
   * Karena itu golongan ketersediaan hanya MENGKLAIM pesannya bila katalognya
   * benar-benar menjawab; kalau tidak, pemanggil meneruskannya ke aturan
   * /balasan-otomatis seolah fitur ini tidak ada. Pemeriksaan itu ada di
   * `worker/stokReply.ts` -- di sinilah keputusannya cuma dicatat, karena modul
   * ini tidak boleh menyentuh database.
   */
  ketat: boolean;
  /** Sisa teks yang dipakai mencari nama obat. Kosong = penanya tidak menyebut obat apa pun. */
  cari: string;
}

/** Panjang minimal potongan nama yang mau dicari. */
const MIN_PANJANG_CARI = 3;

/**
 * Membuang sebutan (`@<id>`) sebelum teksnya dinormalisasi.
 *
 * WAJIB dikerjakan LEBIH DULU, dan urutan itulah inti perbaikannya:
 * `normalizeInbound()` mengubah setiap karakter non-alfanumerik jadi spasi,
 * sehingga `@115634008510549` menjadi kata `115634008510549` yang tidak lagi
 * bisa dibedakan dari angka yang memang diketik orang. Sesudah normalisasi,
 * informasinya sudah hilang.
 *
 * Ditemukan dari pesan grup SUNGGUHAN, bukan diperkirakan: pertanyaan
 * "@115634008510549 sisa stok obat" dijawab `Maaf, "115634008510549" tidak
 * ditemukan di daftar obat kami`. Di dalam grup, me-mention nomor rumah sakit
 * justru cara paling wajar memanggilnya -- jadi ini bentuk pertanyaan yang
 * umum, bukan kekecualian.
 *
 * Hanya `@` yang diikuti ANGKA yang dibuang. Sebutan WhatsApp selalu berupa id
 * numerik, sementara `@` diikuti huruf bisa saja bagian nama dagang; membuang
 * keduanya berarti menebak-nebak di tempat yang tidak perlu.
 */
export function buangMention(teks: string): string {
  return teks.replace(/@\d+/g, ' ');
}

function cocokKataUtuh(teks: string, kunci: string): boolean {
  if (!kunci) return false;
  return ` ${teks} `.includes(` ${kunci} `);
}

/**
 * Mendeteksi permintaan stok/harga, lalu menyisakan nama obatnya.
 *
 * Tiga hal yang menempel di sini:
 *
 * 1. **Kata kunci dicocokkan sebagai KATA UTUH**, lewat penyelubungan spasi --
 *    sama seperti `core/autoReply.ts`, dan karena alasan yang sama. Tanpa itu
 *    kata kunci "stok" ikut cocok pada "stokis" dan yang lebih parah, kata
 *    kunci pendek meletus di tengah kata mana pun.
 *
 * 2. **Nama obat TIDAK ditebak saat penanya tidak menyebutnya.** "berapa harga
 *    obat?" menyisakan string kosong, dan pemanggil menjawabnya dengan meminta
 *    nama obatnya -- bukan menampilkan barang pertama di katalog. Menebak di
 *    sini menghasilkan jawaban percaya-diri-dan-keliru, kesalahan yang sama
 *    yang membuat `detectPoli()` mengembalikan null saat ambigu.
 *
 * 3. **Potongan yang terlalu pendek diperlakukan sebagai tidak menyebut nama.**
 *    Pencarian `LIKE '%a%'` cocok dengan hampir seluruh katalog, dan jawabannya
 *    jadi daftar acak sepanjang limit yang tampak seperti hasil pencarian
 *    sungguhan.
 *
 * 4. **Golongan KETAT diperiksa lebih dulu.** Pesan yang memuat keduanya
 *    ("stok, adakah paracetamol?") harus diperlakukan sebagai pertanyaan stok
 *    yang tegas -- yaitu tetap dijawab walau obatnya tidak ketemu. Urutan
 *    sebaliknya membuat kata yang lebih longgar menentukan nasib pesan yang
 *    sebenarnya sudah jelas maksudnya.
 */
export function deteksiPermintaanStok(
  teks: string,
  keywords: string[],
  /**
   * Kata tanya ketersediaan -- "adakah", "apotek", "jual". Sengaja BUKAN
   * digabung ke `keywords`: keduanya sama-sama membuat sebuah pesan cocok, tapi
   * hanya golongan ini yang boleh gugur diam-diam saat obatnya tidak ketemu.
   * Lihat `PermintaanStok.ketat`.
   */
  keywordsKetersediaan: string[] = [],
): PermintaanStok {
  const norm = normalizeInbound(buangMention(teks));
  if (!norm) return { cocok: false, ketat: false, cari: '' };

  const kunciKetat = keywords.map((k) => normalizeInbound(k)).filter(Boolean);
  const kunciLonggar = keywordsKetersediaan.map((k) => normalizeInbound(k)).filter(Boolean);

  const kenaKetat = kunciKetat.find((k) => cocokKataUtuh(norm, k));
  const terpakai = kenaKetat ?? kunciLonggar.find((k) => cocokKataUtuh(norm, k));
  if (!terpakai) return { cocok: false, ketat: false, cari: '' };

  // Buang SEMUA kata kunci dari KEDUA golongan (bukan cuma yang cocok pertama)
  // -- "stok dan harga paramex" harus menyisakan "paramex", bukan "harga
  // paramex", dan "apotek adakah obat paramex" harus menyisakan "paramex".
  const semuaKunci = new Set([...kunciKetat, ...kunciLonggar]);
  const sisa = norm
    .split(' ')
    .filter((kata) => kata && !semuaKunci.has(kata) && !KATA_PENGAPIT.has(kata))
    .join(' ')
    .trim();

  return {
    cocok: true,
    keyword: terpakai,
    ketat: kenaKetat !== undefined,
    cari: sisa.length >= MIN_PANJANG_CARI ? sisa : '',
  };
}

/** Bentuk daftar kata kunci yang tersimpan sebagai satu baris dipisah koma. */
export function parseStokKeywords(raw: string): string[] {
  return raw
    .split(',')
    .map((k) => normalizeInbound(k))
    .filter(Boolean);
}

/** Rupiah tanpa desimal -- harga obat di Khanza selalu bilangan bulat rupiah. */
export function formatRupiah(nilai: number): string {
  return `Rp${Math.round(nilai).toLocaleString('id-ID')}`;
}

/**
 * Seberapa banyak yang disebut tentang tiap obat.
 *
 * TIGA nilai, bukan boolean, dan itu bukan kerapian: yang disembunyikan pada
 * masing-masing tingkat adalah informasi yang BERBEDA JENIS, dan rumah sakit
 * wajar memutuskannya sendiri-sendiri.
 *
 * - `penuh`   -- angka sisa, satuan, harga, tanda (menipis)/(habis). Untuk
 *                petugas apotek: mereka butuh angkanya untuk bekerja.
 * - `harga`   -- ketersediaan berikut harga, tanpa angka persediaan. Jumlah
 *                persediaan adalah informasi dagang apotek.
 * - `ringkas` -- nama dan ketersediaan saja. Dipakai saat harga di Khanza belum
 *                tentu harga yang siap diumumkan; penanya diarahkan bertanya
 *                harga ke manusia lewat teks pembungkusnya.
 *
 * Bentuk sebelumnya `tampilkanJumlah: boolean` hanya bisa menyatakan dua yang
 * pertama, dan boolean yang harus tumbuh jadi tiga keadaan adalah persis bentuk
 * yang berulang kali dibayar di proyek ini (`Modal`'s `wide?: boolean`,
 * `PlanCheck.allowFullScan`).
 */
export type RincianStok = 'penuh' | 'harga' | 'ringkas';

export interface OpsiFormatStok {
  /** Seberapa banyak yang disebut tentang tiap obat. */
  rincian: RincianStok;
  /** Harga mana yang disebut: rawat jalan atau jual bebas. */
  hargaDipakai: 'ralan' | 'jualbebas';
  /** Jumlah baris yang sebenarnya cocok, untuk catatan pemotongan. */
  truncatedFrom?: number;
}

/**
 * Menyusun daftar obat jadi teks WhatsApp.
 *
 * MURNI dan terpisah dari query-nya, karena kotak uji coba di dashboard
 * memakainya dengan jalur yang sama -- pratinjau yang berbeda dari yang
 * benar-benar terkirim lebih buruk daripada tanpa pratinjau. Ditaruh di `core/`
 * dan bukan di `khanza/` justru supaya bisa diuji unit tanpa database hidup.
 *
 * `sanitizeValue()` dipanggil untuk `nama_brng` DAN `satuan`, dan itu bukan
 * kehati-hatian berlebih: keduanya diketik bebas petugas gudang di Khanza.
 * Hasil fungsi ini dipasang ke `{stok_obat}` yang DIKECUALIKAN dari sanitasi
 * (MULTILINE_VARIABLES), jadi setiap baris baru pada hasil akhir wajib berasal
 * dari kode ini -- bukan dari isi kolom. Persis lubang ARCHITECTURE §9.2 kalau
 * dilewatkan.
 */
export function formatStokObat(rows: BarisStokObat[], opsi: OpsiFormatStok): string {
  if (rows.length === 0) return '';

  const baris = rows.map((r) => {
    const nama = sanitizeValue(r.nama_brng ?? '');
    const satuan = sanitizeValue(r.satuan ?? '');

    /**
     * Obat berstok nol TETAP disebut, ditandai "kosong" -- tidak disembunyikan
     * dari daftar.
     *
     * Membuangnya akan membuat "obat ini tidak dijual di sini" dan "obat ini
     * dijual, cuma sedang habis" terbaca persis sama oleh penanya: keduanya
     * menghasilkan daftar tanpa barisnya. Yang pertama berarti cari ke apotek
     * lain, yang kedua berarti tanyakan lagi besok -- dua tindakan yang
     * berbeda, dan yang salah membuat orang datang percuma atau justru tidak
     * datang padahal seharusnya.
     */
    const ada = r.stok > 0 ? 'tersedia' : 'kosong';

    // Nama dan ketersediaan saja. Harga sengaja tidak dihitung sama sekali di
    // cabang ini, bukan dihitung lalu dibuang.
    if (opsi.rincian === 'ringkas') return `• ${nama} — ${ada}`;

    const harga = formatRupiah(opsi.hargaDipakai === 'ralan' ? r.ralan : r.jualbebas);

    if (opsi.rincian === 'harga') {
      // Untuk penanya umum: ADA atau TIDAK, tanpa angka. Jumlah persediaan
      // adalah informasi dagang apotek, dan orang yang bertanya cuma perlu
      // tahu apakah perlu datang.
      return `• ${nama} — ${ada} — ${harga}`;
    }

    const satuanTeks = satuan ? ` ${satuan}` : '';
    /**
     * Nol dibedakan dari sekadar menipis, dan itu bukan kosmetik: "sisa 0
     * (menipis)" terbaca seolah masih ada yang bisa diserahkan hari ini.
     * Ditemukan saat menguji terhadap katalog sungguhan -- beberapa obat
     * memang berstok 0 sementara `stokminimal`-nya di atas nol, sehingga
     * keduanya jatuh ke cabang yang sama.
     *
     * Ambang "menipis" tetap diambil dari `stokminimal` milik Khanza, bukan
     * angka karangan kita; `stokminimal = 0` berarti apotek memang tidak
     * menetapkan ambang untuk barang itu.
     */
    const tanda = r.stok <= 0 ? ' (habis)' : r.stokminimal > 0 && r.stok <= r.stokminimal ? ' (menipis)' : '';
    return `• ${nama} — sisa ${r.stok}${satuanTeks} — ${harga}${tanda}`;
  });

  const catatan =
    opsi.truncatedFrom !== undefined && opsi.truncatedFrom > rows.length
      ? `\n\n(ditampilkan ${rows.length} dari ${opsi.truncatedFrom} yang cocok — sebutkan nama yang lebih lengkap)`
      : '';

  return baris.join('\n') + catatan;
}
