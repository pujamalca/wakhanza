/**
 * F5.1: jam tenang default 21.00-07.00 WIB. Pesan di luar jam itu ditahan,
 * bukan dibuang.
 *
 * Rekonsiliasi ARCHITECTURE §6.1 vs §6.2: §6.1 menuliskan pengecekan jam
 * tenang sebagai jeda global di siklus dispatcher ("bila di luar jam tenang
 * -> tunggu"), tapi §6.2 mengecualikan BOOK_CANCEL dari penahanan itu. Jeda
 * global tanpa syarat akan ikut menahan BOOK_CANCEL, bertentangan dengan
 * pengecualiannya sendiri. Diselesaikan di sini dengan menghitung
 * `scheduled_at` saat ENQUEUE (bukan jeda terpisah di siklus dispatcher):
 * pemicu selain BOOK_CANCEL yang jatuh di jam tenang dimajukan ke jendela
 * berikutnya; BOOK_CANCEL selalu memakai event_at apa adanya. Dispatcher
 * cukup memfilter `scheduled_at <= NOW()` seperti biasa — tidak perlu jeda
 * global terpisah yang bisa mengecualikan-dari-pengecualian.
 */
export function isQuietHours(date: Date, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const h = date.getHours();
  if (startHour < endHour) {
    return h >= startHour && h < endHour;
  }
  // Jam tenang melewati tengah malam, mis. 21..7.
  return h >= startHour || h < endHour;
}

/** Waktu jam tenang berikutnya BERAKHIR (jendela kirim dibuka lagi). */
export function nextWindowStart(date: Date, endHour: number): Date {
  const next = new Date(date);
  next.setHours(endHour, 0, 0, 0);
  if (next <= date) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Pemicu yang jam tenangnya dilewati, dan alasannya berbeda satu sama lain:
 *
 * - BOOK_CANCEL (§6.2): pasien yang bookingnya batal harus tahu SEBELUM ia
 *   berangkat besok pagi. Menahannya sampai jam 07.00 menghapus gunanya.
 * - AUTO_REPLY: ini BALASAN atas pesan yang pasiennya sendiri kirim barusan --
 *   ia sedang memegang ponselnya dan menunggu jawaban. Menahannya sampai pagi
 *   membuat jawaban datang sembilan jam setelah pertanyaannya, saat pasien
 *   sudah lupa pernah bertanya. Jam tenang ada untuk melindungi pasien dari
 *   pesan yang TIDAK ia minta; balasan atas pertanyaannya sendiri bukan itu.
 * - FARMASI_VALIDASI / FARMASI_PENYERAHAN: penerimanya BUKAN pasien melainkan
 *   grup/petugas apotek yang sedang bertugas. Jam tenang melindungi orang yang
 *   sedang tidur di rumah, bukan shift malam yang justru menunggu pesan ini.
 *   Menahannya sampai 07.00 punya akibat kedua yang lebih buruk daripada
 *   sekadar terlambat: seluruh resep semalam menumpuk lalu dikirim serentak
 *   pagi hari sebagai puluhan pesan basi sekaligus -- persis pola beruntun yang
 *   memicu deteksi spam WhatsApp, dengan isi yang sudah tidak berguna lagi.
 * - FARMASI_UJI: staf sedang berdiri di depan layar menunggu pesannya muncul di
 *   grup. Pesan uji yang ditahan sampai pagi tidak terbaca sebagai "ditahan"
 *   melainkan sebagai "kode grupnya salah" -- lalu ia mengganti kode yang
 *   sebenarnya sudah benar.
 */
const BYPASS_QUIET_HOURS = new Set([
  'BOOK_CANCEL',
  'AUTO_REPLY',
  'FARMASI_VALIDASI',
  'FARMASI_PENYERAHAN',
  'FARMASI_UJI',
]);

/** Dipakai saat ENQUEUE untuk menentukan scheduled_at outbox. */
export function computeScheduledAt(eventAt: Date, triggerCode: string, quietStart: number, quietEnd: number): Date {
  if (BYPASS_QUIET_HOURS.has(triggerCode)) return eventAt;
  if (!isQuietHours(eventAt, quietStart, quietEnd)) return eventAt;
  return nextWindowStart(eventAt, quietEnd);
}
