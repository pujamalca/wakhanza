import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { AppShell, type NavGroup, type NavIcon } from '@/components/AppShell';
import { Button, IconLogout } from '@/components/ui';

/**
 * Menu dikelompokkan menurut pekerjaan yang sedang dilakukan petugas, bukan
 * satu daftar rata: sebelas menu sejajar tanpa hierarki memaksa staf membaca
 * seluruh daftar tiap kali. Penyaringan `adminOnly` di sini murni supaya menu
 * yang tidak bisa dipakai tidak ikut tampil -- gerbang sesungguhnya tetap
 * `proxy.ts` (halaman) dan `requireRole('admin')` (route/server action).
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: NavIcon; adminOnly?: boolean }[] }[] = [
  {
    label: 'Pemantauan',
    items: [
      { href: '/ringkasan', label: 'Ringkasan', icon: 'gauge' },
      { href: '/koneksi', label: 'Koneksi', icon: 'plug' },
      { href: '/antrean', label: 'Antrean pesan', icon: 'inbox' },
    ],
  },
  {
    label: 'Kirim pesan',
    items: [
      { href: '/broadcast', label: 'Broadcast', icon: 'megaphone', adminOnly: true },
      { href: '/broadcast-terjadwal', label: 'Broadcast terjadwal', icon: 'clock', adminOnly: true },
      { href: '/balasan-otomatis', label: 'Balasan otomatis', icon: 'reply', adminOnly: true },
      { href: '/template', label: 'Template', icon: 'file' },
    ],
  },
  {
    label: 'Data pasien',
    items: [
      { href: '/nomor-bermasalah', label: 'Nomor bermasalah', icon: 'phone' },
      { href: '/daftar-tolak', label: 'Daftar tolak', icon: 'ban' },
    ],
  },
  {
    // Profil sengaja BUKAN adminOnly dan berdiri di grupnya sendiri: ia satu-satunya
    // menu yang isinya milik pemakainya sendiri, bukan milik rumah sakit. Operator
    // yang tidak bisa mengganti kata sandinya sendiri akan berakhir memakai sandi
    // yang diketikkan orang lain untuknya -- dan sandi bersama membuat kolom
    // `actor` di audit_log berhenti berarti "orang ini".
    label: 'Akun saya',
    items: [{ href: '/profil', label: 'Profil saya', icon: 'user' }],
  },
  {
    label: 'Sistem',
    items: [
      { href: '/pengaturan', label: 'Pengaturan', icon: 'settings', adminOnly: true },
      { href: '/pengguna', label: 'Pengguna', icon: 'users', adminOnly: true },
      { href: '/log', label: 'Log pengiriman', icon: 'activity' },
      { href: '/audit', label: 'Audit', icon: 'shield', adminOnly: true },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { username, role } = session.user;
  const groups: NavGroup[] = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => !item.adminOnly || role === 'admin')
      .map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((group) => group.items.length > 0);

  return (
    <AppShell
      username={username}
      role={role}
      groups={groups}
      signOut={
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <Button type="submit" variant="secondary" className="w-full justify-center">
            <IconLogout className="h-4 w-4" />
            Keluar
          </Button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
