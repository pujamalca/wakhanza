import { redirect } from 'next/navigation';

// middleware.ts sudah menegakkan autentikasi untuk seluruh path selain
// /login -- begitu render sampai di sini, sesi pasti ada.
export default function HomePage() {
  redirect('/koneksi');
}
