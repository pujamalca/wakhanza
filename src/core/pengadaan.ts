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
 * Yang tinggal di sini HANYA yang khas pengadaan: bentuk barisnya, dan susunan
 * satu baris daftar barang. Pembulatan rupiah, penanda tanggal kosong,
 * pengelompokan per nomor, dan aturan pemecahan pesan panjang dipakai bersama
 * dengan HIBAH lewat `core/notaBarang.ts` -- keduanya nota barang dari gudang
 * yang sama ke grup yang sama, dan dua salinan aturan yang bisa menyimpang
 * adalah bentuk kegagalan yang sudah berulang kali dibayar di proyek ini.
 *
 * Tidak ada satu pun data pasien di sini, dan tidak bisa ada -- lihat komentar
 * pembuka `khanza/pengadaan.ts`.
 */
import { sanitizeValue } from './template';
import { formatJumlah, formatRupiah, pecahBarisBarang, kelompokkanPerNomor } from './notaBarang';

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

/**
 * Daftar barang sebagai SATU ATAU BEBERAPA pesan.
 *
 * Ini penurunan TUNGGAL untuk teks daftar barang pengadaan;
 * `formatDaftarBarang()` cuma kasus khususnya dengan batas tak hingga. Aturan
 * pemecahannya sendiri ada di `pecahBarisBarang()` dan dipakai bersama hibah.
 */
export function pecahDaftarBarang(rows: BarisDetailPengadaan[], batasKarakter: number): string[] {
  return pecahBarisBarang(rows.map(barisBarangTeks), batasKarakter);
}

/** Daftar lengkap dalam satu teks, tanpa pemecahan. Dipakai pratinjau dashboard. */
export function formatDaftarBarang(rows: BarisDetailPengadaan[]): string {
  return pecahDaftarBarang(rows, Number.POSITIVE_INFINITY)[0] ?? '';
}

/** Rincian dikelompokkan per nomor faktur. */
export function kelompokkanDetail(rows: BarisDetailPengadaan[]): Map<string, BarisDetailPengadaan[]> {
  return kelompokkanPerNomor(rows, (r) => r.no_faktur);
}
