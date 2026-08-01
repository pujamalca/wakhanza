/**
 * Bentuk lama `<EmptyState>teks</EmptyState>` tetap berlaku (hanya `children`);
 * `icon`/`title`/`action` opsional untuk keadaan kosong yang perlu menjelaskan
 * langkah berikutnya, bukan sekadar memberitahu bahwa tabelnya kosong.
 */
export function EmptyState({
  icon,
  title,
  action,
  children,
}: {
  icon?: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      {title && <p className="text-sm font-medium">{title}</p>}
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
