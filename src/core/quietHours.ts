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
 * - FARMASI_STOK_DARURAT: penerimanya staf, seperti dua pemicu farmasi di atas.
 *   Tapi alasan utamanya di sini BERBEDA dan lebih menentukan: waktu kirimnya
 *   dipilih staf sendiri lewat `stok_alert_schedule.time_of_day`. Menundukkannya
 *   pada jam tenang berarti diam-diam mengabaikan jam yang baru saja mereka
 *   setel -- apotek shift malam yang sengaja memilih 05:00 akan menerimanya
 *   07:00 tanpa satu pun keterangan kenapa. Pagar terhadap pesan larut malam di
 *   sini adalah form jadwalnya, bukan jam tenang.
 * - BPJS_BATAL: penerimanya loket/pendaftaran, bukan pasien -- alasan yang sama
 *   dengan kedua pemicu farmasi. Ditambah satu yang khas kanal ini: gunanya
 *   adalah supaya slot yang batal bisa ditawarkan ke pasien lain, dan slot itu
 *   sering untuk BESOK PAGI. Pembatalan pukul 21.30 yang baru diberitahukan
 *   pukul 07.00 tiba bersamaan dengan pasiennya sendiri datang.
 *
 * - ADMINISTRASI: penerimanya PASIEN, jadi ia satu-satunya di daftar ini yang
 *   tidak bisa berlindung di balik "penerimanya staf". Yang membenarkannya
 *   adalah bahwa ia sepenuhnya SINKRON dengan tindakan seseorang: staf menekan
 *   kirim untuk satu pasien, biasanya karena orangnya sedang berdiri di loket
 *   atau baru saja menelepon memintanya. Alasan yang sama persis dengan
 *   AUTO_REPLY -- jam tenang melindungi dari pesan yang TIDAK diminta, dan
 *   dokumen yang baru saja diminta bukan itu.
 *
 *   Yang membuatnya bukan sekadar kenyamanan: kegagalannya TIDAK TERLIHAT.
 *   Staf menekan kirim, halaman menjawab berhasil, dan berkasnya diam di
 *   antrean sampai pagi tanpa satu pun tanda di layar -- lalu pasien yang masih
 *   di depan loket dikirimi lagi oleh staf yang mengira kiriman pertama gagal.
 *
 * Yang SENGAJA tidak ada di sini: BPJS_KONTROL. Ia pengingat KE PASIEN, dan
 * jam kirimnya (`bpjs.kontrol_jam`) memang dipilih staf -- tapi berbeda dari
 * FARMASI_STOK_DARURAT, yang menerimanya orang yang sedang tidur di rumah.
 * Jam tenang justru ada untuk itu, jadi jam kirim yang tidak sengaja disetel
 * 23.00 harus tetap tertahan sampai pagi. Bedanya dari ADMINISTRASI: pengingat
 * kontrol berangkat dari JADWAL, bukan dari seseorang yang sedang menunggu.
 */
const BYPASS_QUIET_HOURS = new Set([
  'BOOK_CANCEL',
  'AUTO_REPLY',
  'FARMASI_VALIDASI',
  'FARMASI_PENYERAHAN',
  'FARMASI_UJI',
  'FARMASI_STOK_DARURAT',
  'BPJS_BATAL',
  'ADMINISTRASI',
]);

/** Dipakai saat ENQUEUE untuk menentukan scheduled_at outbox. */
export function computeScheduledAt(eventAt: Date, triggerCode: string, quietStart: number, quietEnd: number): Date {
  if (BYPASS_QUIET_HOURS.has(triggerCode)) return eventAt;
  if (!isQuietHours(eventAt, quietStart, quietEnd)) return eventAt;
  return nextWindowStart(eventAt, quietEnd);
}
