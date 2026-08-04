/**
 * Alamat WhatsApp (`<user>@<server>`) dan cara membacanya dengan benar.
 *
 * Sampai suatu titik, alamat pengirim selalu `<nomor>@c.us` -- nomor teleponnya
 * ADA di dalam alamat, jadi `from.replace('@c.us','')` sudah cukup. WhatsApp
 * kemudian memindahkan percakapan ke pengalamatan **LID** (`<id>@lid`):
 * identitas stabil per pengguna yang SENGAJA tidak memuat nomor telepon.
 *
 * Dua akibatnya, dan keduanya pernah terjadi di sini:
 *
 * 1. Penyaring `endsWith('@c.us')` diam-diam membuang setiap pesan masuk dari
 *    nomor yang sudah dipindahkan. Gejalanya paling menyesatkan yang mungkin:
 *    worker online, sesi `ready`, kirim keluar normal, tapi balasan otomatis
 *    "tidak jalan" tanpa satu baris log pun -- karena pesannya dibuang sebelum
 *    sempat dicatat.
 * 2. Bagian `user` dari sebuah LID BUKAN nomor telepon, padahal bentuknya
 *    persis seperti nomor: `280925422235727` itu 15 digit, lolos pemeriksaan
 *    "8-15 digit" apa pun. Karena itu nomor telepon HANYA boleh diambil
 *    berdasarkan SERVER-nya (`c.us`), tidak pernah berdasarkan bentuk angkanya.
 *    Salah di titik ini berarti mengirim balasan ke nomor asing, mencatat
 *    daftar tolak atas nomor yang salah, dan menghitung kuota nomor yang salah.
 */

export interface WaAddress {
  user: string;
  server: string;
}

export function parseWaAddress(id: string | null | undefined): WaAddress | null {
  if (!id) return null;
  const at = id.lastIndexOf('@');
  if (at <= 0 || at === id.length - 1) return null;
  return { user: id.slice(0, at), server: id.slice(at + 1) };
}

/**
 * Server yang berarti "obrolan dengan satu orang".
 *
 * Ditulis sebagai daftar-IZIN, bukan daftar-TOLAK grup. Server baru yang belum
 * dikenal (WhatsApp menambahkannya sesekali: `newsletter`, `broadcast`, ...)
 * lebih baik ditolak sampai ada yang memutuskan sadar-sadar, daripada otomatis
 * diperlakukan sebagai pasien perorangan dan dibalas.
 */
const SERVER_PERORANGAN = new Set(['c.us', 'lid']);

export function isIndividualAddress(id: string | null | undefined): boolean {
  const addr = parseWaAddress(id);
  return addr !== null && SERVER_PERORANGAN.has(addr.server);
}

/**
 * Alamat bukan-perorangan yang memang WAJAR terus berdatangan: grup, status
 * (`@broadcast`), dan saluran. Nomor WhatsApp rumah sakit menerima status dari
 * SETIAP kontaknya, jadi ini lalu lintas latar yang normal, bukan kesalahan.
 *
 * Dipisahkan dari "tidak dikenal" semata-mata untuk menentukan level log, dan
 * itu bukan kerapian: mencatat semuanya sebagai peringatan berarti peringatan
 * berhenti berarti apa-apa dalam sehari. Sebaliknya, alamat dengan server yang
 * BELUM pernah dilihat justru harus berisik -- bug LID bermula persis dari
 * jenis alamat baru yang tak terduga, dan diam adalah cara paling mahal untuk
 * mengetahuinya (butuh berjam-jam dan tiga pesan pasien yang hilang).
 */
const SERVER_RUTIN_BUKAN_PERORANGAN = new Set(['g.us', 'broadcast', 'newsletter']);

export function isKnownNonIndividualAddress(id: string | null | undefined): boolean {
  const addr = parseWaAddress(id);
  return addr !== null && SERVER_RUTIN_BUKAN_PERORANGAN.has(addr.server);
}

/**
 * Grup, dan HANYA grup -- bukan "bukan perorangan".
 *
 * Dibedakan dari `isKnownNonIndividualAddress()` di atas, yang juga memuat
 * status (`@broadcast`) dan saluran: keduanya datang terus-menerus dari setiap
 * kontak dan tidak boleh ikut tercatat sebagai pesan masuk, sementara pesan
 * grup justru harus.
 */
export function isGroupAddress(id: string | null | undefined): boolean {
  return parseWaAddress(id)?.server === 'g.us';
}

/** Alamat yang nomor teleponnya sudah pasti tidak ada di dalamnya. */
export function isLidAddress(id: string | null | undefined): boolean {
  return parseWaAddress(id)?.server === 'lid';
}

const NOMOR = /^[1-9]\d{7,14}$/;

export function isPhoneLike(value: string | null | undefined): boolean {
  return !!value && NOMOR.test(value);
}

/**
 * Nomor E.164 (tanpa `+`) yang terkandung DI DALAM alamat, atau null.
 *
 * Sengaja mengembalikan null untuk `@lid` alih-alih menebak: nomornya memang
 * tidak ada di sana dan harus ditanyakan ke WhatsApp lewat kontaknya.
 */
export function phoneFromAddress(id: string | null | undefined): string | null {
  const addr = parseWaAddress(id);
  if (!addr || addr.server !== 'c.us') return null;
  return isPhoneLike(addr.user) ? addr.user : null;
}

/** Bentuk minimal pesan masuk yang dibutuhkan untuk menurunkan kuncinya. */
export interface PesanMasukBerkunci {
  id?: { _serialized?: string } | undefined;
  from: string;
  timestamp?: number | undefined;
}

/**
 * Kunci stabil untuk satu pesan masuk -- dipakai sebagai kunci idempoten dan
 * sebagai penanda penyerahan ulang.
 *
 * **`id._serialized` TIDAK selalu ada, dan itu bukan kelainan.** Di
 * whatsapp-web.js, `Message.id` diisi apa adanya dari objek `MsgKey` milik
 * WhatsApp Web (`this.id = data.id`), sementara `_serialized` di sana adalah
 * getter pada PROTOTYPE. Objeknya menyeberang dari Chromium ke Node lewat
 * serialisasi puppeteer, dan getter prototipe tidak ikut menyeberang -- jadi
 * ada-tidaknya bergantung pada jalur mana yang kebetulan dipakai untuk pesan
 * itu. Terbukti hilang pada pesan GRUP di mesin ini.
 *
 * Cadangannya `from:timestamp`, sama seperti yang sudah dipakai pencatatan
 * pesan masuk dan balasan otomatis sejak awal. Ia stabil untuk keperluan yang
 * sebenarnya -- pesan yang SAMA diserahkan ulang menghasilkan kunci yang sama
 * -- dan tabrakannya (dua pesan berbeda dari obrolan yang sama pada detik yang
 * sama) gagal ke arah yang aman: satu pesan tidak dijawab, bukan satu pesan
 * dijawab dua kali.
 *
 * Fungsi ini ada supaya ketiga pemanggilnya tidak bisa lagi berbeda tafsir.
 * Sebelumnya jalur grup adalah satu-satunya yang memperlakukan id hilang
 * sebagai fatal lalu diam, sementara dua jalur lain memakai cadangan --
 * bentuk kegagalan yang sama persis dengan yang sudah dibayar di
 * `respectsOptOut()` dan `core/outboxStatus.ts`.
 */
export function kunciPesanMasuk(pesan: PesanMasukBerkunci): string {
  return pesan.id?._serialized ?? `${pesan.from}:${pesan.timestamp ?? 0}`;
}
