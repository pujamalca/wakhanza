import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

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
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
