import type { ReactNode } from 'react';

/**
 * Kotak keterangan berjudul, dengan pilihan dilipat.
 *
 * Halaman di proyek ini sengaja menuliskan ALASAN di depan staf, bukan cuma di
 * komentar kode -- itu keputusan yang dipertahankan. Tapi prosa yang selalu
 * terbentang penuh punya ongkosnya sendiri: empat paragraf sebelum kontrol
 * pertama membuat halaman digulir jauh, dan yang digulir cepat justru berhenti
 * dibaca. Persis pola yang sama dengan peringatan harian berisi "tidak ada
 * apa-apa" yang berhenti dibaca dalam seminggu.
 *
 * Bentuk melipatnya lewat `<details>` asli: nol JavaScript, bisa dibuka dengan
 * keyboard, dan peramban modern membukanya sendiri saat isinya kena Ctrl+F.
 *
 * ## Syarat yang mengikat
 *
 * **`title` harus utuh sendirian.** Yang selalu terlihat cuma judulnya, jadi
 * judul yang berbunyi "Catatan" atau "Info penting" menyembunyikan seluruh
 * pesannya di balik satu klik yang tidak ada alasan untuk ditekan. Judul memuat
 * KESIMPULANNYA ("Pesan ini berisi data pasien"), isinya memuat ALASANNYA.
 *
 * Karena itu peringatan yang harus dibaca sebelum sebuah sakelar dinyalakan
 * dibiarkan terbentang (`defaultOpen`), bukan dilipat -- melipatnya menukar
 * halaman yang lebih pendek dengan keputusan yang diambil tanpa keterangan.
 */

export type CalloutVariant = 'warning' | 'info' | 'neutral';

const KOTAK: Record<CalloutVariant, string> = {
  warning: 'border-warning/30 bg-warning/5',
  info: 'border-primary/25 bg-primary/5',
  neutral: 'border-border/60',
};

export interface CalloutProps {
  variant?: CalloutVariant;
  title: ReactNode;
  children?: ReactNode;
  /** Melipat isinya di balik judul. Judul tetap selalu terlihat. */
  collapsible?: boolean;
  /** Hanya berlaku bila `collapsible`. */
  defaultOpen?: boolean;
  className?: string;
}

export function Callout({
  variant = 'neutral',
  title,
  children,
  collapsible = false,
  defaultOpen = false,
  className = '',
}: CalloutProps) {
  const kotak = `rounded-lg border p-3 text-xs ${KOTAK[variant]} ${className}`;

  if (!children) return <div className={kotak}><span className="font-medium">{title}</span></div>;

  if (!collapsible) {
    return (
      <div className={kotak}>
        <p className="font-medium">{title}</p>
        <div className="mt-1 text-muted-foreground">{children}</div>
      </div>
    );
  }

  return (
    <details className={kotak} open={defaultOpen}>
      <summary className="cursor-pointer font-medium marker:text-muted-foreground">{title}</summary>
      <div className="mt-2 text-muted-foreground">{children}</div>
    </details>
  );
}
