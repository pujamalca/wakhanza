/**
 * Membedakan "halaman WhatsApp belum bisa dipakai" dari "pengiriman gagal".
 *
 * Keduanya sampai ke dispatcher sebagai exception yang sama bentuknya, tapi
 * artinya berlawanan -- dan salah menggolongkannya mahal: percobaan kirim
 * dibatasi TIGA (`core/retry.ts`), sesudahnya baris ditandai `failed_permanent`
 * dan baru bergerak lagi kalau ada manusia menekan "Kirim ulang". Menghitung
 * keadaan yang jelas-jelas sementara sebagai satu dari tiga kesempatan itu
 * berarti gangguan halaman beberapa detik bisa mematikan notifikasi pasien
 * secara permanen.
 *
 * ## Kenapa keadaan ini ADA
 *
 * whatsapp-web.js menaruh objek pembantunya, `window.WWebJS`, ke dalam halaman
 * lewat `Client.inject()`. Objek itu **dihapus setiap kali frame bernavigasi**
 * dan disuntikkan ulang secara ASINKRON:
 *
 * ```js
 * this.pupPage.on('framenavigated', async () => { ...; await this.inject(); });
 * ```
 *
 * Di sela itu `window.WWebJS` undefined, sementara `Client.sendMessage()`
 * memanggil `window.WWebJS.getChat(chatId, ...)` di dalam halaman -- sehingga
 * galatnya berbunyi persis `Cannot read properties of undefined (reading
 * 'getChat')`. Tidak ada event apa pun yang menandai sela ini.
 *
 * Ketiga sinyal kesiapan kita buta terhadapnya, dan itu bukan kelalaian
 * melainkan sifat masing-masing: `isWaReady()` membaca baris `wa_session` yang
 * ditulis saat event READY (historis, bukan keadaan sekarang), dan
 * `checkHealth()` memanggil `getState()` yang membaca
 * `window.require('WAWebSocketModel')` -- modul milik WhatsApp SENDIRI, yang
 * selamat dari navigasi. Jadi pemeriksaan kesehatan menjawab "sehat" tepat pada
 * saat pengiriman mustahil.
 *
 * ## Kenapa lewat TEKS galat
 *
 * Alasan yang sama dengan `galatBerkasTerkunci()` di `worker/wa-client.ts`:
 * galatnya lahir di dalam Chromium lalu diseberangkan puppeteer, jadi yang
 * sampai ke sini sudah luruh menjadi pesan. Tidak ada `err.code` yang bisa
 * diperiksa.
 */

/**
 * Penanda yang HANYA muncul saat halamannya belum bisa dipakai.
 *
 * Sengaja sempit. Daftar yang terlalu longgar justru membalik kerugiannya:
 * kegagalan kirim yang sungguhan akan dicoba ulang tanpa batas tanpa pernah
 * muncul di panel "perlu ditinjau", dan itu persis kelas kegagalan yang sudah
 * dibayar di `core/outboxStatus.ts` -- baris yang tidak dikerjakan siapa pun,
 * tidak ditampilkan di mana pun.
 */
const PENANDA_HALAMAN_BELUM_SIAP = [
  // window.WWebJS undefined -- objek suntikan belum kembali sesudah navigasi.
  "reading 'getChat'",
  'WWebJS is not defined',
  // Halaman bernavigasi tepat saat evaluate berjalan.
  'Execution context was destroyed',
  'Cannot find context with specified id',
  // Chromium sedang ditutup/dimulai ulang. Kalau ini menetap, watchdog sesi
  // yang menanganinya -- bukan penghitung percobaan milik satu baris pesan.
  'Target closed',
  'Session closed',
  'Protocol error',
] as const;

/**
 * True bila galatnya berarti "belum sempat mencoba", bukan "sudah dicoba dan
 * gagal".
 *
 * Pemanggilnya WAJIB memperlakukan ini sebagai bukan-percobaan: jangan naikkan
 * `attempts`, jangan tulis `send_log`. Barisnya tetap `pending` dan dicoba lagi
 * sebentar kemudian.
 *
 * Batas akhirnya tetap ada dan tidak perlu dibuat baru: pesan yang pemicunya
 * kelewat tua tetap dibatalkan `isStale()` (F5.3), dan halaman yang tidak
 * pernah pulih tetap dijaring pemeriksaan kesehatan. Jadi "tidak menghabiskan
 * percobaan" bukan berarti "berputar selamanya".
 */
export function galatHalamanBelumSiap(err: unknown): boolean {
  const teks = err instanceof Error ? err.message : String(err ?? '');
  if (!teks) return false;
  return PENANDA_HALAMAN_BELUM_SIAP.some((penanda) => teks.includes(penanda));
}
