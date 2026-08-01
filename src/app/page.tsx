import { redirect } from 'next/navigation';

// proxy.ts sudah menegakkan autentikasi untuk seluruh path selain /login --
// begitu render sampai di sini, sesi pasti ada.
//
// Mendarat di /ringkasan, bukan /koneksi seperti sebelumnya: halaman Koneksi
// menjawab "bagaimana cara menyambungkan WhatsApp", pertanyaan yang hanya
// muncul sekali saat pemasangan. Yang ditanyakan petugas tiap hari adalah
// "apakah pesannya terkirim?", dan itu halaman Ringkasan.
export default function HomePage() {
  redirect('/ringkasan');
}
