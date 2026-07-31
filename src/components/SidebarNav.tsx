'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SidebarNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
