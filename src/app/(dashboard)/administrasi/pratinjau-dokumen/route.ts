import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/authz';
import {
  contohPermintaanDokumen,
  contohDokumenKarangan,
  muatDokumen,
  dokumenKeHtml,
  dokumenKeBerkas,
} from '@/lib/dokumen';
import { namaBerkasDokumen, type JenisDokumen } from '@/core/dokumenDoc';
import { lolos } from '@/core/cetakHtml';
import { logger } from '@/lib/logger';

/**
 * Pratinjau dokumen hasil lab / radiologi / nota (migrations/038) -- DUA bentuk
 * dari satu sumber: `?format=html` (bawaan, dipakai modal di layar) dan PDF
 * (berkas sungguhan, dibuka di tab baru).
 *
 * ==========================================================================
 * Yang dipratinjau adalah KEJADIAN TERBARU, bukan pasien yang dipilih staf
 * ==========================================================================
 *
 * Berbeda dari `/administrasi/pratinjau` yang menerima `kunci` dari baris tabel
 * yang diklik staf. Di sini tidak ada tabelnya, dan itu disengaja: tab ini
 * bukan tempat MENGIRIM satu dokumen ke satu pasien, melainkan tempat
 * memutuskan apakah jenis dokumen ini boleh ikut terkirim SAMA SEKALI.
 * Pertanyaan yang perlu dijawab karenanya "seperti apa bentuknya", bukan
 * "seperti apa punya si A" -- dan kejadian terbaru menjawabnya dengan satu
 * klik, tanpa satu pun parameter yang perlu divalidasi.
 *
 * Konsekuensinya yang harus disadari: ISINYA DATA PASIEN SUNGGUHAN. Itu bukan
 * kelalaian melainkan syaratnya -- dokumen contoh berisi angka karangan tidak
 * membuktikan apa pun tentang bentuk data Khanza yang sesungguhnya, dan justru
 * bentuk data itulah yang berkali-kali jadi sumber kejutan di proyek ini.
 * Header `no-store` dan CSP `sandbox` di bawah ada karena itu.
 *
 * Memakai `muatDokumen()` -> `dokumenKeHtml()` yang SAMA PERSIS dengan yang
 * dipakai worker saat melampirkannya. Pratinjau yang berbeda dari yang terkirim
 * lebih buruk daripada tanpa pratinjau.
 *
 * DUA lapis izin: `proxy.ts` menjaga halamannya, dan `requireRole('admin')` di
 * sini menjaga bila ada yang membuka lintasannya langsung. Route handler tidak
 * punya `page.tsx`, jadi pemeriksaan peran di halaman tidak berlaku baginya --
 * pelajaran yang sudah dibayar di route pratinjau surat.
 */

const JANGAN_SIMPAN = 'no-store, private';

/**
 * Sama persis dengan CSP pratinjau surat, dan memang harus sama: keduanya
 * menyerahkan HTML hasil `core/cetakHtml.ts` ke peramban petugas. `sandbox`
 * menaruhnya di asal-usul tersendiri tanpa skrip; `style-src 'unsafe-inline'`
 * wajib karena seluruh gayanya satu blok <style>; `img-src data:` -- `data:`
 * SAJA -- karena logo dan QR memang tertanam, dan alamat jarak jauh akan
 * mengubah dokumen pasien jadi alat yang memberi tahu pihak luar kapan ia
 * dibuka.
 */
const CSP_DOKUMEN = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const JENIS_SAH: JenisDokumen[] = ['lab', 'radiologi', 'nota'];

/** Galat dijawab HTML, bukan JSON -- route ini selalu dibuka peramban. */
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
      'content-security-policy': CSP_DOKUMEN,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const { response: tolak } = await requireRole('admin');
  if (tolak) return tolak;

  const url = new URL(request.url);
  const jenis = url.searchParams.get('jenis') as JenisDokumen | null;
  // `?format=pdf` = berkas sungguhan; absen = HTML untuk kotak pratinjau.
  const sebagaiPdf = url.searchParams.get('format') === 'pdf';

  if (!jenis || !JENIS_SAH.includes(jenis)) return galat(400, 'Jenis dokumen tidak dikenali.');

  try {
    /**
     * Belum pernah ada kejadian jenis ini -> dokumen KARANGAN, bukan halaman
     * galat.
     *
     * Keadaannya nyata di instalasi ini (radiologi: nol baris), dan jawaban
     * lamanya membuat sakelar yang mengirim berkas ke pasien harus diputuskan
     * tanpa seorang pun pernah melihat bentuk berkasnya. Yang tidak boleh
     * hilang justru pembedaannya: halaman contoh MENGATAKAN dirinya contoh
     * (`contoh: true` -> pita di atas badan), jadi "belum pernah ada" tetap
     * terbaca berbeda dari "ini punya pasien sungguhan".
     *
     * Yang TETAP dijawab galat adalah kunjungan yang tidak ketemu di bawah:
     * itu bukan "belum ada data" melainkan tanda ada yang rusak, dan
     * menggantinya dengan contoh karangan akan menguburnya.
     */
    const permintaan = await contohPermintaanDokumen(jenis);
    const karangan = permintaan === null;

    const isi = karangan ? await contohDokumenKarangan(jenis) : await muatDokumen(permintaan);
    if (!isi) return galat(404, 'Kunjungan untuk contoh ini tidak ditemukan di Khanza.');

    if (!sebagaiPdf) {
      const html = await dokumenKeHtml(isi, { contoh: karangan });
      return new NextResponse(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': JANGAN_SIMPAN,
          'content-security-policy': CSP_DOKUMEN,
          'x-content-type-options': 'nosniff',
        },
      });
    }

    // Berkasnya dirakit `dokumenKeBerkas()` yang SAMA dipakai worker -- yang
    // dilihat staf memang berkas yang akan diterima pasien.
    const hasil = await dokumenKeBerkas(isi, { contoh: karangan });
    const nama = namaBerkasDokumen(jenis, isi.kepala.tanggalRingkas.split('-').reverse().join('-'));

    return new NextResponse(new Uint8Array(hasil.isi), {
      headers: {
        'content-type': hasil.mime,
        // `inline`, bukan `attachment` -- walau peramban boleh mengabaikannya,
        // permintaan kita tetap "tampilkan", bukan "simpan".
        'content-disposition': `inline; filename="${nama}"`,
        'cache-control': JANGAN_SIMPAN,
      },
    });
  } catch (err) {
    logger.error({ err, jenis, sebagaiPdf }, 'pratinjau dokumen hasil gagal dirender');
    return galat(500, 'Gagal membuat pratinjau dokumen. Rincian galatnya ada di log server.');
  }
}
