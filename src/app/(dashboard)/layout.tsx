import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { AppShell, type NavGroup, type NavIcon, type NavItem } from '@/components/AppShell';
import { Button, IconLogout } from '@/components/ui';

/**
 * Menu dikelompokkan menurut pekerjaan yang sedang dilakukan petugas, bukan
 * satu daftar rata: sebelas menu sejajar tanpa hierarki memaksa staf membaca
 * seluruh daftar tiap kali. Penyaringan `adminOnly` di sini murni supaya menu
 * yang tidak bisa dipakai tidak ikut tampil -- gerbang sesungguhnya tetap
 * `proxy.ts` (halaman) dan `requireRole('admin')` (route/server action).
 */
interface MenuItem {
  href: string;
  label: string;
  icon: NavIcon;
  adminOnly?: boolean;
  /**
   * Submenu. Dipakai ERM, yang sengaja BUKAN halaman bertab.
   *
   * Bedanya bukan gaya: tab hidup DI DALAM satu halaman, jadi seluruh isinya
   * dimuat sebagai satu rute dan jumlahnya dibatasi lebar layar. `/farmasi`
   * sudah menabrak batas itu -- delapan tab, dan yang kesembilan tidak akan
   * muat. ERM direncanakan tumbuh jauh lebih banyak dari itu (penilaian umum,
   * gigi, mata, kebidanan, dan seterusnya mengikuti 31 tabel asesmen Khanza),
   * jadi tiap submenu berdiri sebagai rutenya sendiri sejak awal.
   */
  children?: MenuItem[];
}

const NAV_GROUPS: { label: string; items: MenuItem[] }[] = [
  {
    label: 'Pemantauan',
    items: [
      { href: '/ringkasan', label: 'Ringkasan', icon: 'gauge' },
      { href: '/koneksi', label: 'Koneksi', icon: 'plug' },
      { href: '/antrean', label: 'Antrean pesan', icon: 'inbox' },
      // Arah MASUK, sementara Antrean di atasnya arah keluar. Sengaja
      // berdampingan: keduanya menjawab "apa yang lewat nomor ini", dan satu
      // gangguan sering hanya terlihat dari salah satu arahnya saja.
      { href: '/pesan-masuk', label: 'Pesan masuk', icon: 'chat', adminOnly: true },
    ],
  },
  {
    label: 'Kirim pesan',
    items: [
      { href: '/broadcast', label: 'Broadcast', icon: 'megaphone', adminOnly: true },
      { href: '/broadcast-terjadwal', label: 'Broadcast terjadwal', icon: 'clock', adminOnly: true },
      { href: '/balasan-otomatis', label: 'Balasan otomatis', icon: 'reply', adminOnly: true },
      // Satu-satunya menu di grup ini yang penerimanya BUKAN pasien melainkan
      // staf apotek. Tetap di sini karena yang dikerjakan staf sama -- menyusun
      // pesan yang keluar -- dan halamannya sendiri yang menegaskan bedanya.
      { href: '/farmasi', label: 'Farmasi', icon: 'pill', adminOnly: true },
      // Menyusul Farmasi karena bentuknya sama -- satu halaman bertab dengan
      // tujuan grup/petugasnya sendiri -- tapi ia yang PERTAMA memuat keduanya
      // sekaligus: pembatalan menuju loket, pengingat kontrol menuju pasien.
      { href: '/bpjs', label: 'BPJS', icon: 'file', adminOnly: true },
      // Satu-satunya menu di sini yang mengirim BERKAS, bukan teks. Tetap di
      // grup ini karena pekerjaan stafnya sama -- memilih penerima lalu
      // menekan kirim -- dan halamannya sendiri yang menegaskan bedanya.
      { href: '/administrasi', label: 'Administrasi', icon: 'fileSend', adminOnly: true },
      { href: '/template', label: 'Template', icon: 'file' },
    ],
  },
  {
    // Grup TERSENDIRI, bukan diselipkan ke "Kirim pesan", dan itu bukan
    // kerapian: sembilan menu di grup itu semuanya menjawab "pesan apa yang
    // keluar dari nomor RS". ERM menjawab pertanyaan yang berbeda -- "apa yang
    // belum dikerjakan di rekam medis" -- dan rekapnya cuma salah satu caranya
    // sampai ke orang. Halamannya berguna penuh bahkan saat sakelar rekapnya
    // mati, karena tabelnya sendiri sudah menjawab pertanyaannya.
    label: 'Rekam medis',
    items: [
      {
        href: '/erm',
        label: 'ERM',
        icon: 'erm',
        adminOnly: true,
        children: [{ href: '/erm/penilaian-umum', label: 'Penilaian umum', icon: 'erm', adminOnly: true }],
      },
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

  /**
   * Penyaringan peran REKURSIF, dan induk yang kehilangan seluruh anaknya ikut
   * dibuang.
   *
   * Bentuk datar yang lama cukup menyaring satu tingkat. Sejak ada submenu, dua
   * hal bisa gagal diam-diam: anak `adminOnly` yang ikut tampil karena induknya
   * lolos, dan -- kebalikannya -- induk yang tersisa sebagai tombol lipat yang
   * membuka kekosongan. Yang kedua tidak membocorkan apa pun tapi terbaca
   * sebagai menu rusak.
   *
   * Ini tetap murni supaya menu yang tidak bisa dipakai tidak ikut tampil.
   * Gerbang sesungguhnya tetap `proxy.ts` (halaman) dan `requireRole('admin')`
   * (route/server action) -- menu yang disembunyikan bukan menu yang dijaga.
   */
  const saring = (items: MenuItem[]): NavItem[] =>
    items
      .filter((item) => !item.adminOnly || role === 'admin')
      .map(({ href, label, icon, children }) => {
        const anak = children ? saring(children) : undefined;
        return { href, label, icon, ...(anak && anak.length > 0 ? { children: anak } : {}) };
      })
      .filter((item) => {
        const asli = items.find((i) => i.href === item.href);
        return !asli?.children || asli.children.length === 0 || (item.children?.length ?? 0) > 0;
      });

  const groups: NavGroup[] = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: saring(group.items),
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
