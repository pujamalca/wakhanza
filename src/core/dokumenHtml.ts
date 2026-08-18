/**
 * Merangkai HTML hasil lab, hasil radiologi, dan nota tagihan (migrations/038).
 *
 * Fungsi MURNI, alasannya sama dengan `core/suratHtml.ts`: pratinjau di layar
 * dan berkas PDF yang benar-benar terkirim WAJIB berangkat dari satu penurunan.
 * Kerangka halamannya (gaya A4, kop, tanda tangan + QR, catatan kaki) diimpor
 * dari `core/cetakHtml.ts` yang sama, jadi ketiga dokumen ini dan kedua surat
 * keluar dari rumah sakit dengan bentuk yang sama persis.
 *
 * ==========================================================================
 * Yang khas di sini: TABEL, dan tabel yang bisa lebih panjang dari satu halaman
 * ==========================================================================
 *
 * Surat keterangan selalu satu halaman. Ketiga dokumen ini tidak: panel darah
 * lengkap bisa berisi belasan parameter, dan nota di database ini rata-rata 21
 * baris dengan yang terpanjang 41. Karena itu ada tiga aturan cetak yang tidak
 * dipunyai surat, dan ketiganya perlu:
 *
 *   `thead { display: table-header-group }`  judul kolom ikut tercetak di tiap
 *                                            halaman -- tanpa itu halaman kedua
 *                                            berisi deretan angka tanpa nama
 *                                            kolom, dan angka lab tanpa nama
 *                                            kolom tidak bisa dibaca sama sekali.
 *   `tr { break-inside: avoid }`             satu baris tidak terbelah dua
 *                                            halaman.
 *   `.blok-panel { break-inside: avoid-page }` panel pendek tidak dipisah dari
 *                                            judulnya.
 */

import {
  type IsiDokumen,
  type IsiDokumenLab,
  type IsiDokumenNota,
  type IsiDokumenRadiologi,
  JUDUL_DOKUMEN,
} from './dokumenDoc';
import type { KopSurat } from './suratDoc';
import { GAYA_CETAK, lolos, kopHtml, ttdHtml, catatanHtml, barisIdentitasHtml } from './cetakHtml';

/**
 * Gaya TAMBAHAN di atas `GAYA_CETAK` -- bukan penggantinya.
 *
 * Sengaja tidak menyentuh satu pun selektor milik kerangka bersamanya: kop,
 * `.ttd`, dan `.catatan` harus tampil sama persis seperti pada surat, karena
 * justru keseragaman itu yang membuat berkas dari nomor WhatsApp ini bisa
 * dikenali sebagai berkas rumah sakit yang sama.
 */
const GAYA_DOKUMEN = `
table.data { width: 100%; border-collapse: collapse; margin: 0 0 10px; font-size: 10.5pt; }
table.data thead { display: table-header-group; }
table.data tr { break-inside: avoid; }
table.data th, table.data td { border: 1px solid #666; padding: 3px 5px; vertical-align: top; }
table.data th { background: #eee; text-align: left; font-weight: bold; }
table.data td.num { text-align: right; white-space: nowrap; }
table.data td.mid { text-align: center; white-space: nowrap; }
table.data tr.tegas td { font-weight: bold; }
table.data tr.judul td { background: #f4f4f4; font-weight: bold; }
table.data td.indent { padding-left: 12px; }
.blok-panel { break-inside: avoid-page; margin-bottom: 6px; }
.blok-panel h2 { font-size: 11.5pt; margin: 10px 0 4px; }
.bacaan { white-space: pre-wrap; text-align: justify; margin: 0 0 10px; }
.bacaan .jam { display: block; font-size: 9.5pt; color: #444; margin-bottom: 2px; font-family: Arial, Helvetica, sans-serif; }
.daftar-periksa { margin: 0 0 10px; padding-left: 6mm; }
.peringatan {
  margin: 12px 0 0; padding: 6px 8px; border: 1px solid #999; background: #f7f7f7;
  font-size: 9.5pt; line-height: 1.4; font-family: Arial, Helvetica, sans-serif;
}
.kosong { color: #666; font-style: italic; }
.pita-contoh {
  margin: 0 0 10px; padding: 8px 10px; border: 2px solid #000; background: #eee;
  font-size: 10pt; line-height: 1.4; font-family: Arial, Helvetica, sans-serif; text-align: center;
}
.pita-contoh b { letter-spacing: 0.5px; }
`;

export interface OpsiDokumen {
  catatanKaki: string;
  qrDataUri: string;
  /**
   * Halaman ini berisi data KARANGAN (`core/dokumenContoh.ts`).
   *
   * Wajib diteruskan oleh siapa pun yang merender contoh: berkasnya bisa
   * diunduh dan diteruskan seperti berkas sungguhan, dan dokumen rumah sakit
   * berisi angka karangan yang tidak menyebut dirinya karangan adalah dokumen
   * palsu -- apa pun niat pembuatnya. Ditaruh di ATAS badan, sebelum satu pun
   * angka terbaca, bukan di catatan kaki.
   */
  contoh?: boolean;
}

/**
 * Kalimat yang WAJIB ada pada hasil pemeriksaan, dan bukan basa-basi hukum.
 *
 * Sebelum fitur ini, satu-satunya cara pasien memegang hasil labnya adalah
 * datang ke rumah sakit -- dan di sana selalu ada orang yang bisa ditanyai.
 * Berkas yang tiba di WhatsApp menghapus orang itu: angka di luar rentang
 * rujukan terbaca sebagai vonis, padahal banyak di antaranya sama sekali tidak
 * berarti sendirian.
 *
 * Ditaruh di berkas ini, bukan di pesan pengantar WhatsApp, karena berkasnyalah
 * yang diteruskan -- pesan pengantarnya tertinggal di chat asalnya.
 */
const PERINGATAN_HASIL =
  'Hasil pemeriksaan ini adalah data penunjang dan BUKAN diagnosis. ' +
  'Angka di luar nilai rujukan tidak selalu berarti penyakit, dan angka di dalam rentang tidak selalu berarti sehat. ' +
  'Silakan bawa hasil ini saat kontrol agar dibaca bersama dokter yang merawat Anda.';

/**
 * Pita "contoh" -- satu-satunya penanda yang membedakan halaman karangan dari
 * dokumen sungguhan, jadi ia sengaja di ATAS badan dan berbingkai tebal.
 */
const PITA_CONTOH =
  '<div class="pita-contoh"><b>CONTOH BENTUK DOKUMEN</b><br>' +
  'Seluruh nama, angka, dan keterangan di halaman ini KARANGAN -- bukan pasien, bukan hasil pemeriksaan, ' +
  'dan bukan tagihan siapa pun. Dipakai karena belum ada satu pun kejadian jenis ini di Khanza.</div>';

export function renderDokumenHtml(isi: IsiDokumen, kop: KopSurat, opsi: OpsiDokumen): string {
  const judul = JUDUL_DOKUMEN[isi.jenis];
  const badan =
    isi.jenis === 'lab' ? badanLab(isi) : isi.jenis === 'radiologi' ? badanRadiologi(isi) : badanNota(isi);

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${lolos(judul)}</title>
<style>${GAYA_CETAK}${GAYA_DOKUMEN}</style></head>
<body>
${kopHtml(kop)}

<h1>${lolos(judul)}</h1>
<div style="height:10px"></div>
${opsi.contoh ? PITA_CONTOH : ''}

${badan}

${ttdHtml({
    kotaRs: kop.kotaRs,
    tanggal: isi.kepala.tanggalDokumen,
    label: isi.kepala.labelTandaTangan,
    nama: isi.kepala.namaDokter,
    qrDataUri: opsi.qrDataUri,
  })}

${catatanHtml(opsi.catatanKaki)}
</body></html>`;
}

/** Tabel identitas + baris keterangan tambahan yang berbeda per dokumen. */
function kepalaHtml(isi: IsiDokumen, tambahan: Array<{ label: string; nilai: string }>): string {
  const baris = [...isi.kepala.identitas, ...tambahan.filter((t) => t.nilai !== '')];
  return `<table class="identitas">${barisIdentitasHtml(baris)}</table>`;
}

// ---------------------------------------------------------------------------
// HASIL LABORATORIUM
// ---------------------------------------------------------------------------

/**
 * Kolomnya MENGIKUTI `rptPeriksaLab.jasper` persis: Pemeriksaan, Hasil, Satuan,
 * Nilai Rujukan, Keterangan.
 *
 * Bukan selera. Pasien yang menerima berkas ini lewat WhatsApp lalu membawanya
 * ke kontrol akan menaruhnya bersebelahan dengan lembar yang dicetak di loket,
 * dan dokter membaca keduanya. Susunan kolom yang berbeda memaksa pembacanya
 * mencocokkan ulang tiap baris -- dan salah baca pada tabel hasil laboratorium
 * bukan kesalahan kosmetik.
 *
 * Parameter yang hasilnya belum keluar TETAP ditampilkan, dengan tanda pisah di
 * kolom hasilnya. Menghilangkannya membuat panel yang belum selesai terlihat
 * persis seperti panel yang sudah lengkap.
 */
function badanLab(isi: IsiDokumenLab): string {
  const kepala = kepalaHtml(isi, [
    { label: 'Tanggal Periksa', nilai: isi.kepala.tanggalDokumen },
    { label: 'Petugas Laboratorium', nilai: isi.namaPetugas },
  ]);

  if (isi.kelompok.length === 0) {
    return `${kepala}<p class="kosong">Tidak ada parameter pemeriksaan yang tercatat untuk tanggal ini.</p>`;
  }

  const tabel = isi.kelompok
    .map(
      (k) => `<div class="blok-panel">
${k.panel ? `<h2>${lolos(k.panel)}</h2>` : ''}
<table class="data">
<thead><tr><th style="width:38%">Pemeriksaan</th><th style="width:15%">Hasil</th><th style="width:12%">Satuan</th><th style="width:18%">Nilai Rujukan</th><th style="width:17%">Keterangan</th></tr></thead>
<tbody>${k.baris
        .map(
          (b) =>
            `<tr><td>${lolos(b.pemeriksaan)}</td><td class="num">${
              b.hasil ? `<b>${lolos(b.hasil)}</b>` : '&ndash;'
            }</td><td class="mid">${lolos(b.satuan)}</td><td class="mid">${lolos(b.rujukan)}</td><td>${lolos(
              b.keterangan,
            )}</td></tr>`,
        )
        .join('')}</tbody>
</table>
</div>`,
    )
    .join('\n');

  return `${kepala}${tabel}
<div class="peringatan">${lolos(PERINGATAN_HASIL)}</div>`;
}

// ---------------------------------------------------------------------------
// HASIL RADIOLOGI
// ---------------------------------------------------------------------------

function badanRadiologi(isi: IsiDokumenRadiologi): string {
  const kepala = kepalaHtml(isi, [{ label: 'Tanggal Periksa', nilai: isi.kepala.tanggalDokumen }]);

  const daftar =
    isi.pemeriksaan.length > 0
      ? `<p class="pembuka">Pemeriksaan yang dilakukan:</p>
<ul class="daftar-periksa">${isi.pemeriksaan.map((n) => `<li>${lolos(n)}</li>`).join('')}</ul>`
      : '';

  /**
   * `pre-wrap` pada narasinya, dan itu bukan kemalasan tata letak.
   *
   * Bacaan radiologi diketik dokter dengan baris dan jeda yang dipilihnya
   * sendiri -- daftar temuan, lalu kesan. Merapikannya jadi paragraf mengalir
   * membuang struktur yang sengaja dibuat penulisnya, dan pada dokumen medis
   * struktur itu bagian dari artinya.
   */
  const bacaan =
    isi.bacaan.length > 0
      ? isi.bacaan
          .map(
            (b) =>
              `<div class="bacaan">${
                isi.bacaan.length > 1 ? `<span class="jam">Pukul ${lolos(b.jam)}</span>` : ''
              }${lolos(b.teks)}</div>`,
          )
          .join('\n')
      : '<p class="kosong">Bacaan belum tersedia untuk tanggal ini.</p>';

  return `${kepala}${daftar}
<p class="pembuka"><b>Hasil bacaan:</b></p>
${bacaan}
<div class="peringatan">${lolos(PERINGATAN_HASIL)}</div>`;
}

// ---------------------------------------------------------------------------
// NOTA / TAGIHAN
// ---------------------------------------------------------------------------

/**
 * Kalimat yang WAJIB menemani nota, karena berkas ini memang berbeda dari
 * lembar yang dicetak di loket.
 *
 * Nota tanpa harga per item, berikut satu angka TOTAL di kakinya, terbaca
 * sebagai nota yang rusak atau dipotong bila tidak ada yang menjelaskannya --
 * dan pasien yang mencoba menjumlahkan sendiri lalu tidak bisa akan menelepon.
 * Alasan yang sama persis dengan `CATATAN_OBAT_DIRINGKAS` di bawahnya: yang
 * sengaja tidak dicantumkan harus DIKATAKAN, bukan dihilangkan diam-diam.
 */
const CATATAN_TANPA_HARGA_ITEM =
  'Harga per item sengaja tidak dicantumkan pada berkas ini. Yang tercantum adalah subtotal tiap kelompok ' +
  'dan total tagihan, dan keduanya sudah menghitung seluruh item di atasnya. ' +
  'Rincian harga per item dapat diminta di loket rumah sakit.';

const CATATAN_OBAT_DIRINGKAS =
  'Rincian nama obat sengaja tidak dicantumkan pada berkas ini. Totalnya tetap terhitung penuh; ' +
  'rincian lengkapnya dapat diminta di loket rumah sakit.';

function badanNota(isi: IsiDokumenNota): string {
  const kepala = kepalaHtml(isi, [
    { label: 'No. Nota', nilai: isi.noNota },
    { label: 'Tanggal', nilai: isi.kepala.tanggalDokumen },
    { label: 'Unit/Poliklinik', nilai: isi.namaPoli },
    { label: 'Cara Bayar', nilai: isi.caraBayar },
  ]);

  if (isi.baris.length === 0) {
    return `${kepala}<p class="kosong">Rincian tagihan belum tercatat untuk kunjungan ini.</p>`;
  }

  /**
   * TIGA kolom, dan kolom rupiahnya KOSONG pada baris item.
   *
   * Baris item menyebut apa yang diberikan berikut banyaknya; yang membawa
   * angka hanya baris kelompok, subtotal, dan total (lihat `BarisNotaDokumen`).
   * Kolom rupiahnya tetap ada dan tetap di ujung kanan justru karena itu:
   * subtotal dan total yang tercetak sejajar bisa dijumlahkan dengan mata,
   * sementara angka yang mengambang di kolom lain memaksa pembacanya mencari --
   * dan yang dicari pada sebuah tagihan adalah persis angka yang harus
   * dipercaya.
   */
  const baris = isi.baris
    .map((b) => {
      if (b.jenis === 'item') {
        return `<tr><td class="indent">${lolos(b.label)}</td><td class="mid">${lolos(
          b.jumlah,
        )}</td><td class="num"></td></tr>`;
      }
      const kelas =
        b.jenis === 'seksi' ? ' class="judul"' : b.jenis === 'keterangan' ? '' : ' class="tegas"';
      const sel = b.jenis === 'keterangan' ? ' class="indent"' : '';
      return `<tr${kelas}><td colspan="2"${sel}>${lolos(b.label)}</td><td class="num">${lolos(
        b.total,
      )}</td></tr>`;
    })
    .join('');

  const pembayaran =
    isi.pembayaran.length > 0
      ? `<p class="pembuka"><b>Pembayaran:</b></p>
<table class="data"><tbody>${isi.pembayaran
          .map((p) => `<tr><td>${lolos(p.label)}</td><td class="num">${lolos(p.nilai)}</td></tr>`)
          .join('')}</tbody></table>`
      : '';

  return `${kepala}
<table class="data">
<thead><tr><th style="width:66%">Layanan / Obat</th><th style="width:12%">Jml</th><th style="width:22%">Jumlah</th></tr></thead>
<tbody>${baris}</tbody>
</table>
${pembayaran}
<div class="peringatan">${lolos(CATATAN_TANPA_HARGA_ITEM)}</div>
${isi.obatDiringkas ? `<div class="peringatan">${lolos(CATATAN_OBAT_DIRINGKAS)}</div>` : ''}`;
}
