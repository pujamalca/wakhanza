'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';
import {
  IconGauge,
  IconPlug,
  IconInbox,
  IconFileText,
  IconFileSend,
  IconPhoneAlert,
  IconBan,
  IconMegaphone,
  IconPill,
  IconChat,
  IconClock,
  IconSettings,
  IconActivity,
  IconShield,
  IconMenu,
  IconReply,
  IconUser,
  IconUsers,
  IconX,
  type IconProps,
} from './ui/icons';

/**
 * Ikon dikirim dari layout sebagai KUNCI (string), bukan sebagai elemen React.
 * Layout adalah Server Component; mengirim elemen ikon lintas batas server-klien
 * berarti ikut mengirim penanda komponennya di payload RSC untuk tiap menu.
 * Satu string per menu lebih murah, dan pemetaannya tinggal di sisi klien.
 */
export type NavIcon =
  | 'gauge'
  | 'plug'
  | 'inbox'
  | 'file'
  | 'fileSend'
  | 'phone'
  | 'ban'
  | 'megaphone'
  | 'pill'
  | 'chat'
  | 'clock'
  | 'reply'
  | 'settings'
  | 'activity'
  | 'shield'
  | 'user'
  | 'users';

const ICONS: Record<NavIcon, ComponentType<IconProps>> = {
  gauge: IconGauge,
  plug: IconPlug,
  inbox: IconInbox,
  file: IconFileText,
  fileSend: IconFileSend,
  phone: IconPhoneAlert,
  ban: IconBan,
  megaphone: IconMegaphone,
  pill: IconPill,
  chat: IconChat,
  clock: IconClock,
  reply: IconReply,
  settings: IconSettings,
  activity: IconActivity,
  shield: IconShield,
  user: IconUser,
  users: IconUsers,
};

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

function NavLinks({ groups, pathname }: { groups: NavGroup[]; pathname: string | null }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              const Icon = ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  username,
  role,
  groups,
  signOut,
  children,
}: {
  username: string;
  role: string;
  groups: NavGroup[];
  /** Form keluar dirakit di layout (Server Action) lalu diselipkan sebagai node. */
  signOut: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Menutup laci saat pindah halaman -- tanpa ini menu tetap menutupi isi
  // halaman yang baru dibuka di ponsel.
  //
  // Disesuaikan SAAT RENDER, bukan lewat useEffect: menyetel state di dalam
  // efek memicu render berantai (React merender sekali dengan menu masih
  // terbuka, baru menutupnya di render berikutnya). Pola "simpan nilai render
  // sebelumnya lalu bandingkan" ini yang direkomendasikan React untuk
  // menyesuaikan state ketika sesuatu dari luar berubah; ia juga ikut menangani
  // navigasi tombol maju/mundur peramban, yang tidak tertangkap kalau laci
  // hanya ditutup lewat onClick tiap tautan.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen lg:flex">
      {/* Bilah atas hanya ada di bawah lg -- di layar lebar sidebar sudah permanen. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/90 px-3 py-2 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          aria-expanded={open}
          aria-controls="menu-utama"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <Brand subtitle={false} />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      {open && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
        />
      )}

      {/*
        `invisible` saat tertutup, bukan sekadar digeser keluar layar: elemen yang
        hanya di-translate tetap bisa dijangkau Tab, sehingga fokus keyboard bisa
        "hilang" ke menu yang tak terlihat. `visibility` mengeluarkannya dari
        urutan fokus, dan tetap bisa ditransisikan bersama transform.
      */}
      <aside
        id="menu-utama"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-4 border-r bg-card p-3 transition-[transform,visibility] duration-200 lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:w-60 lg:visible lg:translate-x-0 ${
          open ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <Brand />
          <div className="flex items-center gap-1">
            <span className="hidden lg:block">
              <ThemeToggle />
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Tutup menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:hidden"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        </div>

        <NavLinks groups={groups} pathname={pathname} />

        <div className="border-t pt-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
              {username.slice(0, 2)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium">{username}</span>
              <span className="block text-[11px] capitalize text-muted-foreground">{role}</span>
            </span>
          </div>
          {signOut}
        </div>
      </aside>

      {/* min-w-0 wajib: tanpa itu tabel dengan overflow-x-auto memaksa flex item
          melebar dan seluruh halaman ikut bergeser ke samping. */}
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
