import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SidebarNav } from '@/components/SidebarNav';
import { Button } from '@/components/ui';

const NAV_ITEMS = [
  { href: '/koneksi', label: 'Koneksi' },
  { href: '/antrean', label: 'Antrean' },
  { href: '/template', label: 'Template' },
  { href: '/nomor-bermasalah', label: 'Nomor bermasalah' },
  { href: '/daftar-tolak', label: 'Daftar tolak' },
  { href: '/broadcast', label: 'Broadcast', adminOnly: true },
  { href: '/broadcast-terjadwal', label: 'Broadcast terjadwal', adminOnly: true },
  { href: '/pengaturan', label: 'Pengaturan', adminOnly: true },
  { href: '/log', label: 'Log' },
  { href: '/audit', label: 'Audit', adminOnly: true },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { username, role } = session.user;
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-muted/30 p-4">
        <div className="mb-6 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">wakhanza</p>
            <p className="text-xs text-muted-foreground">
              {username} · {role}
            </p>
          </div>
          <ThemeToggle />
        </div>
        <SidebarNav items={items} />
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <Button type="submit" variant="secondary" className="w-full justify-start">
            Keluar
          </Button>
        </form>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
