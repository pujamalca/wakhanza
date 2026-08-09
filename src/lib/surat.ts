import { getSetting, getSettingBool } from '@/models';
import { bacaKopSurat, rakitCatatanKaki, buatQrAsalUsul } from '@/lib/cetak';
import type { BarisSuratSakit, BarisSuratSehat } from '@/khanza/suratPasien';
import {
  type IsiSurat,
  type IsiSuratSakit,
  type IsiSuratSehat,
  type KopSurat,
  isianSurat,
  rakitAlamat,
  formatTanggalSurat,
  formatTanggalRingkas,
  formatUmurSurat,
  jenisKelaminLengkap,
  teksAsalUsul,
  type JenisSurat,
} from '@/core/suratDoc';
import { renderSuratHtml } from '@/core/suratHtml';
import { ambilSuratSakit, ambilKunjunganSehat } from '@/khanza/suratPasien';

export type { JenisSurat };

/**
 * Perakit baris Khanza -> isi surat, DAN satu-satunya tempat yang membaca
 * pengaturan `administrasi.*`.
 *
 * Berdiri di antara `khanza/suratPasien.ts` (baca database, tanpa pengaturan)
 * dan `core/suratDoc.ts` / `core/suratHtml.ts` (fungsi murni, tanpa keduanya).
 * Batas itu yang membuat `npm run verify:db` tetap bisa membuktikan `sik` hanya
 * dibaca, dan yang membuat pratinjau di layar memakai penurunan yang sama
 * persis dengan berkas yang benar-benar terkirim -- pelajaran yang sudah
 * dibayar di `previewUniqueCodeFooter()`.
 */

export const SETTING_AKTIF = 'administrasi.enabled';
export const SETTING_DIAGNOSA = 'administrasi.sertakan_diagnosa';
export const SETTING_PESAN_SAKIT = 'administrasi.pesan_sakit';
export const SETTING_PESAN_SEHAT = 'administrasi.pesan_sehat';
export const SETTING_CATATAN_KAKI = 'administrasi.catatan_kaki';

/**
 * PENGIRIMAN OTOMATIS -- hanya surat SAKIT, dan itu bukan pembatasan yang bisa
 * dilonggarkan belakangan.
 *
 * Surat sehat tidak punya baris tersimpan di Khanza sama sekali (lihat
 * `khanza/suratPasien.ts`): yang ada cuma KUNJUNGAN, dan Khanza mencetak
 * suratnya langsung dari layar registrasi. Jadi tidak ada satu pun kejadian
 * "surat sehat disimpan" yang bisa dipicu. Mengotomatiskannya berarti
 * menerbitkan surat keterangan sehat untuk setiap orang yang mendaftar -- bukan
 * versi otomatis dari fitur yang ada, melainkan mesin yang menyatakan orang
 * sehat tanpa satu pun dokter memutuskannya.
 */
export const SETTING_AUTO = 'administrasi.auto_enabled';
/**
 * Tanggal (YYYY-MM-DD) saat sakelar otomatis terakhir DINYALAKAN.
 *
 * Lantai jendela pindai. Tanpa ini, menyalakan sakelarnya berarti setiap surat
 * di dalam jendela -- termasuk milik pasien yang sudah pulang seminggu lalu --
 * langsung jadi berkas WhatsApp pada siklus berikutnya. Ditulis ulang tiap kali
 * dinyalakan, jadi mematikan lalu menyalakan lagi tidak pernah membuka kembali
 * arsip yang sudah lewat.
 */
export const SETTING_AUTO_SEJAK = 'administrasi.auto_sejak';
export const SETTING_AUTO_LOOKBACK = 'administrasi.auto_lookback_hari';
export const SETTING_AUTO_KUOTA = 'administrasi.auto_max_per_siklus';

export const AUTO_LOOKBACK_BAWAAN = 7;
export const AUTO_KUOTA_BAWAAN = 10;

/**
 * Bertingkat, dan sengaja bukan satu sakelar.
 *
 * `administrasi.enabled` menjawab "boleh mengirim surat lewat WhatsApp?" --
 * pertanyaan kebijakan yang harus dijawab rumah sakit lebih dulu. Yang ini
 * menjawab "boleh mengirimnya TANPA staf menekan tombol?", pertanyaan yang baru
 * masuk akal sesudahnya. Pola yang sama dengan `bpjs.batal_enabled` di bawah
 * `bpjs.enabled`.
 */
export async function otomatisAktif(): Promise<boolean> {
  return (await administrasiAktif()) && (await getSettingBool(SETTING_AUTO, false));
}

/**
 * Apakah diagnosa ikut dicetak.
 *
 * Dibaca DI SINI lalu diserahkan sebagai parameter ke `ambilSuratSakit()`,
 * bukan dibaca di dalam modul `khanza/` -- bentuk yang sama dengan
 * `farmasi.stok_pakai_batch`. Saat mati, kolomnya tidak ikut di-SELECT sama
 * sekali, jadi diagnosanya tidak pernah masuk ke proses ini: merendernya
 * mustahil, bukan sekadar terlarang (§5.2).
 */
export async function sertakanDiagnosa(): Promise<boolean> {
  return getSettingBool(SETTING_DIAGNOSA, false);
}

export async function administrasiAktif(): Promise<boolean> {
  return getSettingBool(SETTING_AKTIF, false);
}

/**
 * Kop surat, catatan kaki, dan QR pengesahan pindah ke `lib/cetak.ts` saat
 * dokumen kedua lahir (hasil lab/radiologi/nota, migrations/038) -- ketiganya
 * bukan milik surat melainkan milik "berkas resmi yang dikirim rumah sakit
 * ini". Diekspor ulang di sini supaya pemanggil lama tidak berubah.
 */
export { bacaKopSurat };

export async function bacaCatatanKaki(kop: KopSurat): Promise<string> {
  return rakitCatatanKaki(await getSetting(SETTING_CATATAN_KAKI), kop);
}

/** Baris identitas yang dipakai KEDUA surat, supaya keduanya tidak menyimpang. */
function identitasDasar(row: {
  nm_pasien: string | null;
  no_rkm_medis: string;
  umurdaftar: number | null;
  sttsumur: string | null;
  jk: string | null;
  alamat: string | null;
  nm_kel: string | null;
  nm_kec: string | null;
  nm_kab: string | null;
  pekerjaan: string | null;
}) {
  return {
    nama: isianSurat(row.nm_pasien),
    baris: [
      { label: 'Nama', nilai: isianSurat(row.nm_pasien) },
      { label: 'No. Rekam Medis', nilai: isianSurat(row.no_rkm_medis) },
      { label: 'Umur', nilai: formatUmurSurat(row.umurdaftar, row.sttsumur) },
      { label: 'Jenis Kelamin', nilai: jenisKelaminLengkap(row.jk) },
      { label: 'Pekerjaan', nilai: isianSurat(row.pekerjaan) },
      {
        label: 'Alamat',
        nilai: rakitAlamat({
          alamat: row.alamat,
          kelurahan: row.nm_kel,
          kecamatan: row.nm_kec,
          kabupaten: row.nm_kab,
        }),
      },
    ],
  };
}

export function susunSuratSakit(row: BarisSuratSakit): IsiSuratSakit {
  const { nama, baris } = identitasDasar(row);
  const instansi = isianSurat(row.nama_perusahaan);
  return {
    jenis: 'sakit',
    noSurat: isianSurat(row.no_surat),
    namaPasien: nama,
    noRm: row.no_rkm_medis,
    identitas: [...baris, { label: 'Instansi', nilai: instansi }],
    lamaSakit: isianSurat(row.lamasakit),
    tanggalAwal: formatTanggalSurat(row.tanggalawal),
    tanggalAkhir: formatTanggalSurat(row.tanggalakhir),
    // Kosong kecuali pemanggil meminta diagnosa DAN barisnya ada -- 4 dari 18
    // surat di database ini punya diagnosa tercatat.
    diagnosa: isianSurat(row.diagnosa),
    namaDokter: isianSurat(row.nm_dokter),
    kdDokter: isianSurat(row.kd_dokter),
    // Tanggal SURAT, bukan tanggal mulai istirahat: 5 dari 18 baris berbeda.
    tanggalSurat: formatTanggalSurat(row.tgl_registrasi),
    tanggalRingkas: formatTanggalRingkas(row.tgl_registrasi),
  };
}

export function susunSuratSehat(row: BarisSuratSehat): IsiSuratSehat {
  const { nama, baris } = identitasDasar(row);
  const tglLahir = formatTanggalSurat(row.tgl_lahir);
  // Tanggal lahir disisipkan setelah No. RM: itu urutan di `rptSuratSehat`,
  // yang menyebut tanggal lahir alih-alih umur.
  const identitas = [...baris];
  identitas.splice(2, 0, { label: 'Tanggal Lahir', nilai: tglLahir });
  return {
    jenis: 'sehat',
    // Khanza tidak menyimpan nomor untuk surat sehat -- lihat khanza/suratPasien.ts.
    noSurat: '',
    namaPasien: nama,
    noRm: row.no_rkm_medis,
    identitas,
    kesimpulan: isianSurat(row.kesimpulan),
    butaWarna: isianSurat(row.butawarna),
    keperluan: isianSurat(row.keperluan),
    namaDokter: isianSurat(row.nm_dokter),
    kdDokter: isianSurat(row.kd_dokter),
    tanggalSurat: formatTanggalSurat(row.tgl_registrasi),
    tanggalRingkas: formatTanggalRingkas(row.tgl_registrasi),
  };
}

/** Satu jalur dari isi surat ke HTML, dipakai pratinjau MAUPUN pengiriman. */
export async function suratKeHtml(isi: IsiSurat): Promise<string> {
  const kop = await bacaKopSurat();
  const [catatanKaki, qrDataUri] = await Promise.all([
    bacaCatatanKaki(kop),
    buatQrAsalUsul(teksAsalUsul(kop, isi)),
  ]);
  return renderSuratHtml(isi, kop, { catatanKaki, qrDataUri });
}

/**
 * Satu surat, siap dirender -- berikut ketiga hal yang dibutuhkan PENGIRIMNYA.
 *
 * Sengaja mengembalikan `isi` bersama `noRkmMedis`/`noTlp`/`kdPoli` alih-alih
 * membiarkan pemanggil membaca ulang barisnya: tanpa ini, aksi kirim dan rute
 * pratinjau masing-masing menurunkan sendiri "baris mana yang dibaca dan
 * bagaimana ia jadi surat". Dua penurunan yang sama untuk satu hal adalah
 * bentuk kegagalan yang sudah dibayar berkali-kali di proyek ini
 * (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`) -- dan di
 * sini yang menyimpang bukan angka melainkan ISI SURAT yang dilihat staf
 * dibanding yang diterima pasien.
 */
export interface SuratSiap {
  isi: IsiSurat;
  noRkmMedis: string;
  noTlp: string | null;
  kdPoli: string | null;
}

export async function muatSurat(jenis: JenisSurat, kunci: string): Promise<SuratSiap | null> {
  if (jenis === 'sakit') {
    const row = await ambilSuratSakit(kunci, await sertakanDiagnosa());
    if (!row) return null;
    return { isi: susunSuratSakit(row), noRkmMedis: row.no_rkm_medis, noTlp: row.no_tlp, kdPoli: row.kd_poli };
  }
  const row = await ambilKunjunganSehat(kunci);
  if (!row) return null;
  return { isi: susunSuratSehat(row), noRkmMedis: row.no_rkm_medis, noTlp: row.no_tlp, kdPoli: row.kd_poli };
}

/** Pesan WhatsApp yang menyertai lampiran. Kosong = pakai bawaannya. */
export const PESAN_BAWAAN: Record<IsiSurat['jenis'], string> = {
  sakit:
    'Bpk/Ibu {nama_pasien}, berikut surat keterangan sakit Anda dari {nama_rs}. ' +
    'Simpan berkas ini baik-baik. Informasi lebih lanjut hubungi {kontak_rs}.',
  sehat:
    'Bpk/Ibu {nama_pasien}, berikut surat keterangan sehat Anda dari {nama_rs}. ' +
    'Simpan berkas ini baik-baik. Informasi lebih lanjut hubungi {kontak_rs}.',
};

export async function bacaPesanPengantar(jenis: IsiSurat['jenis']): Promise<string> {
  const kunci = jenis === 'sakit' ? SETTING_PESAN_SAKIT : SETTING_PESAN_SEHAT;
  return (await getSetting(kunci))?.trim() || PESAN_BAWAAN[jenis];
}
