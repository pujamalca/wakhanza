export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-green-600/10 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  warning: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}
