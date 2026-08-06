import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/authz';
import { muatSurat, suratKeHtml } from '@/lib/surat';
import { htmlKePdf } from '@/lib/pdf';
import { namaBerkasSurat } from '@/core/suratDoc';
import { lolos } from '@/core/suratHtml';
import { logger } from '@/lib/logger';

/**
 * Pratinjau surat -- DUA bentuk dari satu sumber: `?format=html` (bawaan,
 * dipakai modal di layar) dan PDF (berkas sungguhan, dibuka di tab baru).
 *
 * ==========================================================================
 * KENAPA pratinjau ini WAJIB ada, bukan kemudahan
 * ==========================================================================
 *
 * Sepuluh pemicu lain mengirim TEKS, dan teksnya bisa dilihat utuh di kotak
 * template sebelum menyala. Yang ini mengirim BERKAS: tanpa cara membukanya,
 * satu-satunya jalan mengetahui isinya adalah mengirimkannya ke pasien
 * sungguhan lebih dulu. Pelajaran yang sama sudah dibayar pada tombol "Kirim
 * uji" farmasi -- kode grup yang salah tetap berstatus `sent`, jadi harus ada
 * manusia yang melihat hasilnya.
 *
 * Memakai rantai fungsi yang SAMA PERSIS dengan `kirimSuratAction` (`ambil*` ->
 * `susun*` -> `suratKeHtml` [-> `htmlKePdf`]). Pratinjau yang berbeda dari yang
 * terkirim lebih buruk daripada tanpa pratinjau, dan di sini yang berbeda
 * bukan tampilan melainkan isi surat resmi.
 *
 * ==========================================================================
 * KENAPA bentuk HTML ada, dan kenapa ia yang jadi BAWAAN
 * ==========================================================================
 *
 * Versi pertama hanya melayani PDF ber-`Content-Disposition: inline`, dengan
 * anggapan peramban akan menampilkannya. Ternyata itu **bukan keputusan
 * server**: Chrome punya setelan "Download PDF files instead of automatically
 * opening them" (`plugins.always_open_pdf_externally`), dan begitu ia menyala
 * -- di komputer loket mana pun, tanpa terlihat dari sini -- tombol "Lihat"
 * berubah jadi mengunduh berkas. Persis kebalikan dari tujuannya: staf yang
 * ingin MEMERIKSA malah menimbun surat berisi nama dan alamat pasien di folder
 * Unduhan komputer bersama.
 *
 * Tidak ada header yang bisa memaksa peramban merender PDF. Karena itu bentuk
 * yang dipakai pratinjau di layar adalah HTML-nya -- yang dirender peramban
 * mana pun tanpa syarat, dan yang justru SATU LANGKAH LEBIH DEKAT ke sumber:
 * ia bukan penurunan kedua di samping PDF, melainkan bahan yang dipakai
 * `htmlKePdf()` untuk membuat PDF-nya. Sekalian menghemat satu peluncuran
 * Chromium (~480 ms) tiap kali staf menekan Lihat, berikut risiko Chromium
 * yatim yang menyertainya (`lib/pdf.ts`).
 *
 * PDF tetap dilayani dan tetap `inline`: yang perlu dibuktikan kadang justru
 * berkas yang akan diterima pasien, termasuk pemenggalan halamannya.
 *
 * DUA lapis izin, sama seperti route lain: `proxy.ts` menjaga halamannya, dan
 * `requireRole('admin')` di sini menjaga bila ada yang membuka lintasannya
 * langsung.
 */

/**
 * Isinya memuat nama dan alamat pasien -- tidak boleh menetap di cache
 * peramban komputer loket yang dipakai bergantian banyak petugas.
 */
const JANGAN_SIMPAN = 'no-store, private';

/**
 * Pelolosan di `core/suratHtml.ts` sudah menutup penyuntikan pada SUMBERNYA --
 * setiap nilai lewat `lolos()`, dan itu yang harus tetap benar. CSP di sini
 * lapis kedua, dipasang justru karena route inilah yang pertama kali
 * menyerahkan HTML surat ke peramban petugas alih-alih ke Chromium: `sandbox`
 * menaruhnya di asal-usul tersendiri tanpa skrip, jadi satu kelalaian
 * pelolosan di masa depan tidak bisa menyentuh sesi dashboard.
 *
 * `style-src 'unsafe-inline'` wajib -- seluruh gaya surat memang satu blok
 * <style> di dalam berkasnya.
 *
 * `img-src data:` ada sejak surat memuat logo rumah sakit dan QR pengesahan.
 * Sengaja `data:` SAJA, bukan `'self'` apalagi `*`: kedua gambar itu memang
 * tertanam di dalam HTML-nya, jadi izin ini tidak membuka satu pun jalan
 * keluar. Membolehkan alamat jarak jauh akan mengubah surat jadi alat yang bisa
 * memberi tahu pihak luar kapan dan dari mana sebuah surat pasien dibuka --
 * dan `lib/pdf.ts` berdiri di atas janji bahwa render surat tidak pernah
 * menyentuh jaringan. Sisanya (skrip, font, bingkai) tetap ditutup
 * `default-src 'none'`.
 */
const CSP_SURAT = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * Galat pun dijawab HTML, bukan JSON.
 *
 * Route ini tidak pernah dipanggil dari JavaScript -- ia selalu dibuka
 * peramban, entah sebagai `src` sebuah `<iframe>` atau sebagai tab baru. JSON
 * di kedua tempat itu muncul sebagai `{"error":"..."}` mentah di tengah kotak
 * pratinjau, yang bagi petugas terbaca sebagai halaman rusak alih-alih sebagai
 * keterangan bahwa datanya memang tidak ada.
 */
function galat(status: number, pesan: string): Response {
  const badan = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Pratinjau gagal</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;color:#334;
padding:32px;line-height:1.6;text-align:center}
</style></head><body><p>${lolos(pesan)}</p></body></html>`;
  return new NextResponse(badan, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': JANGAN_SIMPAN,
      'content-security-policy': CSP_SURAT,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  /**
   * `requireRole()` MENGEMBALIKAN respons 403, ia tidak melemparnya.
   *
   * Membuang nilai kembaliannya (`await requireRole('admin')` begitu saja)
   * membuat pemeriksaannya tidak menolak apa pun -- dan itu benar-benar terjadi
   * pada versi pertama berkas ini: operator menerima HTTP 200 berikut PDF berisi
   * nama, umur, dan alamat pasien. `proxy.ts` tidak menangkapnya karena ia hanya
   * memeriksa bahwa seseorang SUDAH LOGIN; perannya diperiksa di `page.tsx`,
   * dan route handler tidak punya page.tsx.
   *
   * Inilah alasan aturan dua lapis di CLAUDE.md ditulis: setiap route WAJIB
   * mengembalikan sendiri 401/403-nya.
   */
  const { response: tolak } = await requireRole('admin');
  if (tolak) return tolak;

  const url = new URL(request.url);
  const jenis = url.searchParams.get('jenis');
  const kunci = url.searchParams.get('kunci') ?? '';
  const sebagaiPdf = url.searchParams.get('format') === 'pdf';

  if ((jenis !== 'sakit' && jenis !== 'sehat') || !kunci) {
    return galat(400, 'Alamat pratinjau tidak lengkap.');
  }

  try {
    const surat = await muatSurat(jenis, kunci);
    if (!surat) {
      return galat(404, 'Data suratnya tidak ditemukan di Khanza.');
    }

    const { isi } = surat;
    const html = await suratKeHtml(isi);

    if (!sebagaiPdf) {
      return new NextResponse(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': JANGAN_SIMPAN,
          'content-security-policy': CSP_SURAT,
          'x-content-type-options': 'nosniff',
        },
      });
    }

    const pdf = await htmlKePdf(html);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        // `inline`, bukan `attachment` -- walau peramban boleh mengabaikannya
        // (lihat catatan di atas), permintaan kita tetap "tampilkan", bukan
        // "simpan".
        'content-disposition': `inline; filename="${namaBerkasSurat(jenis, isi.namaPasien)}"`,
        'cache-control': JANGAN_SIMPAN,
      },
    });
  } catch (err) {
    // Chromium gagal meluncur adalah kegagalan yang paling mungkin di jalur
    // PDF, dan halaman putih tanpa keterangan akan terbaca sebagai "suratnya
    // rusak".
    logger.error({ err, jenis, kunci, sebagaiPdf }, 'pratinjau surat gagal dirender');
    return galat(500, 'Gagal membuat pratinjau surat. Rincian galatnya ada di log server.');
  }
}
