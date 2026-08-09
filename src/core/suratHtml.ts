/**
 * Merangkai HTML satu halaman surat keterangan sakit/sehat, untuk dicetak jadi
 * PDF oleh Chromium.
 *
 * Fungsi MURNI, dan itu bukan kerapian: satu-satunya cara memastikan berkas
 * yang diterima pasien sama dengan yang dilihat staf di pratinjau adalah
 * keduanya memanggil fungsi yang sama ini. Pemisahan yang sama dipakai
 * `core/stokDarurat.ts` terhadap pesan darurat stok.
 *
 * ==========================================================================
 * Kerangka halamannya ada di `core/cetakHtml.ts`, bukan di sini
 * ==========================================================================
 *
 * Gaya cetak A4, kop, blok tanda tangan berikut QR, dan catatan kaki asal-usul
 * pindah ke sana saat dokumen kedua lahir (hasil lab / radiologi / nota,
 * migrations/038). Keempatnya bukan milik surat -- ia milik "berkas resmi yang
 * dikirim rumah sakit ini", dan dua salinan yang berangkat dari susunan Jasper
 * yang sama akan menyimpang pada perubahan berikutnya.
 *
 * Yang tinggal di berkas ini cuma yang memang khas surat: judulnya, nomor
 * suratnya, dan kedua bentuk badan surat. Pemindahannya nol-perubahan-keluaran
 * -- dibuktikan dengan membandingkan HTML kedua surat sebelum dan sesudahnya,
 * bita per bita.
 *
 * Pelolosan HTML, alasan gambar wajib `data:` URI, dan catatan bahwa pratinjau
 * di layar menaikkan taruhannya: seluruhnya di `core/cetakHtml.ts`.
 */

import {
  type IsiSurat,
  type KopSurat,
  JUDUL_SURAT,
} from './suratDoc';
import { GAYA_CETAK, lolos, kopHtml, ttdHtml, catatanHtml, barisIdentitasHtml } from './cetakHtml';

/**
 * Diekspor ulang supaya pemanggil lama (`administrasi/pratinjau/route.ts`,
 * `suratDoc.test.ts`) tidak perlu berubah -- fungsinya sama persis, cuma
 * tempatnya yang pindah.
 */
export { lolos };

export interface OpsiSurat {
  /**
   * Baris asal-usul di kaki surat. Padanan parameter `finger` milik Khanza,
   * yang juga mencetak "Dikeluarkan di ... Ditandatangani secara elektronik
   * oleh ...". Dipisah sebagai opsi supaya pratinjau bisa menampilkan apa
   * adanya teks yang akan tercetak.
   */
  catatanKaki: string;
  /**
   * QR pengesahan sebagai data URI, atau string kosong.
   *
   * KEDUANYA ADA dan itu bukan pengulangan -- lihat `catatanHtml()` di
   * `core/cetakHtml.ts`.
   *
   * Dibuat di luar berkas ini karena `qrcode` bekerja asinkron, sementara
   * fungsi di sini wajib tetap murni -- itu yang menjamin pratinjau di layar
   * dan berkas yang terkirim berangkat dari satu penurunan.
   */
  qrDataUri: string;
}

export function renderSuratHtml(isi: IsiSurat, kop: KopSurat, opsi: OpsiSurat): string {
  const badan = isi.jenis === 'sakit' ? badanSakit(isi) : badanSehat(isi);

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${lolos(JUDUL_SURAT[isi.jenis])}</title>
<style>${GAYA_CETAK}</style></head>
<body>
${kopHtml(kop)}

<h1>${lolos(JUDUL_SURAT[isi.jenis])}</h1>
${isi.noSurat ? `<p class="nosurat">No. ${lolos(isi.noSurat)}</p>` : '<div style="height:10px"></div>'}

${badan}

${ttdHtml({
    kotaRs: kop.kotaRs,
    tanggal: isi.tanggalSurat,
    label: 'Dokter Pemeriksa,',
    nama: isi.namaDokter,
    qrDataUri: opsi.qrDataUri,
  })}

${catatanHtml(opsi.catatanKaki)}
</body></html>`;
}

/**
 * Mengikuti `rptSuratSakit5.jrxml`, dengan satu perbedaan yang disengaja:
 * baris "Diagnosa" beserta kalimat persetujuan di bawahnya hanya muncul bila
 * RS menyalakannya sendiri. Lihat `khanza/suratPasien.ts` -- saat mati,
 * kolomnya tidak di-SELECT sama sekali, jadi di sini `diagnosa` pasti kosong.
 */
function badanSakit(isi: Extract<IsiSurat, { jenis: 'sakit' }>): string {
  const rentang =
    isi.tanggalAwal && isi.tanggalAkhir
      ? ` terhitung dari tanggal <b>${lolos(isi.tanggalAwal)}</b> sampai dengan <b>${lolos(isi.tanggalAkhir)}</b>`
      : '';
  const lama = isi.lamaSakit ? ` selama <b>${lolos(isi.lamaSakit)}</b> hari` : '';

  return `<p class="pembuka">Yang bertanda tangan di bawah ini menerangkan bahwa:</p>
<table class="identitas">${barisIdentitasHtml(isi.identitas)}</table>
<p class="isi">Memerlukan istirahat${lama} karena sakit${rentang}.</p>
${
  isi.diagnosa
    ? `<table class="identitas"><tr><td class="l">Diagnosa</td><td class="s">:</td><td class="v">${lolos(isi.diagnosa)}</td></tr></table>
<p class="isi">Saya memberi ijin kepada <b>${lolos(isi.namaPasien)}</b> untuk memberikan keterangan diagnosa kepada pihak yang berkepentingan.</p>`
    : ''
}
<p class="penutup">Demikian agar yang berkepentingan harap maklum.</p>`;
}

/**
 * Mengikuti `rptSuratSehat.jrxml`.
 *
 * Kalimat buta warna di Jasper berbunyi "BUTA WARNA/TIDAK BUTA WARNA.*)" --
 * bentuk formulir cetak yang salah satunya dicoret dokter dengan tangan.
 * Karena `surat_keterangan_sehat.butawarna` menyimpan jawabannya, di sini
 * ditulis tegas. Bila barisnya tidak ada, kalimatnya DIHILANGKAN seluruhnya
 * alih-alih dicetak dengan pilihan menggantung -- surat yang dikirim lewat
 * WhatsApp tidak bisa dicoret siapa pun.
 */
function badanSehat(isi: Extract<IsiSurat, { jenis: 'sehat' }>): string {
  const kesimpulan = isi.kesimpulan || 'SEHAT';
  return `<p class="pembuka">Yang bertanda tangan di bawah ini menerangkan bahwa:</p>
<table class="identitas">${barisIdentitasHtml(isi.identitas)}</table>
<p class="isi">Pada hari ini telah kami periksa kesehatannya. Dari pemeriksaan tersebut, kami simpulkan bahwa yang bersangkutan dalam keadaan <b>${lolos(kesimpulan.toUpperCase())}</b>.</p>
${
  isi.butaWarna
    ? `<p class="isi">Telah kami lakukan pula pemeriksaan penapisan buta warna. Dari pemeriksaan tersebut kami simpulkan bahwa yang bersangkutan <b>${
        isi.butaWarna.toLowerCase() === 'ya' ? 'BUTA WARNA' : 'TIDAK BUTA WARNA'
      }</b>.</p>`
    : ''
}
<p class="penutup">Demikian surat keterangan ini dibuat dengan sebenar-benarnya untuk dapat digunakan ${
    isi.keperluan ? `sebagai <b>${lolos(isi.keperluan)}</b>` : 'sesuai keperluan'
  }.</p>`;
}
