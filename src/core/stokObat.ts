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
const KATA_PENGAPIT = new Set([
  'apakah', 'apa', 'ada', 'adakah', 'berapa', 'brp', 'harganya', 'stoknya',
  'sisa', 'sisanya', 'masih', 'punya', 'tersedia', 'ketersediaan', 'cek',
  'tolong', 'mohon', 'minta', 'mau', 'ingin', 'beli', 'obat', 'obatnya',
  'ya', 'yah', 'ka', 'kak', 'min', 'admin', 'pak', 'bu', 'bapak', 'ibu',
  'selamat', 'pagi', 'siang', 'sore', 'malam', 'permisi', 'assalamualaikum',
  'di', 'ke', 'dari', 'untuk', 'buat', 'yang', 'dan', 'atau', 'nya', 'itu',
  'ini', 'saya', 'aku', 'kami', 'anda', 'gimana', 'bagaimana', 'info',
]);

export interface PermintaanStok {
  /** Ada kata kunci stok/harga di pesannya. */
  cocok: boolean;
  /** Kata kunci yang membuatnya cocok -- untuk log dan pratinjau. */
  keyword?: string;
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
 */
export function deteksiPermintaanStok(teks: string, keywords: string[]): PermintaanStok {
  const norm = normalizeInbound(buangMention(teks));
  if (!norm) return { cocok: false, cari: '' };

  const kunciNorm = keywords.map((k) => normalizeInbound(k)).filter(Boolean);
  const terpakai = kunciNorm.find((k) => cocokKataUtuh(norm, k));
  if (!terpakai) return { cocok: false, cari: '' };

  // Buang SEMUA kata kunci (bukan cuma yang cocok pertama) -- "stok dan harga
  // paramex" harus menyisakan "paramex", bukan "harga paramex".
  const sisa = norm
    .split(' ')
    .filter((kata) => kata && !kunciNorm.includes(kata) && !KATA_PENGAPIT.has(kata))
    .join(' ')
    .trim();

  return {
    cocok: true,
    keyword: terpakai,
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

export interface OpsiFormatStok {
  /** Tampilkan angka stok sungguhan. Bila false, hanya "tersedia"/"kosong". */
  tampilkanJumlah: boolean;
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
    const harga = formatRupiah(opsi.hargaDipakai === 'ralan' ? r.ralan : r.jualbebas);

    if (!opsi.tampilkanJumlah) {
      // Untuk penanya umum: ADA atau TIDAK, tanpa angka. Jumlah persediaan
      // adalah informasi dagang apotek, dan orang yang bertanya cuma perlu
      // tahu apakah perlu datang.
      return `• ${nama} — ${r.stok > 0 ? 'tersedia' : 'kosong'} — ${harga}`;
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
