import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { SELECT_SURAT_KONTROL, type KontrolUlangRow } from './kontrolUlang';

/**
 * SURAT KONTROL DITERBITKAN -- pasangan `KONTROL_ULANG` dari ujung yang lain.
 *
 *   KONTROL_TERBIT  surat DISIMPAN dokter   -> "surat kontrol Anda sudah dibuat"
 *   KONTROL_ULANG   H-N sebelum tanggalnya  -> "jangan lupa, kontrol besok"
 *
 * Bentuk yang sama dengan LAB_REQUEST/RESULT_READY dan SURAT PEMESANAN/
 * PENGADAAN: dua kejadian yang benar-benar berbeda pada satu benda, masing-
 * masing berbunyi tepat sekali. Yang PERTAMA menjawab pertanyaan yang selama ini
 * tidak terjawab sama sekali -- pasien meninggalkan poliklinik memegang selembar
 * kertas, dan tidak ada apa pun yang mengingatkannya sampai H-N.
 *
 * Barisnya sama, tabelnya sama, kolomnya sama (`SELECT_SURAT_KONTROL` dipakai
 * bersama). Yang berbeda cuma KOLOM TANGGAL yang menjadi jendelanya, dan itu
 * pula yang memaksa kelas pemicunya berbeda.
 *
 * ==========================================================================
 * Kelas PINDAI, dan kenapa jendelanya `tanggal_rujukan`
 * ==========================================================================
 *
 * `skdp_bpjs` tidak punya satu pun kolom waktu penyimpanan. Yang ada:
 *
 *   `tanggal_datang`  DATETIME  <- kotak Tanggal Periksa, DIPILIH staf
 *   `tanggal_rujukan` DATETIME  <- kotak Tanggal Surat, DIPILIH staf
 *
 * Nama `tanggal_rujukan` menyesatkan: ia tanggal SURATNYA, bukan tanggal
 * rujuk. Dibuktikan dari `SuratKontrol.java`'s `isBooking()`, yang mengisinya
 * dari kotak Tanggal Surat.
 *
 * Karena keduanya dipilih staf, watermark mustahil benar -- staf yang memundurkan
 * Tanggal Surat membuat barisnya lahir di BAWAH watermark dan hilang selamanya
 * tanpa satu pun galat. Jadi: jendela dua arah yang dipindai ulang tiap siklus,
 * dedup murni lewat kunci idempoten. Sama seperti SURAT_SAKIT, PENGADAAN, dan
 * HIBAH, dan perhitungan jendelanya pun dipakai bersama lewat
 * `core/jendelaPindai.ts`.
 *
 * ==========================================================================
 * PEMINDAIAN PENUH yang DISENGAJA -- dan ini berbeda dari KONTROL_ULANG
 * ==========================================================================
 *
 * `KONTROL_ULANG` memangkas lewat `tahun`, kolom pertama PRIMARY KEY, dan itu
 * eksak karena `tahun` diturunkan dari kotak yang sama dengan `tanggal_datang`.
 * Di sini jendelanya `tanggal_rujukan`, yang TIDAK punya hubungan tetap dengan
 * `tahun`: surat yang ditulis Desember untuk kontrol Januari punya `tahun`
 * tahun depan. Diukur di arsip, selisih `tanggal_datang - tanggal_rujukan`
 * merentang **-57 sampai +309 hari** -- jadi menebak "tahun ini saja", atau
 * bahkan "tahun ini plus satu", adalah pemangkas yang MELEWATKAN baris tanpa
 * galat. Kelas kegagalan yang sama dengan prefiks `nobooking` pembatalan BPJS.
 *
 * Yang dipilih karena itu pemindaian penuh yang disengaja, dan yang membuatnya
 * bisa diterima adalah LAJU TUMBUHNYA -- persis alasan yang sama yang diterima
 * untuk `referensi_mobilejkn_bpjs_batal`: tabel ini bertambah hanya saat
 * poliklinik menerbitkan surat kontrol. Terukur di arsip: 253 baris selama
 * pemakaian ~2 bulan (~4/hari), dan **1 baris** di database produksi.
 *
 * `maxRows` menjaga hal yang berbeda dari jendelanya: bukan "apakah jendelanya
 * membengkak" melainkan "apakah tabel ini masih sekelas yang boleh dipindai tiap
 * siklus". Kalau ia berbunyi, yang perlu ditinjau adalah menambahkan indeks pada
 * `tanggal_rujukan` di sisi Khanza -- bukan sekadar menaikkan angkanya.
 */

/** Sama persis dengan baris KONTROL_ULANG -- daftar kolomnya memang satu. */
export type KontrolTerbitRow = KontrolUlangRow;

const SQL_KONTROL_TERBIT = `
  ${SELECT_SURAT_KONTROL}
  WHERE DATE(s.tanggal_rujukan) BETWEEN :dari AND :sampai
    AND s.status = 'Menunggu'
  ORDER BY s.tanggal_rujukan, s.no_antrian
  LIMIT 300
`;

/**
 * @param dari,sampai jendela tanggal SURAT (inklusif), dari
 *   `hitungJendelaPindai()`.
 */
export async function pollKontrolTerbit(dari: string, sampai: string): Promise<KontrolTerbitRow[]> {
  return sikSelect<KontrolTerbitRow>(SQL_KONTROL_TERBIT, { dari, sampai });
}

/** Ambang peringatan "jendela terbaca PENUH" -- sama dengan LIMIT di atas. */
export const JENDELA_KONTROL_TERBIT_PENUH = 300;

registerPlanCheck({
  name: 'KONTROL_TERBIT',
  sql: SQL_KONTROL_TERBIT,
  replacements: { dari: '2026-01-01', sampai: '2026-12-31' },
  // Alias `s` = skdp_bpjs. Pemindaian penuh yang disengaja; alasannya di atas.
  // Keempat tabel lain di query yang sama TETAP dijaga -- izin per-tabel ada
  // justru supaya membebaskan satu tidak berarti berhenti menjaga semuanya.
  allowFullScan: ['s'],
  maxRows: 20000,
});
