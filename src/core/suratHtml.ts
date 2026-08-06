/**
 * Merangkai HTML satu halaman surat, untuk dicetak jadi PDF oleh Chromium.
 *
 * Fungsi MURNI, dan itu bukan kerapian: satu-satunya cara memastikan berkas
 * yang diterima pasien sama dengan yang dilihat staf di pratinjau adalah
 * keduanya memanggil fungsi yang sama ini. Pemisahan yang sama dipakai
 * `core/stokDarurat.ts` terhadap pesan darurat stok.
 *
 * ==========================================================================
 * PELOLOSAN HTML WAJIB, dan sebabnya BUKAN teoretis
 * ==========================================================================
 *
 * `nm_pasien`, `alamat`, `pekerjaan`, dan `nm_dokter` adalah ketikan bebas
 * petugas pendaftaran di Khanza -- sumber yang sama yang membuat substitusi
 * template harus satu lintasan (§"Substitusi template wajib satu lintasan").
 * Di sana bahayanya pasien bernama `{kontak_rs}`; di sini bahayanya nama yang
 * memuat `<` atau `&`, yang akan merusak susunan surat atau menyuntikkan
 * elemen ke dalam halaman yang dirender Chromium.
 *
 * Karena itu SETIAP nilai lewat `lolos()`, dan tidak ada satu pun tempat di
 * berkas ini yang menempelkan nilai mentah ke HTML.
 *
 * **Taruhannya naik sejak pratinjau di layar memakai HTML ini.** Dulu keluaran
 * berkas ini hanya pernah diserahkan ke Chromium yang mencetak PDF; sekarang
 * route `/administrasi/pratinjau` menyerahkannya juga ke peramban petugas, di
 * dalam `<iframe>`. Pelolosan di sini karenanya bukan lagi soal susunan surat
 * yang rusak melainkan soal keamanan sesi dashboard. Route itu memasang CSP
 * `sandbox` sebagai lapis kedua, dan `<iframe>`-nya ber-`sandbox` juga -- tapi
 * keduanya cadangan; yang menutup lubangnya tetap `lolos()` di bawah.
 *
 * Halaman React tetap TIDAK pernah memakai `dangerouslySetInnerHTML`: HTML ini
 * masuk ke peramban lewat `<iframe src=...>`, dokumennya sendiri, bukan
 * disuntikkan ke dalam pohon DOM dashboard.
 */

import {
  type IsiSurat,
  type KopSurat,
  type BarisIsian,
  JUDUL_SURAT,
  barisTerisi,
} from './suratDoc';

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

function barisIdentitas(baris: BarisIsian[]): string {
  return barisTerisi(baris)
    .map(
      (b) =>
        `<tr><td class="l">${lolos(b.label)}</td><td class="s">:</td><td class="v">${lolos(b.nilai)}</td></tr>`,
    )
    .join('');
}

/**
 * Gaya cetak A4.
 *
 * `@page { margin: 0 }` plus padding pada body, bukan margin milik Chromium --
 * margin Chromium menggambar header/footer bawaan (URL dan nomor halaman) yang
 * sama sekali tidak boleh muncul di surat resmi rumah sakit.
 *
 * Serif ("Times New Roman") mengikuti tampilan Jasper milik Khanza, supaya
 * surat yang dikirim lewat WhatsApp tidak terlihat sebagai dokumen yang
 * berbeda dari yang dicetak di loket.
 */
const GAYA = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body {
  font-family: "Times New Roman", Times, serif;
  font-size: 12pt; line-height: 1.5; color: #000;
  margin: 0; padding: 18mm 20mm;
}
.kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 8px; margin-bottom: 18px; }
.kop .nama { font-size: 15pt; font-weight: bold; text-transform: uppercase; letter-spacing: .5px; }
.kop .sub { font-size: 10pt; line-height: 1.35; }
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
.ttd { margin-top: 26px; width: 100%; }
.ttd .blok { width: 65mm; margin-left: auto; text-align: center; }
.ttd .ruang { height: 20mm; }
.ttd .nama { font-weight: bold; text-decoration: underline; }
.catatan {
  margin-top: 16mm; border-top: 1px solid #999; padding-top: 5px;
  font-size: 8pt; color: #444; line-height: 1.4; font-family: Arial, Helvetica, sans-serif;
}
`;

export interface OpsiSurat {
  /**
   * Baris asal-usul di kaki surat. Padanan parameter `finger` milik Khanza,
   * yang juga mencetak "Dikeluarkan di ... Ditandatangani secara elektronik
   * oleh ...". Dipisah sebagai opsi supaya pratinjau bisa menampilkan apa
   * adanya teks yang akan tercetak.
   */
  catatanKaki: string;
}

export function renderSuratHtml(isi: IsiSurat, kop: KopSurat, opsi: OpsiSurat): string {
  const alamatKop = [kop.alamatRs, kop.kotaRs, kop.propinsiRs].map((s) => s.trim()).filter(Boolean).join(', ');
  const kontakKop = [kop.kontakRs.trim() && `Telp. ${kop.kontakRs.trim()}`, kop.emailRs.trim() && `e-mail: ${kop.emailRs.trim()}`]
    .filter(Boolean)
    .join('  ·  ');

  const badan = isi.jenis === 'sakit' ? badanSakit(isi) : badanSehat(isi);

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${lolos(JUDUL_SURAT[isi.jenis])}</title>
<style>${GAYA}</style></head>
<body>
<div class="kop">
  <div class="nama">${lolos(kop.namaRs)}</div>
  ${alamatKop ? `<div class="sub">${lolos(alamatKop)}</div>` : ''}
  ${kontakKop ? `<div class="sub">${lolos(kontakKop)}</div>` : ''}
</div>

<h1>${lolos(JUDUL_SURAT[isi.jenis])}</h1>
${isi.noSurat ? `<p class="nosurat">No. ${lolos(isi.noSurat)}</p>` : '<div style="height:10px"></div>'}

${badan}

<div class="ttd">
  <div class="blok">
    <div>${lolos(kop.kotaRs || '')}${kop.kotaRs ? ', ' : ''}${lolos(isi.tanggalSurat)}</div>
    <div>Dokter Pemeriksa,</div>
    <div class="ruang"></div>
    <div class="nama">${lolos(isi.namaDokter)}</div>
  </div>
</div>

${opsi.catatanKaki ? `<div class="catatan">${lolos(opsi.catatanKaki).replace(/\n/g, '<br>')}</div>` : ''}
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
<table class="identitas">${barisIdentitas(isi.identitas)}</table>
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
<table class="identitas">${barisIdentitas(isi.identitas)}</table>
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
