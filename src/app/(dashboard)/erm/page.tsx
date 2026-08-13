import { redirect } from 'next/navigation';

/**
 * `/erm` tidak punya isi sendiri -- ia induk menu, dan induk bersubmenu di
 * sidebar sengaja BUKAN tautan (ia tombol buka/tutup).
 *
 * Rute ini tetap ada karena URL-nya bisa diketik atau dibagikan tangan, dan
 * halaman 404 untuk alamat yang jelas milik aplikasi ini terbaca sebagai fitur
 * yang rusak. Ia mengarahkan ke submenu pertama.
 *
 * Otorisasinya tidak diperiksa di sini dengan sengaja: redirect-nya menuju
 * halaman yang MEMERIKSA sendiri (`session.user.role !== 'admin'` ->
 * `/ringkasan`), jadi pemeriksaan kedua di sini cuma menduplikasi keputusan yang
 * sama di dua tempat -- dan dua tempat yang bisa menyimpang adalah bentuk
 * kegagalan yang berulang kali dibayar di proyek ini.
 */
export default function ErmPage() {
  redirect('/erm/penilaian-umum');
}
