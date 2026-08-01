/**
 * Tanda pengenal aplikasi. Dipakai di sidebar, bilah atas layar kecil, dan
 * halaman login supaya ketiganya menampilkan identitas yang sama persis.
 * Gelembung pesan dengan denyut di dalamnya: pesan keluar yang berjalan
 * otomatis -- bukan aplikasi obrolan.
 */
export function Brand({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="h-5 w-5"
        >
          <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.6A8.5 8.5 0 1 1 20.5 11.5Z" />
          <path d="M8 12h2l1.5-2.5L13.5 15l1.5-3h1.5" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold tracking-tight">wakhanza</span>
        {subtitle && <span className="block truncate text-[11px] text-muted-foreground">Notifikasi WhatsApp</span>}
      </span>
    </div>
  );
}
