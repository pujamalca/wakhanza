import Link from 'next/link';

export function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active ? 'border-primary/30 bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
      }`}
    >
      {children}
    </Link>
  );
}
