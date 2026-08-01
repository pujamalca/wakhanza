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
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
