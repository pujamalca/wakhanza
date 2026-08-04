import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { daftarPengguna, hitungAdminAktif, hitungPengguna } from '@/lib/userAdmin';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { PageHeader, Pagination } from '@/components/ui';
import { UserTable } from './UserTable';

export default async function PenggunaPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat URL
  // harus tetap ditolak di server (pola sama seperti /audit dan /broadcast).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { page: pageParam } = await searchParams;
  // `hitungAdminAktif()` sengaja TIDAK ikut dipersempit ke halaman ini -- lihat
  // alasannya di lib/userAdmin.ts. Peringatan "tinggal satu admin" dan pagar
  // penonaktifan keduanya bergantung padanya.
  const [jumlah, adminAktif] = await Promise.all([hitungPengguna(), hitungAdminAktif()]);
  const p = hitungPaginasi(bacaHalaman(pageParam), jumlah, UKURAN_HALAMAN.konfigurasi);
  const users = await daftarPengguna({ limit: p.limit, offset: p.offset });

  return (
    <div>
      <PageHeader
        title="Pengguna"
        description="Akun yang bisa masuk ke dashboard ini. Peran menentukan halaman mana yang bisa dibuka."
      />

      {/* Ditampilkan justru saat keadaannya masih baik-baik saja. Kalau baru
          muncul setelah tinggal satu admin, ia menjelaskan penolakan alih-alih
          mencegah orang sampai ke sana. */}
      {adminAktif <= 1 && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
          Hanya ada <span className="font-medium">satu admin aktif</span>. Kalau akun itu terkunci atau sandinya hilang,
          tidak ada seorang pun yang bisa membuka halaman pengaturan, broadcast, audit, dan halaman ini &mdash; satu-satunya
          jalan kembali adalah lewat baris perintah di server. Sebaiknya buat satu admin cadangan.
        </div>
      )}

      <UserTable
        usernameSaya={session.user.username}
        users={users.map((u) => ({
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          terkunci: u.terkunci,
          // Diformat di server: `toLocaleString` di komponen klien memberi hasil
          // berbeda antara render server dan klien, dan React melaporkannya
          // sebagai hydration mismatch.
          createdAt: u.createdAt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
        }))}
      />

      <Pagination
        page={p.halaman}
        totalPages={p.totalHalaman}
        count={p.jumlah}
        hrefFor={(n) => hrefHalaman('/pengguna', {}, n)}
        unit="akun"
      />

      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Menonaktifkan maupun menghapus tidak memutus sesi yang sedang
          berjalan.</span> Sesi dashboard tidak disimpan di database, jadi tidak ada tempat untuk mencabutnya di tengah
          jalan. Akun yang dinonaktifkan atau dihapus ditolak pada login BERIKUTNYA, sementara jendela yang sudah
          terbuka tetap bisa dipakai sampai sesinya kedaluwarsa. Untuk memutus seseorang saat itu juga, hubungi
          pengembang &mdash; caranya membatalkan sesi semua orang sekaligus.
        </p>
        <p>
          <span className="font-medium text-foreground">Menurunkan peran juga baru berlaku pada login berikutnya</span>,
          karena alasan yang sama. Admin yang baru diturunkan jadi operator masih bisa membuka halaman admin sampai
          sesinya habis.
        </p>
      </div>
    </div>
  );
}
