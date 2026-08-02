import { createHash } from 'node:crypto';

/**
 * Kode unik per pesan — pengaman tambahan untuk PRD F5.2 (melindungi nomor RS
 * dari deteksi spam WhatsApp), melengkapi jeda acak 3–8 detik dan kuota per
 * jam yang sudah ada di dispatcher.
 *
 * Masalah yang diselesaikan: WhatsApp menandai pengiriman massal berisi teks
 * yang IDENTIK sebagai pola spam. Tujuh pemicu wakhanza memakai template
 * tetap, jadi puluhan pesan QUEUE_REG dalam satu pagi hanya berbeda di
 * nama/nomor antrian — dan BROADCAST bisa benar-benar identik karakter per
 * karakter untuk ratusan pasien sekaligus bila stafnya tidak memakai
 * {nama_pasien}. Satu baris pendek di akhir membuat setiap pesan berbeda tanpa
 * mengubah isi yang dibaca pasien.
 *
 * Kode DITURUNKAN dari idempotency_key, sengaja bukan acak:
 * - Satu pesan = satu kode selamanya. Dispatcher mencoba ulang sampai
 *   beberapa kali (retry.ts); kode acak akan membuat percobaan kedua tampak
 *   sebagai pesan BARU bagi pasien maupun bagi WhatsApp — persis kebalikan
 *   dari yang diinginkan.
 * - Disisipkan saat ENQUEUE, bukan saat SEND, sehingga `outbox.body` tetap
 *   persis sama dengan yang dikirim. Halaman Log dan jejak audit menampilkan
 *   teks sungguhan, dan kode yang disebut pasien lewat telepon bisa dicari
 *   langsung (`outbox.body LIKE '%KODE%'`) tanpa kolom tambahan.
 */

/**
 * Crockford Base32: TEPAT 32 karakter (jadi `byte % 32` seragam, tanpa bias
 * modulo) dan sudah membuang I, L, O, U — pasien yang membacakan kodenya lewat
 * telepon tidak bisa tertukar antara 0/O maupun 1/I/L, dan tidak ada kombinasi
 * huruf yang tak sengaja membentuk kata kasar.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 32^6 ≈ 1,07 miliar kemungkinan — jauh melebihi kebutuhan, tetap pendek dibaca. */
export const UNIQUE_CODE_LENGTH = 6;

/**
 * Waktu ikut ditampilkan karena "Ref: 5QVC9G" tidak berarti apa-apa bagi
 * pasien yang menerimanya -- sedangkan tanggal dan jam langsung menjawab
 * "pesan ini soal kapan". Kodenya TETAP ada di belakangnya, dan itu bukan
 * hiasan: lihat catatan pada `formatWaktuKirim` di bawah.
 */
export const DEFAULT_UNIQUE_CODE_TEMPLATE = 'Kode Pengiriman : {waktu} {kode}';

/**
 * `YYYY-MM-DD HH:mm:ss` waktu lokal (server RS berzona WIB, asumsi yang sama
 * dipakai quietHours.ts dan core/schedule.ts).
 *
 * PENTING -- kenapa stempel waktu saja TIDAK cukup untuk membuat pesan unik:
 * satu broadcast meng-enqueue seluruh penerimanya dalam satu perulangan rapat,
 * jadi ratusan pesan mendapat detik yang SAMA. Digabung dengan isi broadcast
 * yang memang identik, seluruh kiriman jadi identik karakter per karakter --
 * persis pola yang membuat WhatsApp menandai nomor RS sebagai spam, yaitu
 * satu-satunya alasan berkas ini ada. Karena itu `{kode}` tetap menyertainya.
 */
export function formatWaktuKirim(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export function messageUniqueCode(seed: string, length = UNIQUE_CODE_LENGTH): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  // Dibatasi panjang digest: mengulang byte yang sama secara siklis akan
  // menghasilkan pola berulang yang justru terlihat seperti sampah otomatis.
  const size = Math.max(1, Math.min(length, digest.length));

  let out = '';
  for (let i = 0; i < size; i++) {
    out += ALPHABET[digest[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * `template` berasal dari app_setting (dikendalikan admin), BUKAN dari data
 * pasien — jadi aman disubstitusi terpisah dari renderTemplate. Justru harus
 * terpisah: menggabungkan footer ke body lalu menjalankan renderTemplate
 * sekali lagi akan melanggar aturan satu-lintasan (ARCHITECTURE §9.2), karena
 * nama pasien yang sudah tersubstitusi akan dipindai ulang untuk pola {...}.
 *
 * @returns null bila template kosong (fitur dimatikan lewat pengaturan).
 */
export function buildUniqueCodeFooter(seed: string, template: string, waktu: Date): string | null {
  const tpl = template.trim();
  if (!tpl) return null;

  const code = messageUniqueCode(seed);
  const withWaktu = tpl.replace(/\{waktu\}/g, formatWaktuKirim(waktu));
  // Admin yang tidak sengaja menghapus {kode} dari templatenya akan membuat
  // SELURUH pesan dalam satu broadcast berakhiran teks yang sama persis --
  // seluruh tujuan fitur ini hilang tanpa satu pun pesan error. Kodenya tetap
  // ditempelkan di akhir. {waktu} SENGAJA tidak diperlakukan begitu: ia tidak
  // menjamin apa pun, jadi menempelkannya paksa hanya menambah teks.
  return withWaktu.includes('{kode}') ? withWaktu.replace(/\{kode\}/g, code) : `${withWaktu} ${code}`;
}

export function appendUniqueCode(body: string, seed: string, template: string, waktu: Date): string {
  const footer = buildUniqueCodeFooter(seed, template, waktu);
  return footer ? `${body}\n\n${footer}` : body;
}
