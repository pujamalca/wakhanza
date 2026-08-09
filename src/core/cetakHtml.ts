/**
 * Kerangka cetak A4 yang DIPAKAI BERSAMA oleh setiap dokumen resmi yang dikirim
 * ke pasien: surat keterangan sakit/sehat (`core/suratHtml.ts`, migrations/026)
 * dan hasil lab / hasil radiologi / nota tagihan (`core/dokumenHtml.ts`,
 * migrations/038).
 *
 * ==========================================================================
 * Kenapa dipisah, dan kenapa BUKAN disalin
 * ==========================================================================
 *
 * Kop surat, blok tanda tangan berikut QR pengesahannya, dan catatan kaki
 * asal-usul adalah bagian yang membuat sebuah berkas terlihat DAN terbukti
 * berasal dari rumah sakit ini. Bentuknya dibaca dari susunan Jasper milik
 * Khanza (posisi logo 70x70 di pojok kiri, QR di dalam ruang tanda tangan),
 * bukan dipilih -- jadi begitu ada dokumen kedua, dua salinan yang berangkat
 * dari sumber yang sama akan menyimpang pada perubahan berikutnya, dan yang
 * tertinggal adalah dokumen yang lebih jarang disentuh.
 *
 * Bentuk kegagalannya bukan galat melainkan DUA BENTUK BERBEDA dari satu rumah
 * sakit: berkas yang kopnya tidak sama dengan berkas lain dari nomor yang sama
 * adalah persis apa yang membuat penerimanya ragu keduanya asli. Pelajaran yang
 * sama sudah dibayar di `respectsOptOut()`, `core/outboxStatus.ts`,
 * `kunciPesanMasuk()`, `core/tujuanPemicu.ts`, dan `core/broadcastVars.ts`.
 *
 * ==========================================================================
 * PELOLOSAN HTML WAJIB
 * ==========================================================================
 *
 * `nm_pasien`, `alamat`, `nm_dokter`, `nm_perawatan` seluruhnya ketikan bebas
 * petugas di Khanza -- sumber yang sama yang membuat substitusi template harus
 * satu lintasan. Setiap nilai di sini lewat `lolos()`, dan tidak ada satu pun
 * tempat yang menempelkan nilai mentah ke HTML.
 *
 * Taruhannya bukan cuma susunan berkas yang rusak: sejak pratinjau di layar
 * ada, HTML ini sampai ke peramban petugas di dalam `<iframe>`. Rute
 * pratinjaunya memasang CSP `sandbox` sebagai lapis kedua, tapi itu cadangan --
 * yang menutup lubangnya tetap `lolos()`.
 *
 * ==========================================================================
 * GAMBAR: data URI, dan tidak boleh jadi yang lain
 * ==========================================================================
 *
 * Logo dan QR ditanam sebagai `data:` URI. Berkas ini dirender di DUA tempat
 * yang sama-sama tidak punya asal-usul untuk menyelesaikan lintasan relatif --
 * `page.setContent()` milik Chromium, dan `<iframe>` ber-CSP `sandbox` di
 * dashboard. `<img src="/...">` akan menghasilkan berkas tanpa logo tanpa satu
 * pun galat, DAN membatalkan janji `lib/pdf.ts` bahwa render tidak pernah
 * menyentuh jaringan.
 */

import type { KopSurat, BarisIsian } from './suratDoc';
import { barisTerisi } from './suratDoc';

/**
 * Lima karakter, bukan tiga.
 *
 * `<` dan `&` yang biasa disebut memang cukup untuk teks di antara elemen, tapi
 * nilai di sini juga masuk ke atribut (`title` pada tanda tangan), dan di sana
 * kutip tunggal maupun ganda sama-sama bisa mengakhiri atributnya lebih awal.
 */
export function lolos(teks: string): string {
  return teks
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Satu tabel "Label : Nilai"; baris yang nilainya kosong DIBUANG. */
export function barisIdentitasHtml(baris: BarisIsian[]): string {
  return barisTerisi(baris)
    .map(
      (b) =>
        `<tr><td class="l">${lolos(b.label)}</td><td class="s">:</td><td class="v">${lolos(b.nilai)}</td></tr>`,
    )
    .join('');
}

/**
 * Gaya cetak A4 -- DASAR, dipakai apa adanya oleh surat maupun dokumen hasil.
 *
 * `@page { margin: 0 }` plus padding pada body, bukan margin milik Chromium --
 * margin Chromium menggambar header/footer bawaan (URL dan nomor halaman) yang
 * sama sekali tidak boleh muncul di berkas resmi rumah sakit.
 *
 * Serif ("Times New Roman") mengikuti tampilan Jasper milik Khanza, supaya
 * berkas yang dikirim lewat WhatsApp tidak terlihat sebagai dokumen yang
 * berbeda dari yang dicetak di loket.
 */
export const GAYA_CETAK = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body {
  font-family: "Times New Roman", Times, serif;
  font-size: 12pt; line-height: 1.5; color: #000;
  margin: 0; padding: 18mm 20mm;
}
.kop { position: relative; text-align: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 18px; }
.kop .nama { font-size: 15pt; font-weight: bold; text-transform: uppercase; letter-spacing: .5px; }
.kop .sub { font-size: 10pt; line-height: 1.35; }
/* Logo di kiri, teks TETAP terpusat pada lebar penuh -- itu susunan Khanza
   (gambar 70x70 di x=0, teks terpusat sepanjang band 552px). Karena logonya
   keluar dari aliran, teksnya diberi sisipan di KEDUA sisi supaya nama rumah
   sakit yang panjang tidak menabraknya sambil tetap terpusat. Sisipan itu
   hanya dipasang saat logonya memang ada. */
/* 20mm logo + 4mm jarak ke garis ganda. Logonya keluar dari aliran, jadi
   TIDAK ada margin/padding miliknya sendiri yang bisa mendorong garis itu --
   hanya min-height kop yang menahannya. Tanpa selisih ini logo menempel di
   garis sementara teks di sebelahnya punya jarak, dan yang terlihat adalah kop
   yang miring sebelah. */
.kop.berlogo { min-height: 24mm; }
.kop.berlogo .teks { padding: 0 23mm; }
.kop .logo { position: absolute; left: 0; top: 0; width: 20mm; height: 20mm; object-fit: contain; }
h1 { font-size: 13.5pt; text-align: center; text-decoration: underline; letter-spacing: 1px; margin: 0 0 2px; }
.nosurat { text-align: center; font-size: 11pt; margin: 0 0 16px; }
.pembuka { margin: 0 0 10px; text-align: justify; }
table.identitas { border-collapse: collapse; margin: 0 0 12px 8mm; }
table.identitas td { padding: 1.5px 0; vertical-align: top; }
td.l { width: 38mm; }
td.s { width: 5mm; }
td.v { font-weight: bold; }
.isi { margin: 0 0 10px; text-align: justify; }
.penutup { margin: 14px 0 0; text-align: justify; }
/* QR duduk DI DALAM blok tanda tangan, di ruang tanda tangan antara label
   penanda tangan dan namanya -- itu susunan Khanza, dibaca dari posisi
   elemennya di rptSuratSakit5.jrxml (tanggal y=306, "Pemeriksa" y=321, QR
   y=340, nm_dokter y=419) dan rptSuratSehat.jrxml (y=245 / y=258 / y=322).
   Versi pertama menaruhnya di pojok kiri bawah halaman: QR-nya terbaca sebagai
   gambar yang berdiri sendiri, bukan sebagai tanda tangan elektronik atas nama
   orang yang tercetak tepat di bawahnya -- padahal justru itu yang
   disahkannya.
   .blok tetap memegang margin-left:auto supaya blok tanda tangan tetap di
   kanan APA PUN keadaan QR-nya; berkas yang QR-nya gagal dibuat tidak boleh
   berpindah tata letak.
   Catatan: blok gaya ini ada di dalam template literal JS -- jangan pakai
   backtick di komentarnya, ia menutup stringnya dan galatnya muncul sebagai
   kesalahan sintaks yang menunjuk baris lain. */
.ttd { margin-top: 26px; width: 100%; }
.ttd .blok { width: 65mm; margin-left: auto; text-align: center; }
.ttd .qr { margin: 2mm 0 1mm; }
.ttd .qr img { width: 24mm; height: 24mm; display: block; margin: 0 auto; }
/* Ruang tanda tangan basah, dipakai HANYA saat QR tidak ada -- tanpa itu nama
   penanda tangan naik menempel ke labelnya, dan berkasnya kehilangan tempat
   untuk ditandatangani bila dicetak. */
.ttd .ruang { height: 20mm; }
.ttd .nama { font-weight: bold; text-decoration: underline; }
.ttd .ket { font-size: 7pt; color: #444; line-height: 1.3; margin-top: 3px; font-family: Arial, Helvetica, sans-serif; }
.catatan {
  margin-top: 16mm; border-top: 1px solid #999; padding-top: 5px;
  font-size: 8pt; color: #444; line-height: 1.4; font-family: Arial, Helvetica, sans-serif;
}
`;

/** Kop surat: logo di kiri, identitas rumah sakit terpusat, garis ganda di bawah. */
export function kopHtml(kop: KopSurat): string {
  const alamatKop = [kop.alamatRs, kop.kotaRs, kop.propinsiRs].map((s) => s.trim()).filter(Boolean).join(', ');
  const kontakKop = [kop.kontakRs.trim() && `Telp. ${kop.kontakRs.trim()}`, kop.emailRs.trim() && `e-mail: ${kop.emailRs.trim()}`]
    .filter(Boolean)
    .join('  ·  ');

  return `<div class="kop${kop.logoDataUri ? ' berlogo' : ''}">
  ${kop.logoDataUri ? `<img class="logo" src="${lolos(kop.logoDataUri)}" alt="">` : ''}
  <div class="teks">
    <div class="nama">${lolos(kop.namaRs)}</div>
    ${alamatKop ? `<div class="sub">${lolos(alamatKop)}</div>` : ''}
    ${kontakKop ? `<div class="sub">${lolos(kontakKop)}</div>` : ''}
  </div>
</div>`;
}

export interface OpsiTandaTangan {
  kotaRs: string;
  /** Tanggal yang dibaca manusia, mis. "8 Agustus 2026". */
  tanggal: string;
  /** Label di atas nama, mis. "Dokter Pemeriksa," atau "Petugas Kasir,". */
  label: string;
  nama: string;
  /** Data URI QR pengesahan; kosong = ruang tanda tangan basah. */
  qrDataUri: string;
}

/**
 * Blok tanda tangan di kanan bawah, berikut QR pengesahan bila ada.
 *
 * Label diserahkan pemanggil karena yang menandatangani memang berbeda per
 * dokumen -- surat keterangan ditandatangani dokter pemeriksa, hasil penunjang
 * oleh dokter penanggung jawabnya, nota oleh kasir. Menyeragamkannya jadi
 * "Dokter Pemeriksa," pada sebuah nota berarti berkas keuangan yang mengaku
 * ditandatangani dokter.
 */
export function ttdHtml(opsi: OpsiTandaTangan): string {
  return `<div class="ttd">
  <div class="blok">
    <div>${lolos(opsi.kotaRs || '')}${opsi.kotaRs ? ', ' : ''}${lolos(opsi.tanggal)}</div>
    <div>${lolos(opsi.label)}</div>
    ${
      opsi.qrDataUri
        ? `<div class="qr"><img src="${lolos(opsi.qrDataUri)}" alt="Kode QR pengesahan"></div>`
        : '<div class="ruang"></div>'
    }
    <div class="nama">${lolos(opsi.nama)}</div>
    ${
      opsi.qrDataUri
        ? `<div class="ket">Ditandatangani secara elektronik.<br>Pindai QR untuk memeriksa keabsahannya.</div>`
        : ''
    }
  </div>
</div>`;
}

/**
 * Catatan kaki asal-usul.
 *
 * BUKAN hiasan, dan bukan pengulangan QR di atasnya: Khanza menaruh teks
 * `finger` HANYA di dalam QR dan tidak pernah mencetaknya sebagai tulisan --
 * benar untuk kertas yang diserahkan di loket. Berkas ini beredar lepas, jadi
 * pembaca tanpa pemindai tetap harus bisa membaca asal-usulnya. Catatan kaki
 * melayani MANUSIA, QR melayani PEMINDAI.
 */
export function catatanHtml(teks: string): string {
  return teks ? `<div class="catatan">${lolos(teks).replace(/\n/g, '<br>')}</div>` : '';
}
