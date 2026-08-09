import QRCode from 'qrcode';
import { getHospitalIdentity, getHospitalLogoDataUri } from '@/khanza/common';
import { sikSelect } from '@/db/sik';
import { logger } from '@/lib/logger';
import { type KopSurat, isianSurat } from '@/core/suratDoc';

/**
 * Perekat bersama untuk SETIAP berkas resmi yang dikirim ke pasien: kop surat,
 * QR pengesahan, dan catatan kaki asal-usul.
 *
 * Dipakai surat keterangan sakit/sehat (`lib/surat.ts`, migrations/026) dan
 * dokumen hasil lab / radiologi / nota (`lib/dokumen.ts`, migrations/038).
 * Padanan sisi-tidak-murni dari `core/cetakHtml.ts`, dan dipisah karena alasan
 * yang sama: dua salinan yang berangkat dari susunan Jasper yang sama akan
 * menyimpang pada perubahan berikutnya, dan yang muncul bukan galat melainkan
 * dua bentuk berbeda dari satu rumah sakit.
 */

/**
 * Kop surat.
 *
 * `getHospitalIdentity()` sudah memberi nama/alamat/kontak dan dipakai seluruh
 * pemicu lain, tapi kop butuh tiga hal lagi yang tidak ada di sana (kabupaten,
 * propinsi, email) -- Khanza mencetak keempatnya. Dibaca terpisah dari tabel
 * yang sama alih-alih melebarkan `HospitalIdentity`, supaya bentuk yang dipakai
 * belasan pemicu lain tidak ikut berubah demi satu halaman.
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
 * Catatan asal-usul di kaki berkas -- padanan parameter `finger` milik Khanza,
 * yang juga mencetak "Dikeluarkan di ... Ditandatangani secara elektronik
 * oleh ...".
 *
 * BUKAN hiasan. Berkas PDF yang beredar di WhatsApp lepas dari sistem yang
 * membuatnya: tanpa satu baris pun yang menyebut dari mana ia berasal dan
 * bahwa lembar asli bertanda tangan ada di rumah sakit, ia tidak bisa
 * dibedakan dari berkas yang disunting siapa pun. Kalimatnya bisa diubah RS
 * lewat dashboard, tapi bila dikosongkan tetap ada bentuk bawaannya -- ini
 * bagian yang tidak boleh hilang karena kotaknya kosong.
 */
export const CATATAN_KAKI_BAWAAN =
  'Dokumen ini diterbitkan secara elektronik oleh {nama_rs} dan dikirim melalui WhatsApp resmi rumah sakit. ' +
  'Lembar asli yang ditandatangani tersedia di rumah sakit. Bila ada keraguan atas keaslian dokumen ini, ' +
  'hubungi {kontak_rs}.';

/** Kosong/whitespace = pakai bawaannya, bukan berkas tanpa catatan kaki. */
export function rakitCatatanKaki(teks: string | null | undefined, kop: KopSurat): string {
  const isi = teks?.trim() || CATATAN_KAKI_BAWAAN;
  return isi.replace(/\{nama_rs\}/g, kop.namaRs).replace(/\{kontak_rs\}/g, kop.kontakRs);
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
 * **Kegagalan TIDAK menjatuhkan berkasnya.** Isi QR bisa melampaui daya tampung
 * bila nama rumah sakit dan nama dokter luar biasa panjang, dan menolak
 * menerbitkan dokumen karena hiasan pengesahannya gagal adalah pertukaran yang
 * salah arah -- yang dibutuhkan pasien adalah isinya. Yang hilang pun tidak
 * kritis: keterangan asal-usul yang sama tetap tercetak sebagai teks di kaki
 * berkas, dan itulah alasan keduanya ada. Dicatat `warn` supaya kegagalannya
 * tetap punya jejak alih-alih hilang diam-diam.
 */
export async function buatQrAsalUsul(teks: string): Promise<string> {
  if (!teks) return '';
  try {
    return await QRCode.toDataURL(teks, { errorCorrectionLevel: 'H', scale: 8 });
  } catch (err) {
    logger.warn({ err, panjang: teks.length }, 'QR pengesahan gagal dibuat, berkas tetap diterbitkan');
    return '';
  }
}
