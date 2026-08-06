export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

// Memakai token --success/--warning (globals.css) alih-alih green-600/amber-500
// langsung: aturan proyek adalah warna baru masuk sebagai token di :root DAN
// .dark, supaya satu tempat yang mengatur kedua tema.
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-primary/10 text-primary',
};

export function Badge({
  variant = 'neutral',
  className = '',
  title,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  /**
   * Keterangan lengkap saat kursor berhenti di atasnya.
   *
   * Lencana harus pendek supaya muat di sel tabel, dan yang dipangkas demi
   * pendek itu justru SEBABNYA -- "Kosong" tidak memberi tahu bahwa pesannya
   * tidak akan sampai. Pola yang sama dipakai `labels.ts`, yang menyimpan kode
   * mesin di `title` berdampingan dengan label manusianya.
   */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
