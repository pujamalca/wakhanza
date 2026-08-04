/**
 * Tanggal dan jam "sekarang" sebagaimana ditulis DI DALAM pesan WhatsApp.
 *
 * Sembilan pemicu lain mengisi `{tanggal}`/`{jam}` dari kolom `sik` apa adanya
 * -- itu waktu KEJADIAN, dan bentuknya sudah ditentukan Khanza. Dua pemicu
 * tidak punya kejadian untuk dirujuk (balasan otomatis, darurat stok), jadi
 * keduanya harus merangkai sendiri dari jam dinding. Berkas ini ada supaya
 * keduanya merangkainya dengan cara yang SAMA.
 *
 * Sepele kelihatannya, dan itu justru bentuk kegagalan yang berulang di proyek
 * ini: dua tempat menurunkan sendiri satu hal yang sama, lalu menyimpang tanpa
 * ada yang menyadarinya. Di sini yang menyimpang bukan angka melainkan bentuk
 * -- satu pesan resmi rumah sakit menulis "4 Agustus 2026" dan pesan berikutnya
 * dari nomor yang sama menulis "04/08/2026".
 *
 * Memakai getter `Date` lokal biasa, konsisten dengan seluruh proyek yang
 * mengasumsikan server RS berzona WIB (core/quietHours.ts, khanza/common.ts,
 * core/schedule.ts).
 */

/** "Selasa, 4 Agustus 2026" -- lengkap dengan hari, karena pembacanya manusia. */
export function formatTanggalPesan(d: Date): string {
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * "07.30" -- titik, bukan titik dua.
 *
 * Mengikuti kebiasaan penulisan waktu bahasa Indonesia, dan sekaligus
 * membedakannya secara kasat mata dari `jam_reg` mentah milik Khanza yang
 * berbentuk "07:30:00" pada pemicu lain.
 */
export function formatJamPesan(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
