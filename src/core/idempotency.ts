import { createHash } from 'node:crypto';

/**
 * ARCHITECTURE §4.2: idempotency_key = SHA1(trigger_code | kunci_alami...).
 * Disisipkan lewat INSERT IGNORE (UNIQUE KEY uq_idem) — deduplikasi terjadi di
 * mesin database, jadi tetap benar walau poller berjalan tumpang tindih.
 *
 * Untuk pemicu kelas pindai (BOOK_CANCEL), sertakan kolom yang berubah
 * (mis. status) sebagai bagian kunci alami: status yang sama -> kunci sama
 * -> INSERT ditolak; status berubah -> kunci baru -> satu pesan baru terkirim.
 */
export function buildIdempotencyKey(triggerCode: string, ...naturalKeyParts: Array<string | number>): string {
  const raw = [triggerCode, ...naturalKeyParts.map(String)].join('|');
  return createHash('sha1').update(raw, 'utf8').digest('hex');
}

/**
 * Kunci untuk SALINAN sebuah pesan ke satu tujuan tambahan (grup/nomor petugas,
 * migrations/018) -- diturunkan dari kunci pesan aslinya plus alamat tujuannya.
 *
 * KENAPA DI-HASH ULANG dan bukan disambung (`${kunci}:${chatId}`): kolom
 * `outbox.idempotency_key` adalah VARCHAR(64) sementara SHA1 hex sudah memakan
 * 40 karakter. Sebuah JID grup 24 karakter membuat sambungannya 65 karakter,
 * dan MariaDB dalam mode non-strict MEMOTONGNYA diam-diam. Yang terpotong justru
 * ekornya -- yaitu bagian yang membedakan satu tujuan dari tujuan lain -- jadi
 * tujuan kedua dan seterusnya akan bertabrakan di `uq_idem` dan ditolak sebagai
 * duplikat. Karena INSERT-nya memang sengaja `ignoreDuplicates`, kegagalan itu
 * tidak meninggalkan satu pun galat: hanya grup pertama yang pernah menerima
 * apa pun. Pelajaran yang sama sudah dibayar di `farmasi_target`.
 *
 * Alamat tujuan WAJIB masuk kunci, bukan opsional: tanpa itu seluruh tujuan
 * berbagi satu kunci dan hanya yang pertama yang lolos.
 */
export function turunkanKunciTujuan(kunciDasar: string, chatId: string): string {
  return createHash('sha1').update(`${kunciDasar}|${chatId}`, 'utf8').digest('hex');
}

/**
 * Kunci untuk BAGIAN ke-`indeks` dari satu pesan yang dipecah karena terlalu
 * panjang (darurat stok, `core/stokDarurat.ts`'s `pecahDaftarDarurat`).
 *
 * Bagian PERTAMA sengaja memakai kunci dasarnya apa adanya, bukan turunan.
 * Sebabnya bukan kerapian: beberapa pemanggil memeriksa lebih dulu apakah kunci
 * dasarnya sudah ada di `outbox` untuk menolak pesan yang diserahkan ulang
 * (`handleInboundMessage`). Kalau bagian pertama ikut diturunkan, kunci dasar
 * itu tidak pernah benar-benar tertulis, pemeriksaannya selalu meleset, dan
 * satu restart worker membanjiri penerimanya dengan jawaban lama. Pesan yang
 * TIDAK terpecah pun jadi berperilaku persis seperti sebelum pemecahan ada.
 *
 * Di-HASH ULANG dan bukan disambung, dengan alasan yang sama seperti
 * `turunkanKunciTujuan`: kolomnya VARCHAR(64) dan MariaDB non-strict memotong
 * kelebihannya tanpa satu pun galat.
 */
export function turunkanKunciBagian(kunciDasar: string, indeks: number): string {
  if (indeks <= 0) return kunciDasar;
  return createHash('sha1').update(`${kunciDasar}#bagian${indeks}`, 'utf8').digest('hex');
}
