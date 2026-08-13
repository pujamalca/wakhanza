import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

/**
 * Sampai berkas ini memuatnya, dashboard TIDAK memakai typeface sama sekali --
 * ia jatuh ke tumpukan bawaan Tailwind, yang berarti tampilannya berbeda di tiap
 * komputer loket dan tidak satu pun keputusan tipografi bisa ditegakkan.
 *
 * Inter dipilih bukan karena selera: ia punya **angka tabular** (`tnum`), dan
 * hampir seluruh isi dashboard ini adalah kolom angka -- jumlah pesan, rupiah,
 * stempel waktu. Dengan angka proporsional, lebar tiap digit berbeda sehingga
 * kolom yang seharusnya rata bergoyang baris demi baris; itu terbaca sebagai
 * "berantakan" tanpa pembacanya bisa menunjuk sebabnya.
 *
 * `next/font` mengunduh saat BUILD lalu menyajikannya dari server sendiri: nol
 * permintaan ke Google saat halaman dibuka, jadi tidak ada satu pun data
 * pemakaian yang bocor ke pihak ketiga -- syarat yang berlaku di alat rumah
 * sakit. Konsekuensi yang harus disadari: mesin yang MEM-BUILD butuh internet
 * sekali; mesin yang MENJALANKAN tidak.
 *
 * `display: 'swap'` supaya teks tidak pernah tak terlihat sambil menunggu font
 * (FOIT) -- alat yang dipakai petugas tidak boleh kosong beberapa ratus mili.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'wakhanza',
  description: 'Gateway notifikasi WhatsApp untuk SIMRS Khanza',
};

// Dijalankan sebelum hydration supaya tidak ada kedipan tema salah --
// baca pilihan tersimpan, fallback ke preferensi sistem. suppressHydrationWarning
// di <html> diperlukan karena script ini mengubah class sebelum React hydrate.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('wakhanza-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans text-body antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
