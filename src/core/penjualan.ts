/**
 * Menyusun satu PENJUALAN (nota apotek) jadi teks WhatsApp.
 *
 * Seluruh berkas fungsi murni -- tanpa database, tanpa WhatsApp -- supaya
 * pratinjau di halaman `/farmasi` memakai fungsi yang SAMA dipakai worker saat
 * benar-benar mengirim. Alasan yang sama seperti `core/pengadaan.ts` dan
 * `core/hibah.ts`: pratinjau yang berbeda dari kenyataan lebih buruk daripada
 * tanpa pratinjau, karena ia membuat orang percaya pada bentuk pesan yang tidak
 * akan pernah terkirim.
 *
 * Pembulatan rupiah, penanda tanggal kosong Khanza, pengelompokan per nomor, dan
 * aturan pemecahan pesan panjang dipakai bersama pengadaan dan hibah lewat
 * `core/notaBarang.ts`.
 *
 * ==========================================================================
 * Identitas pembeli tidak ada di sini, dan ketiadaannya DIJAGA DI HULU
 * ==========================================================================
 *
 * Ini satu-satunya nota barang yang tabel sumbernya PUNYA kolom pasien
 * (`penjualan.no_rkm_medis`, `penjualan.nm_pasien`) -- lihat komentar pembuka
 * `khanza/penjualan.ts`. Kolom itu tidak pernah di-SELECT, jadi bentuk baris di
 * bawah pun tidak punya tempat untuk menampungnya, dan `renderTemplate` tidak
 * punya variabel untuk merendernya.
 *
 * Kalau suatu saat ada yang menambahkan kolomnya ke query, ia juga harus
 * menambahkan field di sini DAN variabel di `PENJUALAN_TEMPLATE_VARIABLES` --
 * tiga langkah sadar, bukan satu yang tak sengaja. Itulah persis yang ditempuh
 * `keterangan`: ia sekarang dibaca, atas permintaan pemilik sistem, lewat ketiga
 * langkah itu berikut tiga pagar yang diuraikan di `khanza/penjualan.ts`.
 */
import { sanitizeValue } from './template';
import { isianSurat } from './suratDoc';
import { formatJumlah, formatRupiah, pecahBarisBarang, kelompokkanPerNomor } from './notaBarang';

export interface BarisPenjualan {
  nota_jual: string;
  tgl_jual: string | null;
  jns_jual: string | null;
  status: string | null;
  nama_petugas: string | null;
  nm_bangsal: string | null;
}

/** Hasil agregat `detailjual` per nota -- selalu dibaca, apa pun sakelar harganya. */
export interface RingkasPenjualan {
  nota_jual: string;
  jml_item: number | null;
  subtotal: number | null;
}

/**
 * Kolom header yang dibaca HANYA untuk nota yang benar-benar dikirim.
 *
 * `keterangan` ada di sini dan bukan di `BarisPenjualan`, dan pemisahan itu
 * bagian dari pagarnya: `BarisPenjualan` adalah bentuk baris jendela pindai, yang
 * dibaca ratusan kali tiap siklus. Selama teks bebas kasir tidak punya tempat di
 * bentuk itu, ia tidak bisa tak sengaja ikut terbaca di sana.
 */
export interface PenjualanTerpilih {
  nota_jual: string;
  ppn: number | null;
  ongkir: number | null;
  keterangan: string | null;
}

export interface BarisDetailPenjualan {
  nota_jual: string;
  kode_brng: string;
  nama_brng: string | null;
  satuan: string | null;
  jumlah: number | null;
  /** Absen sama sekali bila `farmasi.penjualan_harga` mati -- bukan sekadar kosong. */
  h_jual?: number | null;
  total?: number | null;
}

/**
 * Satu baris daftar barang.
 *
 * `sanitizeValue()` dipanggil untuk `nama_brng` DAN `satuan`, dan itu keharusan
 * bukan kehati-hatian berlebih: keduanya diketik bebas petugas di Khanza,
 * sementara hasil fungsi ini dipasang ke `{daftar_barang}` yang DIKECUALIKAN
 * dari sanitasi (MULTILINE_VARIABLES di `core/template.ts`). Artinya setiap baris
 * baru pada hasil akhir wajib berasal dari kode di sini -- kalau tidak, satu nama
 * barang berisi baris baru bisa menyisipkan barisnya sendiri ke dalam pesan.
 * Persis lubang ARCHITECTURE §9.2.
 *
 * Harga muncul HANYA bila kolomnya memang ikut di-SELECT. Diperiksa lewat
 * `undefined`, bukan lewat flag yang diteruskan terpisah: dengan begitu "harga
 * tidak ditampilkan" dan "harga tidak pernah dibaca dari sik" adalah satu keadaan
 * yang sama, dan tidak mungkin salah satunya benar sementara yang lain tidak.
 */
function barisBarangTeks(r: BarisDetailPenjualan): string {
  const nama = sanitizeValue(r.nama_brng ?? '') || r.kode_brng;
  const satuan = sanitizeValue(r.satuan ?? '');
  const jumlah = formatJumlah(r.jumlah);

  const bagian = [jumlah, satuan].filter(Boolean).join(' ');
  let teks = `• ${nama} — ${bagian || '-'}`;

  if (r.h_jual !== undefined) {
    const harga = formatRupiah(r.h_jual);
    const total = formatRupiah(r.total);
    if (harga) teks += ` @ ${harga}`;
    if (total) teks += ` = ${total}`;
  }
  return teks;
}

/**
 * Daftar barang sebagai SATU ATAU BEBERAPA pesan.
 *
 * Penurunan TUNGGAL untuk teks daftar barang penjualan; `formatDaftarBarang()`
 * cuma kasus khususnya dengan batas tak hingga.
 */
export function pecahDaftarBarangJual(rows: BarisDetailPenjualan[], batasKarakter: number): string[] {
  return pecahBarisBarang(rows.map(barisBarangTeks), batasKarakter);
}

/** Daftar lengkap dalam satu teks, tanpa pemecahan. Dipakai pratinjau dashboard. */
export function formatDaftarBarangJual(rows: BarisDetailPenjualan[]): string {
  return pecahDaftarBarangJual(rows, Number.POSITIVE_INFINITY)[0] ?? '';
}

/** Rincian dikelompokkan per nomor nota. */
export function kelompokkanDetailJual(rows: BarisDetailPenjualan[]): Map<string, BarisDetailPenjualan[]> {
  return kelompokkanPerNomor(rows, (r) => r.nota_jual);
}

/**
 * Isi `{keterangan}` -- kolom Keterangan yang diketik kasir di layar Khanza.
 *
 * Fungsi murni di core, bukan satu baris di dalam `susunVarsPenjualan`, dengan
 * alasan yang sama yang menempatkan `hitungTotalNota()` di sini: yang bisa salah
 * adalah TURUNANNYA, sementara runner mengimpor `@/models` sehingga tidak bisa
 * diuji tanpa MariaDB hidup. Seam ini yang membuat perilakunya dipatok uji unit.
 *
 * `isianSurat()` DIPAKAI BERSAMA, tidak disalin. Terukur atas seluruh 16.859
 * baris di database ini: 7.256 nota keterangannya terisi, tapi 7.172 di
 * antaranya (98,8%) cuma penanda '-' milik Khanza. Diteruskan apa adanya, hampir
 * setiap nota berbunyi "Keterangan : -" -- bentuk kegagalan yang sama persis
 * dengan alamat "KOTO ALAM, KELURAHAN, KECAMATAN" pada surat (026) dan
 * `nama_pemberi` berpenanda pada hibah (031). Daftar penandanya tumbuh dari
 * pengamatan atas data Khanza sungguhan, dan salinan yang tidak ikut diperbarui
 * adalah salinan yang diam-diam salah.
 *
 * TIDAK memanggil `sanitizeValue()` sendiri, dan itu disengaja: `{keterangan}`
 * bukan anggota MULTILINE_VARIABLES, jadi `renderTemplate` sudah
 * menyanitasinya seperti nilai luar mana pun. Menyanitasi dua kali di sini akan
 * membuat pemanggil berikutnya mengira variabel ini boleh masuk daftar itu.
 */
export function keteranganNota(nilai: string | null | undefined): string {
  return isianSurat(nilai);
}

/**
 * Total nota = subtotal barang + PPN + ongkos kirim.
 *
 * `penjualan` TIDAK menyimpan totalnya sama sekali -- hanya `ppn` dan `ongkir`
 * -- jadi angka ini memang harus dijumlahkan, bukan dibaca. Yang dijumlahkan
 * sebagai subtotal adalah `SUM(detailjual.total)`, dan itu kolom yang benar:
 * terukur `total = subtotal - bsr_dis + tambahan + embalase + tuslah` pada
 * SELURUH 29.852 baris, sehingga potongan dan embalase sudah ikut terhitung
 * sementara pada kolom `subtotal` belum.
 *
 * Mengembalikan `null` bila subtotalnya sendiri tidak diketahui -- bukan 0.
 * Nota yang totalnya tidak bisa dihitung harus tampil sebagai angka yang KOSONG,
 * bukan sebagai penjualan senilai nol rupiah; pelajaran `keAngka()` yang sama.
 */
export function hitungTotalNota(
  subtotal: unknown,
  ppn: unknown,
  ongkir: unknown,
): number | null {
  const angka = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const sub = angka(subtotal);
  if (sub === null) return null;
  return sub + (angka(ppn) ?? 0) + (angka(ongkir) ?? 0);
}
