import QRCode from 'qrcode';
import { getSetting, getSettingBool } from '@/models';
import { getHospitalIdentity, getHospitalLogoDataUri } from '@/khanza/common';
import { logger } from '@/lib/logger';
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
import { sikSelect } from '@/db/sik';
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
 * Kop surat.
 *
 * `getHospitalIdentity()` sudah memberi nama/alamat/kontak dan dipakai seluruh
 * pemicu lain, tapi kop surat butuh dua hal lagi yang tidak ada di sana
 * (kabupaten, propinsi, email) -- Khanza mencetak keempatnya. Dibaca terpisah
 * dari tabel yang sama alih-alih melebarkan `HospitalIdentity`, supaya bentuk
 * yang dipakai sepuluh pemicu lain tidak ikut berubah demi satu halaman.
 */
export async function bacaKopSurat(): Promise<KopSurat> {
  // Ketiganya bebas dari satu sama lain, dan dua di antaranya hampir selalu
  // dijawab dari cache -- dijalankan berbarengan supaya membuka pratinjau tidak
  // menunggu tiga perjalanan berurutan ke database.
  const [identitas, logoDataUri, rows] = await Promise.all([
    getHospitalIdentity(),
    getHospitalLogoDataUri(),
    sikSelect<{ kabupaten: string | null; propinsi: string | null; email: string | null }>(
      'SELECT kabupaten, propinsi, email FROM setting LIMIT 1',
    ),
  ]);
  const s = rows[0];
  return {
    namaRs: identitas.namaRs,
    alamatRs: identitas.alamatRs,
    kotaRs: isianSurat(s?.kabupaten),
    propinsiRs: isianSurat(s?.propinsi),
    kontakRs: identitas.kontakRs,
    emailRs: isianSurat(s?.email),
    logoDataUri,
  };
}

/**
 * Catatan asal-usul di kaki surat -- padanan parameter `finger` milik Khanza,
 * yang juga mencetak "Dikeluarkan di ... Ditandatangani secara elektronik
 * oleh ...".
 *
 * BUKAN hiasan. Berkas PDF yang beredar di WhatsApp lepas dari sistem yang
 * membuatnya: tanpa satu baris pun yang menyebut dari mana ia berasal dan
 * bahwa lembar asli bertanda tangan ada di rumah sakit, ia tidak bisa
 * dibedakan dari berkas yang disunting siapa pun. Kalimatnya bisa diubah RS
 * lewat halaman `/administrasi`, tapi bila dikosongkan tetap ada bentuk
 * bawaannya -- ini bagian yang tidak boleh hilang karena kotaknya kosong.
 */
const CATATAN_KAKI_BAWAAN =
  'Dokumen ini diterbitkan secara elektronik oleh {nama_rs} dan dikirim melalui WhatsApp resmi rumah sakit. ' +
  'Lembar asli yang ditandatangani tersedia di rumah sakit. Bila ada keraguan atas keaslian dokumen ini, ' +
  'hubungi {kontak_rs}.';

export async function bacaCatatanKaki(kop: KopSurat): Promise<string> {
  const teks = (await getSetting(SETTING_CATATAN_KAKI))?.trim() || CATATAN_KAKI_BAWAAN;
  return teks.replace(/\{nama_rs\}/g, kop.namaRs).replace(/\{kontak_rs\}/g, kop.kontakRs);
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

/**
 * QR pengesahan, memakai `qrcode` yang SUDAH jadi dependensi produksi lewat
 * layar Koneksi (QR penautan WhatsApp) -- nol paket baru, prinsip yang sama
 * yang membuat PDF-nya dibuat lewat Chromium bawaan whatsapp-web.js.
 *
 * `errorCorrectionLevel: 'H'` mengikuti Khanza persis. Tingkat itu memang boros
 * (30% isi QR dipakai untuk pemulihan), dan justru itu gunanya: berkas ini
 * dicetak ulang, difoto layar, lalu diteruskan lagi lewat WhatsApp yang
 * memampatkan gambar -- QR yang masih terbaca setelah semua itu adalah
 * satu-satunya QR yang berguna.
 *
 * **Kegagalan TIDAK menjatuhkan suratnya.** Isi QR bisa melampaui daya tampung
 * bila nama rumah sakit dan nama dokter luar biasa panjang, dan menolak
 * menerbitkan surat karena hiasan pengesahannya gagal adalah pertukaran yang
 * salah arah -- yang dibutuhkan pasien adalah suratnya. Yang hilang pun tidak
 * kritis: keterangan asal-usul yang sama tetap tercetak sebagai teks di kaki
 * surat, dan itulah alasan keduanya ada. Dicatat `warn` supaya kegagalannya
 * tetap punya jejak alih-alih hilang diam-diam.
 */
async function buatQrAsalUsul(teks: string): Promise<string> {
  if (!teks) return '';
  try {
    return await QRCode.toDataURL(teks, { errorCorrectionLevel: 'H', scale: 8 });
  } catch (err) {
    logger.warn({ err, panjang: teks.length }, 'QR pengesahan surat gagal dibuat, surat tetap diterbitkan');
    return '';
  }
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
