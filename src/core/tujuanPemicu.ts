import { turunkanKunciTujuan } from './idempotency';

/**
 * KE MANA sebuah pemicu pasien dikirim, dan kunci idempoten apa saja yang
 * karena itu benar-benar ditulis ke `outbox`.
 *
 * Berkas ini ada karena dua tempat harus menjawab pertanyaan yang SAMA dan
 * sempat menjawabnya berbeda:
 *
 *   `enqueuePemicuPasien()`  -- menulis barisnya
 *   `saringKunciBaruPemicuPasien()` -- menyaring baris yang sudah ditulis
 *
 * Selama yang kedua tidak tahu persis apa yang ditulis yang pertama, ia
 * menyaring berdasarkan kunci yang tidak pernah ada, dan penyaringnya berhenti
 * bekerja TANPA satu pun galat. Itu bukan kemungkinan teoretis: pada mode
 * `tujuan`, kunci dasarnya memang tidak pernah tertulis, dan siklus
 * KONTROL_TERBIT di produksi karena itu memproses ulang seluruh jendelanya tiap
 * 60 detik selama berjam-jam sambil melaporkan `baru:1, terkirim:1` untuk pesan
 * yang tidak pernah dibuat.
 *
 * Bentuk kegagalan yang sama sudah berkali-kali dibayar di proyek ini
 * (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`), dan
 * jawabannya selalu sama: satu penurunan, dipakai bersama.
 *
 * Murni -- tanpa database, tanpa Sequelize -- justru supaya keputusannya bisa
 * diuji unit. Keadaan yang paling perlu dibuktikan (mode `tujuan` dengan
 * beberapa tujuan) tidak butuh satu baris data pun untuk diperiksa.
 */

/**
 * Sumber tunggal untuk union-nya; `models/Template.ts` mengambilnya dari sini
 * alih-alih mendeklarasikan salinannya sendiri. Nilainya harus tetap sama persis
 * dengan ENUM `template.tujuan_mode` di MariaDB (migrations/018).
 */
export type ModeTujuan = 'pasien' | 'pasien_dan_tujuan' | 'tujuan';

/**
 * Penerjemahan mode -> dua pertanyaan boolean.
 *
 * Sengaja SATU fungsi dan bukan dua perbandingan yang ditulis ulang di tiap
 * pemanggil: `mode !== 'tujuan'` dan `mode !== 'pasien'` gampang tertukar saat
 * dibaca cepat, dan tertukarnya menghasilkan pesan yang pergi ke tempat yang
 * salah tanpa satu pun galat.
 */
export function sasaranPemicuPasien(mode: ModeTujuan): { kePasien: boolean; keTujuan: boolean } {
  return { kePasien: mode !== 'tujuan', keTujuan: mode !== 'pasien' };
}

/**
 * SELURUH kunci idempoten yang akan tertulis untuk satu kunci dasar.
 *
 * Urutannya mengikuti urutan penulisan di `enqueuePemicuPasien()` -- pasien
 * dulu, lalu tiap tujuan -- supaya keduanya bisa dibaca berdampingan.
 *
 * Mengembalikan larik KOSONG untuk mode `tujuan` tanpa satu pun tujuan: itu
 * keadaan salah setel yang berarti pesannya tidak pergi ke mana pun, dan
 * pemanggilnya WAJIB memperlakukannya sebagai "masih perlu diproses" supaya
 * `enqueuePemicuPasien()` sempat mencatatnya sebagai ERROR. Menyaringnya di
 * depan akan mengubah salah setel yang berisik menjadi pemicu yang diam-diam
 * tidak mengirim -- persis kegagalan yang paling mahal di sistem ini.
 */
export function kunciYangDitulis(kunciDasar: string, mode: ModeTujuan, chatIds: readonly string[]): string[] {
  const { kePasien, keTujuan } = sasaranPemicuPasien(mode);

  const kunci: string[] = [];
  if (kePasien) kunci.push(kunciDasar);
  if (keTujuan) {
    for (const chatId of chatIds) kunci.push(turunkanKunciTujuan(kunciDasar, chatId));
  }
  return kunci;
}
