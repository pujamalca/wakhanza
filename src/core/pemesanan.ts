/**
 * Menyusun satu SURAT PEMESANAN (pesanan obat/alkes/BHP ke pemasok) jadi teks
 * WhatsApp.
 *
 * Seluruh berkas fungsi murni -- tanpa database, tanpa WhatsApp -- supaya
 * pratinjau di halaman `/farmasi` memakai fungsi yang SAMA dipakai worker saat
 * benar-benar mengirim. Alasan yang sama seperti `core/pengadaan.ts` dan
 * `core/hibah.ts`: pratinjau yang berbeda dari kenyataan lebih buruk daripada
 * tanpa pratinjau, karena ia membuat orang percaya pada bentuk pesan yang tidak
 * akan pernah terkirim.
 *
 * Yang tinggal di sini HANYA yang khas pemesanan: bentuk barisnya, dan susunan
 * satu baris daftar barang. Pembulatan rupiah, penanda tanggal kosong,
 * pengelompokan per nomor, dan aturan pemecahan pesan panjang dipakai bersama
 * dengan PENGADAAN dan HIBAH lewat `core/notaBarang.ts` -- ketiganya nota barang
 * dari gudang yang sama ke grup yang sama, dan salinan aturan yang bisa
 * menyimpang adalah bentuk kegagalan yang sudah berulang kali dibayar di proyek
 * ini.
 *
 * Tidak ada satu pun data pasien di sini, dan tidak bisa ada -- lihat komentar
 * pembuka `khanza/pemesanan.ts`.
 */
import { sanitizeValue } from './template';
import { formatJumlah, formatRupiah, pecahBarisBarang, kelompokkanPerNomor } from './notaBarang';

export interface BarisPemesanan {
  no_pemesanan: string;
  /**
   * Kolomnya bernama `tanggal` di Khanza, dan sengaja TIDAK dipetakan ke
   * variabel `{tanggal}`: nama itu sudah dipakai seluruh pemicu untuk waktu
   * PESANNYA dikirim. Variabelnya `{tgl_pemesanan}` -- padanan `{tgl_beli}` pada
   * pengadaan dan `{tgl_hibah}` pada hibah.
   */
  tanggal: string | null;
  nama_suplier: string | null;
  nama_petugas: string | null;
  /**
   * enum('Proses Pesan','Sudah Datang'), dan satu-satunya kolom pemicu di proyek
   * ini yang benar-benar BERUBAH sesudah barisnya tertulis. Ia dicetak sebagai
   * keterangan, TIDAK PERNAH masuk kunci idempoten -- staf bisa membalikkannya
   * bolak-balik lewat klik kanan, dan arah baliknya tanpa penjaga sama sekali.
   * Uraian lengkapnya di `migrations/030_pemesanan.sql`.
   */
  status: string | null;
  total1: number | null;
  potongan: number | null;
  ppn: number | null;
  /** Bea meterai. Tidak dipunyai `pembelian`, dan Khanza memasukkannya ke tagihan. */
  meterai: number | null;
  tagihan: number | null;
}

export interface BarisDetailPemesanan {
  no_pemesanan: string;
  kode_brng: string;
  nama_brng: string | null;
  satuan: string | null;
  jumlah: number | null;
  /** Absen sama sekali bila `farmasi.pemesanan_harga` mati -- bukan sekadar kosong. */
  h_pesan?: number | null;
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
 *
 * ==========================================================================
 * `total` yang dicetak, BUKAN `subtotal` -- dan itu temuan dari data
 * ==========================================================================
 *
 * `detail_surat_pemesanan_medis` menyimpan KEDUANYA: `subtotal` (jumlah x harga)
 * dan `total` (sesudah diskon baris, `dis`/`besardis`). Keduanya sama pada
 * hampir semua baris, jadi memilih yang salah tidak akan pernah terlihat --
 * kecuali pada baris yang justru paling perlu benar.
 *
 * Diukur atas 122 baris rincian sungguhan di `sik-ridda-dev`: diskon terpakai
 * pada **1 baris**, dan pada baris itu pula `subtotal <> total`. Satu dari 122
 * adalah kejarangan yang membuatnya tidak akan pernah disadari kalau keliru --
 * yang muncul bukan galat melainkan daftar barang yang tidak menjumlah ke
 * `{tagihan}` di kepala nota, tepat pada pesanan yang ada diskonnya.
 *
 * Diskonnya sendiri tidak dicetak sebagai kolom tersendiri: ia menambah satu
 * angka lagi pada tiap baris demi keadaan yang terjadi kurang dari 1%, sementara
 * selisihnya sudah terbaca dari `@ harga` dikali jumlah yang tidak sama dengan
 * totalnya.
 */
function barisBarangTeks(r: BarisDetailPemesanan): string {
  const nama = sanitizeValue(r.nama_brng ?? '') || r.kode_brng;
  const satuan = sanitizeValue(r.satuan ?? '');
  const jumlah = formatJumlah(r.jumlah);

  const bagian = [jumlah, satuan].filter(Boolean).join(' ');
  let teks = `• ${nama} — ${bagian || '-'}`;

  if (r.h_pesan !== undefined) {
    const harga = formatRupiah(r.h_pesan);
    const total = formatRupiah(r.total);
    if (harga) teks += ` @ ${harga}`;
    if (total) teks += ` = ${total}`;
  }
  return teks;
}

/**
 * Daftar barang sebagai SATU ATAU BEBERAPA pesan.
 *
 * Ini penurunan TUNGGAL untuk teks daftar barang pemesanan;
 * `formatDaftarBarangPemesanan()` cuma kasus khususnya dengan batas tak hingga.
 * Aturan pemecahannya sendiri ada di `pecahBarisBarang()` dan dipakai bersama
 * pengadaan dan hibah.
 *
 * Pemecahan di sini praktis tidak akan pernah menyala: terukur 3,1 barang per
 * pesanan dan 8 pada yang terbanyak, jauh di bawah pengadaan (5,7 rata-rata, 58
 * pada yang terbanyak). Ia tetap dipakai justru karena itu -- anggaran panjang
 * yang berbeda di antara tiga nota dari gudang yang sama tidak akan pernah bisa
 * dijelaskan, dan yang menjaganya tetap sama adalah memakai fungsi yang sama.
 */
export function pecahDaftarBarangPemesanan(rows: BarisDetailPemesanan[], batasKarakter: number): string[] {
  return pecahBarisBarang(rows.map(barisBarangTeks), batasKarakter);
}

/** Daftar lengkap dalam satu teks, tanpa pemecahan. Dipakai pratinjau dashboard. */
export function formatDaftarBarangPemesanan(rows: BarisDetailPemesanan[]): string {
  return pecahDaftarBarangPemesanan(rows, Number.POSITIVE_INFINITY)[0] ?? '';
}

/** Rincian dikelompokkan per nomor pemesanan. */
export function kelompokkanDetailPemesanan(rows: BarisDetailPemesanan[]): Map<string, BarisDetailPemesanan[]> {
  return kelompokkanPerNomor(rows, (r) => r.no_pemesanan);
}
