/**
 * Menyusun satu PENGADAAN (pembelian langsung obat/alkes/BHP) jadi teks WhatsApp.
 *
 * Seluruh berkas fungsi murni -- tanpa database, tanpa WhatsApp -- supaya
 * pratinjau di halaman `/farmasi` memakai fungsi yang SAMA dipakai worker saat
 * benar-benar mengirim. Alasan yang sama seperti `core/stokDarurat.ts` dan
 * `core/autoReply.ts`: pratinjau yang berbeda dari kenyataan lebih buruk
 * daripada tanpa pratinjau, karena ia membuat orang percaya pada bentuk pesan
 * yang tidak akan pernah terkirim.
 *
 * Tidak ada satu pun data pasien di sini, dan tidak bisa ada -- lihat komentar
 * pembuka `khanza/pengadaan.ts`.
 */
import { sanitizeValue } from './template';

export interface BarisPengadaan {
  no_faktur: string;
  tgl_beli: string | null;
  nama_suplier: string | null;
  nama_petugas: string | null;
  nm_bangsal: string | null;
  total1: number | null;
  potongan: number | null;
  ppn: number | null;
  tagihan: number | null;
}

export interface BarisDetailPengadaan {
  no_faktur: string;
  kode_brng: string;
  nama_brng: string | null;
  satuan: string | null;
  jumlah: number | null;
  /** Absen sama sekali bila `farmasi.pengadaan_harga` mati -- bukan sekadar kosong. */
  h_beli?: number | null;
  total?: number | null;
}

/**
 * Panjang maksimal daftar barang dalam SATU pesan WhatsApp; selebihnya dipecah.
 *
 * Angkanya sengaja disamakan dengan `BATAS_KARAKTER_BAGIAN` milik darurat stok,
 * yang bukan dibaca dari dokumentasi melainkan DIUKUR: pesan 13.035 karakter
 * dikirim lewat sesi whatsapp-web.js sungguhan di mesin ini dan terbukti
 * terkirim dalam 274 ms. Menyalin angkanya alih-alih mengimpornya disengaja --
 * keduanya kebetulan sama sekarang, tapi keduanya boleh bergerak sendiri; yang
 * TIDAK boleh adalah salah satunya berubah karena yang lain berubah.
 *
 * Di sini ia hampir pasti tidak akan pernah menggigit: faktur terbanyak di
 * database ini berisi 58 barang (rata-rata 5,7), yang berarti sekitar 4.000
 * karakter. Pemecahan adalah jaring pengaman terhadap instalasi lain, bukan
 * perilaku sehari-hari.
 */
export const BATAS_KARAKTER_PENGADAAN = 12000;

/**
 * Ruang yang disisihkan di tiap bagian untuk penanda "(bagian i dari n)".
 * Penanda itu baru diketahui SESUDAH pemecahan selesai, jadi tanpa cadangan ini
 * bagian terakhir bisa melewati batas justru karena keterangan yang menjelaskan
 * bahwa ia terpecah.
 */
const CADANGAN_KETERANGAN = 80;

/**
 * Angka rupiah untuk dibaca manusia.
 *
 * MySQL `double` menyeberang lewat mysql2 kadang sebagai `number` dan kadang
 * sebagai string (tergantung driver dan besarannya), jadi keduanya diterima.
 * Yang bukan angka menghasilkan string KOSONG, bukan "Rp NaN" -- pesan yang
 * memuat NaN terbaca sebagai sistem rusak, dan sejak itu angka yang benar pun
 * tidak dipercaya.
 */
export function formatRupiah(nilai: unknown): string {
  const n = keAngka(nilai);
  if (n === null) return '';
  return `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n)}`;
}

/** Jumlah barang; pecahan dipertahankan karena `detailbeli.jumlah` bertipe double. */
function formatJumlah(nilai: unknown): string {
  const n = keAngka(nilai);
  if (n === null) return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
}

/**
 * `null`/`undefined`/string kosong ditolak SEBELUM `Number()` menyentuhnya, dan
 * itu bukan kerapian.
 *
 * `Number(null)` dan `Number('')` keduanya menjawab `0`, yang lolos
 * `Number.isFinite`. Jadi tanpa pemeriksaan ini, `h_beli` yang tidak tercatat
 * (kolomnya NULLABLE di Khanza) akan dicetak sebagai **"Rp0"** -- bukan "tidak
 * diketahui" melainkan "gratis". Itu jawaban percaya-diri-dan-keliru yang sama
 * jenisnya dengan `detectPoli()` yang menebak saat ambigu, dan di sini ia
 * menyangkut angka yang dipakai apotek mencocokkan nota pemasok.
 *
 * Ditemukan unit test, bukan diperkirakan.
 */
function keAngka(nilai: unknown): number | null {
  if (nilai === null || nilai === undefined || nilai === '') return null;
  const n = typeof nilai === 'number' ? nilai : Number(nilai);
  return Number.isFinite(n) ? n : null;
}

/**
 * Satu baris daftar barang.
 *
 * `sanitizeValue()` dipanggil untuk `nama_brng` DAN `satuan`, dan itu keharusan
 * bukan kehati-hatian berlebih: keduanya diketik bebas petugas gudang di Khanza,
 * sementara hasil fungsi ini dipasang ke `{daftar_barang}` yang DIKECUALIKAN
 * dari sanitasi (MULTILINE_VARIABLES di `core/template.ts`). Artinya setiap
 * baris baru pada hasil akhir wajib berasal dari kode di sini -- kalau tidak,
 * satu nama barang berisi baris baru bisa menyisipkan barisnya sendiri ke dalam
 * pesan. Persis lubang ARCHITECTURE §9.2.
 *
 * Harga muncul HANYA bila kolomnya memang ikut di-SELECT. Diperiksa lewat
 * `undefined`, bukan lewat sebuah flag yang diteruskan terpisah: dengan begitu
 * "harga tidak ditampilkan" dan "harga tidak pernah dibaca dari sik" adalah satu
 * keadaan yang sama, dan tidak mungkin salah satunya benar sementara yang lain
 * tidak.
 */
function barisBarangTeks(r: BarisDetailPengadaan): string {
  const nama = sanitizeValue(r.nama_brng ?? '') || r.kode_brng;
  const satuan = sanitizeValue(r.satuan ?? '');
  const jumlah = formatJumlah(r.jumlah);

  const bagian = [jumlah, satuan].filter(Boolean).join(' ');
  let teks = `• ${nama} — ${bagian || '-'}`;

  if (r.h_beli !== undefined) {
    const harga = formatRupiah(r.h_beli);
    const total = formatRupiah(r.total);
    if (harga) teks += ` @ ${harga}`;
    if (total) teks += ` = ${total}`;
  }
  return teks;
}

export interface RingkasanPengadaan {
  /** Baris yang benar-benar dicetak. */
  ditampilkan: BarisDetailPengadaan[];
  /** Seluruh barang pada faktur ini. */
  total: number;
}

/**
 * Daftar barang sebagai SATU ATAU BEBERAPA pesan.
 *
 * Tidak pernah membelah satu baris barang, dan selalu memuat setidaknya satu
 * baris per bagian -- jaminan kedua itu yang membuat perulangannya pasti
 * berhenti sekalipun batasnya disetel lebih kecil daripada satu baris.
 *
 * Ini penurunan TUNGGAL untuk teks daftar barang; `formatDaftarBarang()` cuma
 * kasus khususnya dengan batas tak hingga. Dua fungsi yang sama-sama merangkai
 * daftar ini akan menyimpang cepat atau lambat, dan yang muncul saat menyimpang
 * bukan galat melainkan dua bentuk pesan berbeda dari satu sistem.
 */
export function pecahDaftarBarang(rows: BarisDetailPengadaan[], batasKarakter: number): string[] {
  if (rows.length === 0) return [];

  const batas =
    Number.isFinite(batasKarakter) && batasKarakter > 0
      ? Math.max(1, Math.floor(batasKarakter) - CADANGAN_KETERANGAN)
      : Number.MAX_SAFE_INTEGER;

  const baris = rows.map(barisBarangTeks);
  const bagian: string[] = [];
  let buf: string[] = [];
  let panjang = 0;

  for (const b of baris) {
    const biaya = b.length + (buf.length === 0 ? 0 : 1);
    // Baris PERTAMA tiap bagian selalu ditulis tanpa syarat -- itu yang menjamin
    // perulangan ini maju walau batasnya dibuat tidak masuk akal.
    if (buf.length > 0 && panjang + biaya > batas) {
      bagian.push(buf.join('\n'));
      buf = [];
      panjang = 0;
    }
    panjang += b.length + (buf.length === 0 ? 0 : 1);
    buf.push(b);
  }
  if (buf.length > 0) bagian.push(buf.join('\n'));

  // Penanda hanya muncul saat memang terpecah. Pesan tunggal bertanda
  // "(bagian 1 dari 1)" membuat pembacanya menunggu bagian kedua yang tidak akan
  // pernah datang.
  if (bagian.length > 1) {
    return bagian.map((b, i) => `_(bagian ${i + 1} dari ${bagian.length})_\n${b}`);
  }
  return bagian;
}

/** Daftar lengkap dalam satu teks, tanpa pemecahan. Dipakai pratinjau dashboard. */
export function formatDaftarBarang(rows: BarisDetailPengadaan[]): string {
  return pecahDaftarBarang(rows, Number.POSITIVE_INFINITY)[0] ?? '';
}

/**
 * Mengelompokkan rincian menurut nomor faktur.
 *
 * Satu query mengembalikan rincian untuk SEKIAN faktur sekaligus (`IN`), jadi
 * pengelompokannya harus terjadi di sini. `Map` dan bukan objek biasa: nomor
 * faktur adalah kunci yang datang dari database, dan objek biasa punya kunci
 * bawaan (`constructor`, `__proto__`) yang bisa bertabrakan dengannya.
 */
export function kelompokkanDetail(rows: BarisDetailPengadaan[]): Map<string, BarisDetailPengadaan[]> {
  const out = new Map<string, BarisDetailPengadaan[]>();
  for (const r of rows) {
    const daftar = out.get(r.no_faktur);
    if (daftar) daftar.push(r);
    else out.set(r.no_faktur, [r]);
  }
  return out;
}

/**
 * Tanggal `YYYY-MM-DD` dari Khanza jadi bentuk yang dibaca orang.
 *
 * Koneksi `sik` memakai `dateStrings: true`, jadi yang datang adalah string --
 * bukan `Date`. Penanda kosong Khanza (`'0000-00-00'`) dan nilai yang bentuknya
 * tidak dikenali dikembalikan sebagai string KOSONG, bukan diteruskan apa
 * adanya: "Tanggal : 0000-00-00" terbaca sebagai sistem rusak, dan perlakuannya
 * jadi sama dengan variabel lain yang memang tidak terisi.
 */
export function formatTanggalBeli(tgl: string | null): string {
  if (!tgl) return '';
  const cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(tgl);
  if (!cocok || cocok[1] === '0000') return '';
  return `${cocok[3]}-${cocok[2]}-${cocok[1]}`;
}
