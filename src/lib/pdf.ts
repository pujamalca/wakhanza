import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import { logger } from '@/lib/logger';

/**
 * HTML -> PDF lewat Chromium yang SUDAH ada.
 *
 * ==========================================================================
 * NOL paket baru, dan itu keputusan yang disengaja
 * ==========================================================================
 *
 * Puppeteer beserta Chromium-nya sudah menjadi dependensi lewat
 * whatsapp-web.js. Menambah `pdfkit`/`pdf-lib` berarti satu paket lagi yang
 * harus dirawat di server rumah sakit demi kemampuan yang sudah terpasang --
 * dan menyusun tata letak surat lewat perintah gambar tingkat rendah jauh
 * lebih rapuh daripada HTML+CSS yang bisa dilihat langsung.
 *
 * ==========================================================================
 * DUA hal yang WAJIB tetap begini, keduanya dibayar oleh insiden nyata
 * ==========================================================================
 *
 * 1. **`userDataDir` SENDIRI di direktori sementara, tidak pernah
 *    `.wwebjs_auth`.** Perebutan direktori sesi itulah yang pernah
 *    menjatuhkan worker ke crash loop 29 kali beruntun (CLAUDE.md
 *    §"Operasi produksi"), dan Chromium yatim yang masih memegangnya membuat
 *    tiap proses baru mati sebelum sempat apa pun. Proses ini tidak boleh
 *    punya satu pun jalan untuk menyentuhnya.
 *
 * 2. **Selalu ditutup di `finally`, dengan batas waktu.** Chromium yatim di
 *    server ini bukan kemungkinan teoretis -- 9 di antaranya pernah tertinggal
 *    sekaligus. Sebuah surat yang gagal dirender tidak boleh meninggalkan
 *    proses yang memakan memori sampai server dinyalakan ulang.
 *
 * TIDAK memakai `--no-sandbox` (ditolak eksplisit di TECH_STACK.md), dan TIDAK
 * menyimpan peramban hidup di antara permintaan: peluncurannya terukur ~480 ms,
 * sementara peramban yang menganggur berjam-jam adalah persis bentuk yang
 * berakhir jadi proses yatim.
 *
 * Dijalankan di proses WEB, bukan worker. Staf harus bisa MELIHAT suratnya
 * sebelum mengirim, dan pratinjau yang harus menunggu satu siklus worker bukan
 * pratinjau. Worker tetap tidak berubah: ia mengirim berkas dari `outbox`
 * seperti lampiran broadcast mana pun -- kontrak "kedua proses tidak pernah
 * berkomunikasi lewat HTTP" utuh.
 */

/** Anggaran keras. Surat satu halaman terukur ~700 ms; 30 detik berarti ada yang salah. */
const BATAS_RENDER_MS = 30_000;

export async function htmlKePdf(html: string): Promise<Buffer> {
  const mulai = Date.now();
  const dirSementara = await mkdtemp(path.join(tmpdir(), 'wakhanza-pdf-'));
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: dirSementara,
      // Sama seperti sesi WhatsApp: /dev/shm kecil membuat Chromium mati
      // mendadak di tengah render, dan gejalanya bukan galat yang jelas.
      args: ['--disable-dev-shm-usage'],
      timeout: BATAS_RENDER_MS,
    });

    const page = await browser.newPage();
    // `setContent` tidak pernah menyentuh jaringan: gaya ada sebagai satu blok
    // <style>, dan kedua gambarnya (logo rumah sakit + QR pengesahan) tertanam
    // sebagai data URI (core/suratHtml.ts). Tidak ada berkas eksternal yang
    // bisa membuat render menggantung menunggu sesuatu yang tidak akan datang.
    //
    // `waitUntil: 'load'` -- bukan 'domcontentloaded' -- justru karena gambar
    // itu: 'load' baru menyala setelah setiap <img> selesai didekode, sehingga
    // PDF tidak pernah tercetak dengan kop yang logonya belum muncul. Data URI
    // tidak menambah waktu tunggu yang berarti karena tidak ada permintaan
    // jaringan yang perlu diselesaikan.
    await page.setContent(html, { waitUntil: 'load', timeout: BATAS_RENDER_MS });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      // Margin nol: seluruh jarak tepi diatur CSS `@page` + padding body.
      // Margin milik Chromium akan menggambar header/footer bawaannya (URL
      // dan nomor halaman), yang tidak boleh muncul di surat resmi.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      timeout: BATAS_RENDER_MS,
    });

    const buffer = Buffer.from(pdf);
    logger.info({ bytes: buffer.byteLength, durasiMs: Date.now() - mulai }, 'surat dirender jadi PDF');
    return buffer;
  } finally {
    // `close()` sendiri bisa menggantung bila Chromium sudah tidak sehat --
    // pelajaran yang sama dengan `destroy()` pada sesi WhatsApp, yang karena
    // itu diberi batas waktunya sendiri di `shutdown()`.
    if (browser) {
      await Promise.race([
        browser.close(),
        new Promise((r) => setTimeout(r, 10_000)),
      ]).catch(() => {});
      // Kalau `close()` kehabisan waktu, prosesnya dimatikan paksa -- lebih
      // baik satu Chromium terbunuh kasar daripada satu Chromium abadi.
      browser.process()?.kill('SIGKILL');
    }
    await rm(dirSementara, { recursive: true, force: true }).catch(() => {});
  }
}
