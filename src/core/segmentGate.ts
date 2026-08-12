/**
 * Apakah query segmen pasien dijalankan SAMA SEKALI -- dipakai bersama
 * /broadcast dan /broadcast-terjadwal.
 *
 * ==========================================================================
 * Kenapa ada gerbang, dan kenapa tempatnya di core
 * ==========================================================================
 *
 * Kedua halaman itu dulu menjalankan `fetchPatientSegment()` pada SETIAP
 * pemuatan, termasuk pemuatan pertama yang polos. Biayanya bukan cuma satu
 * query: `summarizeSegment()` lalu membaca `patient_contact` dan `opt_out`
 * untuk seluruh barisnya. Jendela bawaan 30 hari ada justru untuk menahan
 * biaya itu -- dan jendela itulah yang membuat pencarian nama diam-diam
 * gagal untuk pasien yang terakhir datang lebih lama dari itu.
 *
 * Membalik urutannya menyelesaikan keduanya sekaligus: JANGAN membaca apa pun
 * sampai staf benar-benar meminta, lalu saat ia meminta, cari tanpa dibatasi
 * jendela. Segmen yang tidak pernah dilihat siapa pun juga tidak pantas
 * langsung punya tombol Kirim yang aktif.
 *
 * Fungsi murni di core, bukan percabangan `if` di masing-masing halaman:
 * keduanya harus menjawab "sudah diminta atau belum" dengan cara yang PERSIS
 * sama. Dua tafsir yang berjauhan adalah bentuk kegagalan yang sudah berkali-
 * kali dibayar di proyek ini (`respectsOptOut()`, `core/outboxStatus.ts`,
 * `kunciPesanMasuk()`, `core/tujuanPemicu.ts`) -- dan yang paling mungkin
 * menyimpang di sini adalah /broadcast-terjadwal, halaman yang lebih jarang
 * disentuh.
 */

/**
 * Penanda "staf menekan tombolnya", dititipkan tombol Terapkan.
 *
 * Kunci TERSENDIRI, bukan disimpulkan dari "ada filter yang terisi": form GET
 * kedua halaman selalu mengirim `dateFrom`/`dateTo`/`kab`/`kec`/`pj` walau
 * kosong, jadi "ada filter" tidak bisa membedakan halaman yang baru dibuka
 * dari halaman yang filternya sengaja dikosongkan. Pembedaan yang sama sudah
 * dibayar di `parseFilters` ("kosong dan tidak ada itu beda").
 */
export const PARAM_TAMPIL = 'tampil';

/** Kenapa segmennya dibaca. `null` = tidak dibaca sama sekali. */
export type PemicuSegmen =
  /** Penerimanya daftar centang -- tabelnya BUKAN cuplikan melainkan daftar itu sendiri. */
  | 'pilih'
  /** Staf mengetik sesuatu di kotak cari. */
  | 'cari'
  /** Staf menekan Terapkan atau salah satu tombol preset. */
  | 'diminta';

export interface PemicuSegmenInput {
  modePilih: boolean;
  cari?: string;
  tampil?: string | string[];
  preset?: string | string[];
}

function terisi(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  return Array.isArray(value) ? value.some((v) => v.trim() !== '') : value.trim() !== '';
}

/**
 * Mode `pilih` SELALU dibaca, dan itu bukan pengecualian yang malas:
 *
 * - Tabelnya adalah daftar penerimanya. Tidak menampilkannya berarti pasien
 *   yang dicentang tidak bisa dilepas dari satu-satunya layar tempat ia
 *   terlihat -- staf terkunci pada daftar yang tidak bisa dikoreksi.
 * - Biayanya memang berbeda jenis: `fetchPatientsByRm` masuk lewat indeks
 *   `no_rkm_medis` untuk paling banyak MAX_PILIHAN_PASIEN no. RM, bukan
 *   memindai rentang kunjungan.
 */
export function pemicuSegmen(input: PemicuSegmenInput): PemicuSegmen | null {
  if (input.modePilih) return 'pilih';
  if (input.cari?.trim()) return 'cari';
  if (terisi(input.tampil) || terisi(input.preset)) return 'diminta';
  return null;
}

export function perluMuatSegmen(input: PemicuSegmenInput): boolean {
  return pemicuSegmen(input) !== null;
}

/**
 * Kalimat untuk keadaan "belum diminta". Ia WAJIB menyebut bahwa tabelnya
 * kosong karena belum dibaca, bukan karena tidak ada yang cocok -- dua keadaan
 * yang terlihat sama persis di layar dan menuntut tindakan yang berlawanan
 * (mencari, versus melonggarkan filter).
 */
export const PESAN_BELUM_DIMUAT =
  'Daftar pasien belum dibaca. Ketik nama/no. RM di kotak cari lalu tekan Enter, atau tekan "Terapkan filter" untuk menampilkan semua yang cocok. Sengaja tidak dimuat otomatis supaya membuka halaman ini tidak membebani database Khanza yang sedang dipakai petugas.';
