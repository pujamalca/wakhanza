/**
 * Penyusun ISI surat keterangan sakit & sehat -- seluruhnya fungsi murni.
 *
 * Dipisah dari `khanza/suratPasien.ts` (yang membaca database) dan dari
 * `core/suratHtml.ts` (yang merangkai HTML) dengan alasan yang sudah berulang
 * di proyek ini: pratinjau di layar dan berkas PDF yang benar-benar terkirim
 * WAJIB berangkat dari penurunan yang sama. Pratinjau yang berbeda dari
 * kenyataan lebih buruk daripada tanpa pratinjau -- dan di sini yang berbeda
 * bukan sekadar tampilan melainkan isi sebuah surat resmi rumah sakit.
 *
 * ==========================================================================
 * PENANDA KOSONG -- bagian yang paling gampang dianggap kerapian belaka
 * ==========================================================================
 *
 * Khanza mengisi kolom yang belum diketahui dengan penanda, bukan dengan NULL,
 * dan penandanya berbeda-beda per kolom. Diukur di database produksi ini:
 *
 *   pasien.pekerjaan = '-'                14 dari 18 surat sakit (78%)
 *   perusahaan_pasien.nama_perusahaan = '-'   18 dari 18 (100%)
 *   kelurahan.nm_kel = 'KELURAHAN'        4.332 dari 4.873 pasien (89%)
 *   kecamatan.nm_kec = 'KECAMATAN'        4.328
 *   kabupaten.nm_kab = 'KABUPATEN'        4.362
 *
 * Baris wilayah itu bukan data yang kebetulan jelek: ia baris ISIAN BAWAAN yang
 * namanya adalah nama tabelnya sendiri. Query cetak milik Khanza menggabungkan
 * keempatnya apa adanya (`concat(pasien.alamat,', ',kelurahan.nm_kel,...)`),
 * jadi surat yang keluar dari Khanza untuk 89% pasien beralamat
 * "KOTO ALAM, KELURAHAN, KECAMATAN, KABUPATEN".
 *
 * Meneruskannya apa adanya menghasilkan surat resmi yang terbaca seperti sistem
 * rusak, dan yang membuatnya berbahaya: TIDAK ADA GALAT. Pelajaran yang sama
 * sudah dibayar di `namaPenjamin()` -- `-` adalah penanda, bukan nama.
 *
 * Yang TIDAK dilakukan di sini: menebak penggantinya. Baris yang kosong
 * dihilangkan seluruhnya dari surat, bukan diisi karangan. Menebak menghasilkan
 * jawaban percaya-diri-dan-keliru, kesalahan yang sama yang membuat
 * `detectPoli()` mengembalikan null saat ambigu.
 */

/** Penanda "belum diisi" yang berlaku untuk kolom teks mana pun. */
const PENANDA_UMUM = new Set(['-', '--', '---', 'null', 'undefined', 'n/a', 'na', '0']);

/**
 * Bersihkan satu isian: kembalikan string kosong bila nilainya penanda.
 *
 * `penandaSendiri` untuk kolom yang penanda bawaannya adalah nama tabelnya
 * sendiri -- `kelurahan.nm_kel = 'KELURAHAN'`. Dicocokkan tanpa peduli besar
 * kecil huruf karena Khanza menulisnya kapital sementara nama sungguhan di
 * database ini juga kapital ("TABEK PATAH") -- yang membedakan cuma katanya.
 */
export function isianSurat(nilai: string | null | undefined, ...penandaSendiri: string[]): string {
  const teks = (nilai ?? '').trim();
  if (!teks) return '';
  const kecil = teks.toLowerCase();
  if (PENANDA_UMUM.has(kecil)) return '';
  return penandaSendiri.some((p) => p.toLowerCase() === kecil) ? '' : teks;
}

export interface BagianAlamat {
  alamat?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kabupaten?: string | null;
}

/**
 * Rangkai alamat lengkap, MELEWATI bagian yang cuma penanda.
 *
 * Menghasilkan string kosong bila tidak ada satu pun bagian yang berarti --
 * pemanggilnya lalu menghilangkan barisnya dari surat, bukan mencetak
 * "Alamat : ".
 */
export function rakitAlamat(bagian: BagianAlamat): string {
  return [
    isianSurat(bagian.alamat),
    isianSurat(bagian.kelurahan, 'kelurahan', 'desa'),
    isianSurat(bagian.kecamatan, 'kecamatan'),
    isianSurat(bagian.kabupaten, 'kabupaten', 'kota'),
  ]
    .filter(Boolean)
    .join(', ');
}

const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * "2026-08-06" -> "6 Agustus 2026".
 *
 * Menerima string apa adanya dari MariaDB (`dateStrings: true`, lihat
 * §"Dua gotcha koneksi") alih-alih `Date`, justru supaya tidak ada konversi
 * zona waktu yang bisa menggeser tanggal surat sehari. `'0000-00-00'` --
 * penanda Khanza untuk "belum" -- menghasilkan string kosong, bukan
 * "Invalid Date".
 */
export function formatTanggalSurat(iso: string | null | undefined): string {
  const teks = (iso ?? '').trim();
  const cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(teks);
  if (!cocok) return '';
  const [, thn, bln, tgl] = cocok;
  const bulan = Number(bln);
  const hari = Number(tgl);
  if (bulan < 1 || bulan > 12 || hari < 1 || hari > 31 || thn === '0000') return '';
  return `${hari} ${NAMA_BULAN[bulan - 1]} ${thn}`;
}

/** `sttsumur` Khanza berupa singkatan; surat resmi menuliskannya penuh. */
const SATUAN_UMUR: Record<string, string> = { Th: 'Tahun', Bl: 'Bulan', Hr: 'Hari' };

/**
 * "4 Bl" -> "4 Bulan".
 *
 * Umur diambil dari `reg_periksa.umurdaftar` (umur SAAT MENDAFTAR), bukan
 * dihitung dari `tgl_lahir` terhadap hari ini -- itu yang dipakai Khanza, dan
 * surat yang dicetak ulang tahun depan harus tetap menyebut umur yang sama
 * seperti surat aslinya.
 */
export function formatUmurSurat(umur: number | null | undefined, satuan: string | null | undefined): string {
  if (umur === null || umur === undefined || !Number.isFinite(umur) || umur < 0) return '';
  const kode = (satuan ?? '').trim();
  return `${umur} ${SATUAN_UMUR[kode] ?? kode}`.trim();
}

export function jenisKelaminLengkap(jk: string | null | undefined): string {
  const kode = (jk ?? '').trim().toUpperCase();
  if (kode === 'L') return 'Laki-Laki';
  if (kode === 'P') return 'Perempuan';
  return '';
}

/** Identitas rumah sakit untuk kop surat -- dari `sik.setting`, bukan dikarang. */
export interface KopSurat {
  namaRs: string;
  alamatRs: string;
  kotaRs: string;
  propinsiRs: string;
  kontakRs: string;
  emailRs: string;
}

/** Satu baris "Label : Nilai" pada badan surat. */
export interface BarisIsian {
  label: string;
  nilai: string;
}

export interface IsiSuratSakit {
  jenis: 'sakit';
  noSurat: string;
  namaPasien: string;
  noRm: string;
  identitas: BarisIsian[];
  lamaSakit: string;
  tanggalAwal: string;
  tanggalAkhir: string;
  /** Kosong kecuali RS menyalakannya sendiri -- lihat `khanza/suratPasien.ts`. */
  diagnosa: string;
  namaDokter: string;
  tanggalSurat: string;
}

export interface IsiSuratSehat {
  jenis: 'sehat';
  /** Kosong: Khanza tidak menyimpan nomor untuk surat sehat (lihat modul khanza). */
  noSurat: string;
  namaPasien: string;
  noRm: string;
  identitas: BarisIsian[];
  /** Dari `surat_keterangan_sehat` bila barisnya ada; kosong bila tidak. */
  kesimpulan: string;
  butaWarna: string;
  keperluan: string;
  namaDokter: string;
  tanggalSurat: string;
}

export type IsiSurat = IsiSuratSakit | IsiSuratSehat;

/**
 * Jenis surat, TINGGAL DI SINI dan bukan di berkas server action.
 *
 * Versi pertama menaruhnya di `administrasi/actions.ts` lalu meng-ekspor
 * ulangnya untuk dipakai komponen klien. `tsc` meloloskannya -- tipe memang
 * terhapus saat kompilasi -- tapi berkas ber-`'use server'` hanya boleh
 * mengekspor fungsi async, dan bundler memancarkan rujukan RUNTIME untuk
 * ekspor itu. Hasilnya `ReferenceError: JenisSurat is not defined` yang baru
 * muncul saat server action pertama dipanggil di build produksi, bukan saat
 * typecheck maupun build.
 *
 * Ditaruh di modul MURNI supaya komponen klien bisa mengimpornya tanpa ikut
 * menarik `lib/surat` -- yang berujung ke koneksi database.
 */
export type JenisSurat = IsiSurat['jenis'];

/** Baris identitas yang nilainya kosong DIBUANG, bukan dicetak tanpa isi. */
export function barisTerisi(baris: BarisIsian[]): BarisIsian[] {
  return baris.filter((b) => b.nilai !== '');
}

export const JUDUL_SURAT: Record<IsiSurat['jenis'], string> = {
  sakit: 'SURAT KETERANGAN SAKIT',
  sehat: 'SURAT KETERANGAN SEHAT',
};

/**
 * Nama berkas yang dilihat pasien di WhatsApp.
 *
 * Memuat nama pasien supaya berkas yang tersimpan di ponsel masih bisa
 * dikenali berbulan-bulan kemudian, dan dibersihkan dari karakter yang tidak
 * sah pada nama berkas Windows/Android. Ini MURNI nama tampilan -- nama berkas
 * di disk tetap dibuat acak oleh `namaBerkasSimpanan()`, jadi tidak ada jalur
 * di mana nama pasien bisa menentukan lokasi tulis (§ core/media.ts).
 */
export function namaBerkasSurat(jenis: IsiSurat['jenis'], namaPasien: string): string {
  const judul = jenis === 'sakit' ? 'Surat-Keterangan-Sakit' : 'Surat-Keterangan-Sehat';
  const nama = namaPasien
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return nama ? `${judul}-${nama}.pdf` : `${judul}.pdf`;
}
