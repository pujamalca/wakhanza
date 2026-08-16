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
  IconClipboardPulse,
  IconChevronRight,
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
  | 'users'
  | 'erm'
  | 'formulir';

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
  erm: IconClipboardPulse,
  /**
   * Sengaja memakai ulang gambar ERM alih-alih `file` yang sudah dipakai BPJS
   * dan Template. Ikon yang sama di grup yang BERBEDA masih bisa dibedakan
   * lewat letaknya; tiga menu beribu gambar sama di dalam SATU grup tidak.
   * Kuncinya tetap sendiri supaya keduanya bisa berpisah tanpa menyentuh
   * pemanggil mana pun.
   */
  formulir: IconClipboardPulse,
};

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /**
   * Submenu. Induk yang punya anak TIDAK bisa diklik sebagai tautan -- ia
   * tombol buka/tutup.
   *
   * Bentuk BERTINGKAT, bukan `NavGroup` datar kedua, dan itu permintaan yang
   * jelas: ERM akan tumbuh jadi banyak submenu (penilaian umum, gigi, mata,
   * kebidanan), dan sebagai grup datar keempatnya akan duduk sejajar dengan
   * sembilan menu lain di sidebar yang sama. Yang bisa dilipat menyembunyikan
   * isinya sampai diminta; grup datar tidak bisa.
   */
  children?: NavItem[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const KELAS_TAUTAN =
  'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
const KELAS_AKTIF = 'bg-primary/10 font-medium text-primary';
const KELAS_DIAM = 'text-foreground/80 hover:bg-muted hover:text-foreground';

function NavLinks({
  groups,
  pathname,
  dibuka,
  onToggle,
}: {
  groups: NavGroup[];
  pathname: string | null;
  dibuka: Record<string, boolean>;
  onToggle: (href: string, terbuka: boolean) => void;
}) {
  const aktif = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];

              if (!item.children || item.children.length === 0) {
                const on = aktif(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={on ? 'page' : undefined}
                    className={`${KELAS_TAUTAN} ${on ? KELAS_AKTIF : KELAS_DIAM}`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              }

              /**
               * Induk bersubmenu adalah DISCLOSURE, bukan tab dan bukan tautan.
               *
               * `aria-expanded` + `aria-controls` adalah kontrak yang benar untuk
               * "tombol ini membuka/menutup sesuatu di halaman yang sama".
               * `role="tablist"` akan menjanjikan panel yang bertukar tanpa
               * navigasi berikut perpindahan lewat panah kiri/kanan -- dua hal
               * yang tidak ada di sini, dan janji yang tidak ditepati paling
               * merugikan justru orang yang paling bergantung padanya. Alasan
               * yang sama sudah dibayar di `components/ui/Tabs.tsx`.
               *
               * Induk sengaja TIDAK juga jadi tautan. Kontrol yang menavigasi
               * SEKALIGUS melipat membuat satu klik punya dua akibat, dan yang
               * satu selalu tidak diinginkan.
               */
              const anakAktif = item.children.some((c) => aktif(c.href));
              const terbuka = dibuka[item.href] ?? anakAktif;
              const idPanel = `submenu-${item.href.replace(/\W+/g, '-')}`;

              return (
                <div key={item.href}>
                  <button
                    type="button"
                    onClick={() => onToggle(item.href, !terbuka)}
                    aria-expanded={terbuka}
                    aria-controls={idPanel}
                    className={`${KELAS_TAUTAN} w-full text-left ${
                      anakAktif && !terbuka ? KELAS_AKTIF : KELAS_DIAM
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <IconChevronRight
                      className={`h-4 w-4 shrink-0 transition-transform ${terbuka ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {/*
                    `hidden` saat tertutup, bukan sekadar tinggi nol: submenu yang
                    hanya disembunyikan lewat ukuran tetap bisa dijangkau Tab,
                    sehingga fokus keyboard "hilang" ke tautan yang tak terlihat.
                    Pelajaran yang sama sudah dibayar pada laci `invisible` di
                    bawah.
                  */}
                  <div id={idPanel} hidden={!terbuka} className="mt-0.5 flex flex-col gap-0.5">
                    {item.children.map((anak) => {
                      const on = aktif(anak.href);
                      return (
                        <Link
                          key={anak.href}
                          href={anak.href}
                          aria-current={on ? 'page' : undefined}
                          // Bertakuk sejajar dengan TEKS induknya (bukan ikonnya),
                          // supaya hubungan induk-anak terbaca dari perataannya.
                          className={`${KELAS_TAUTAN} pl-[2.375rem] ${on ? KELAS_AKTIF : KELAS_DIAM}`}
                        >
                          <span className="truncate">{anak.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
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
  /**
   * Submenu yang SENGAJA dibuka/ditutup pemakai. Yang tidak ada di sini jatuh ke
   * bawaannya: terbuka bila salah satu anaknya sedang aktif.
   *
   * Bentuk "override di atas turunan", bukan state penuh, supaya membuka
   * halaman ERM langsung memperlihatkan submenu tempat halaman itu berada --
   * tanpa satu pun useEffect. Menyimpan keadaan penuh berarti ada dua sumber
   * kebenaran (state dan URL) yang harus disinkronkan, dan yang tidak sinkron
   * adalah submenu tertutup yang isinya justru sedang dibuka.
   */
  const [dibuka, setDibuka] = useState<Record<string, boolean>>({});

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
    // Lipatan manual dibuang saat pindah halaman, jadi submenu yang berisi
    // halaman baru selalu terbuka. Tanpa ini, pemakai yang pernah menutup ERM
    // lalu menuju salah satu halamannya melihat menu tertutup sementara isinya
    // sedang tampil -- keadaan yang terbaca sebagai menunya rusak.
    setDibuka({});
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

        <NavLinks
          groups={groups}
          pathname={pathname}
          dibuka={dibuka}
          onToggle={(href, terbuka) => setDibuka((s) => ({ ...s, [href]: terbuka }))}
        />

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
