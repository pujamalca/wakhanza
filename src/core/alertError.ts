/**
 * Menerjemahkan kegagalan webhook peringatan jadi kalimat yang menyebut
 * TINDAKANNYA, bukan cuma angkanya.
 *
 * Lahir dari kejadian nyata: `alert.webhook_url` diisi URL bot Telegram
 * telanjang (`https://api.telegram.org/bot<token>`), tombol uji menjawab
 * "Gagal terkirim. Periksa log worker untuk alasannya", dan jawaban
 * sebenarnya -- HTTP 404, karena URL itu bukan endpoint apa pun -- sudah
 * dipegang `sendAlert()` sebagai `res.status` satu baris sebelumnya. Yang
 * memisahkan staf dari jawabannya cuma keputusan untuk tidak menaikkannya ke
 * layar. Menyuruh orang membuka log worker demi angka yang sudah ada di tangan
 * adalah bentuk kegagalan yang sama dengan `outbox` berstatus `failed` yang
 * tidak muncul di panel mana pun: bukan senyap, cuma tidak berguna.
 *
 * Modul MURNI -- tanpa database, tanpa jaringan. Yang perlu diuji justru
 * pemetaannya, dan pemetaan yang hanya bisa diuji dengan menyiapkan endpoint
 * yang sengaja rusak adalah pemetaan yang tidak akan pernah diuji.
 */

/**
 * Jawaban penerima dipotong karena ia teks PIHAK KETIGA: panjangnya tak
 * terbatas, dan sebuah proxy yang salah setel menjawab satu halaman HTML utuh.
 * 200 karakter cukup memuat `{"ok":false,...,"description":"Bad Request: chat
 * not found"}` seutuhnya -- kalimat itulah yang paling menjawab dari seluruh
 * respons.
 */
export const PANJANG_CUPLIKAN_MAKS = 200;

/**
 * Status HTTP -> apa yang harus DIPERIKSA. Dipisah per kelas karena tiap kelas
 * menunjuk bagian setelan yang berbeda, dan itu yang menentukan ke mana staf
 * melangkah berikutnya:
 *
 * - 404 = URL-nya (bagian METHOD hilang)
 * - 400 = isinya/tujuannya (`chat_id` hilang, atau penerima menuntut bentuk lain)
 * - 401/403 = kredensialnya (token salah, bot tidak berhak)
 * - 5xx = penerimanya, BUKAN setelan kita -- dan itu penting supaya tidak ada
 *   yang menghabiskan sore membetulkan URL yang sudah benar
 */
function jelaskanStatusWebhook(status: number): string {
  if (status === 404) {
    return 'URL-nya tidak menunjuk endpoint apa pun. Untuk bot Telegram, ekornya wajib "/sendMessage" -- URL bot telanjang selalu 404.';
  }
  if (status === 400) {
    return 'Penerima menolak isi permintaan. Untuk bot Telegram, sebabnya hampir selalu "?chat_id=<id>" belum ada di URL.';
  }
  if (status === 401 || status === 403) {
    return 'Ditolak: token/kredensial di URL salah, kedaluwarsa, atau tidak berhak mengirim ke tujuan itu.';
  }
  if (status === 429) {
    return 'Penerima membatasi laju (terlalu banyak permintaan). Naikkan jeda antar peringatan.';
  }
  if (status >= 500) {
    return 'Penerimanya yang sedang bermasalah, bukan setelan di sini -- coba lagi nanti sebelum mengubah apa pun.';
  }
  return 'Penerima menolak permintaan.';
}

/**
 * Token bot Telegram hidup DI DALAM URL (`/bot<id>:<rahasia>/sendMessage`), dan
 * sebagian server menaruh URL permintaan apa adanya di halaman galatnya. Tanpa
 * penyensoran ini, satu 404 dari proxy yang salah setel cukup untuk memindahkan
 * token itu ke berkas log -- tempat yang aturannya berbeda sama sekali dari
 * `app_setting`, dan yang isinya bertahan lama. Ditutup di hulu supaya berlaku
 * untuk seluruh pemakai fungsi ini, bukan diingat satu per satu di pemanggil.
 */
function sensorRahasia(teks: string): string {
  return teks.replace(/bot\d{5,}:[A-Za-z0-9_-]{10,}/g, 'bot<token disensor>');
}

/**
 * Membuang baris baru dan memotong. Baris baru dibuang karena pesan ini tampil
 * sebagai SATU baris di panel hasil uji; jawaban multi-baris memanjangkan panel
 * tanpa menambah keterangan.
 *
 * Penyensoran dikerjakan SEBELUM pemotongan, kalau tidak potongannya bisa
 * membelah token tepat di tengah lalu meloloskan separuhnya.
 */
function ringkasJawaban(mentah: string, maks: number = PANJANG_CUPLIKAN_MAKS): string {
  const rapi = sensorRahasia(mentah).replace(/\s+/g, ' ').trim();
  if (!rapi) return '';
  return rapi.length > maks ? `${rapi.slice(0, maks)}...` : rapi;
}

/**
 * Kalimat lengkap untuk ditampilkan ke staf.
 *
 * Cuplikan jawaban penerima ikut karena ia sering LEBIH menjawab daripada
 * kalimat kita: Telegram membalas "Bad Request: chat not found" apa adanya, dan
 * itu langsung membedakan "chat_id salah" dari "chat_id tidak ada" -- pembedaan
 * yang tidak bisa diturunkan dari status 400 saja.
 */
export function jelaskanKegagalanWebhook(status: number, jawaban = ''): string {
  const cuplikan = ringkasJawaban(jawaban);
  const dasar = `HTTP ${status} -- ${jelaskanStatusWebhook(status)}`;
  return cuplikan ? `${dasar} Jawaban penerima: ${cuplikan}` : dasar;
}

/**
 * Kegagalan yang terjadi SEBELUM ada status HTTP sama sekali: DNS tidak
 * terselesaikan, port tertutup firewall RS, TLS ditolak, atau batas waktu keras
 * 10 detik terlampaui. Dibedakan dari kegagalan ber-status karena tindakannya
 * berbeda sama sekali -- yang ini soal JARINGAN, bukan soal isi URL, dan
 * membetulkan URL tidak akan mengubah apa pun.
 */
export function jelaskanKegagalanJaringan(pesan: string): string {
  const cuplikan = ringkasJawaban(pesan);
  const dasar = 'Tidak sampai ke penerimanya sama sekali (nama domain, firewall keluar, TLS, atau lewat batas 10 detik).';
  return cuplikan ? `${dasar} Galat: ${cuplikan}` : dasar;
}
