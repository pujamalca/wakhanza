import Link from 'next/link';

/**
 * Tab berbasis URL untuk halaman yang memuat beberapa bagian yang berdiri
 * sendiri.
 *
 * ## Kenapa BUKAN `role="tablist"`
 *
 * Kontrak ARIA untuk tab menjanjikan dua hal: menekan sebuah tab menukar panel
 * DI DALAM dokumen yang sama tanpa navigasi, dan panah kiri/kanan berpindah
 * antar tab. Tab di sini adalah TAUTAN -- ia benar-benar bernavigasi, dan panah
 * tidak melakukan apa pun. Menandainya `tablist` berarti menjanjikan perilaku
 * yang tidak ada kepada orang yang paling bergantung pada janji itu.
 *
 * Yang benar untuk bentuk ini adalah navigasi: `<nav>` + `aria-current="page"`.
 * Sekalian gratis tiga hal yang versi klien harus bangun sendiri -- bisa
 * di-bookmark dan dibagikan, tombol maju/mundur peramban bekerja, dan Server
 * Component boleh BERHENTI mengambil data bagian yang sedang tidak dibuka.
 *
 * ## Titik status
 *
 * `status` menggambar satu titik warna di depan label. Ia ada supaya keadaan
 * "menyala tapi salah setel" -- yang sebelumnya hanya terbaca sesudah menggulir
 * ke bagiannya -- terlihat tanpa membuka tabnya sama sekali, dan tanpa memakan
 * satu baris pun ruang vertikal.
 *
 * Warna saja tidak pernah cukup (WCAG 1.4.1), jadi tiap titik membawa teksnya
 * sendiri lewat `sr-only` + `title`. Keadaan lengkapnya tetap ditulis dengan
 * kata-kata di dalam panelnya.
 */

export type TabStatus = 'success' | 'warning' | 'neutral';

export interface TabItem {
  key: string;
  href: string;
  label: string;
  /** Angka kecil di samping label, mis. jumlah baris tabel di dalamnya. */
  count?: number;
  status?: TabStatus;
  /** Wajib bila `status` diisi -- inilah yang dibaca pembaca layar. */
  statusLabel?: string;
}

const DOT: Record<TabStatus, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-muted-foreground/40',
};

export function Tabs({ items, active, label }: { items: TabItem[]; active: string; label: string }) {
  return (
    // overflow-x-auto: di layar sempit deretan tab lebih lebar dari layar, dan
    // yang boleh menggulir menyamping adalah kotak ini -- bukan badan halaman.
    <nav aria-label={label} className="mb-6 -mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b px-1">
        {items.map((t) => {
          const aktif = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={aktif ? 'page' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                  aktif
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                {t.status && (
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.status]}`} title={t.statusLabel} aria-hidden />
                )}
                {t.label}
                {t.statusLabel && <span className="sr-only"> — {t.statusLabel}</span>}
                {t.count !== undefined && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
