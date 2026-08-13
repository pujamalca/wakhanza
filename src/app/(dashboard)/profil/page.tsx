import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppUser, AuditLog } from '@/models';
import { PERAN_LABEL, PERAN_KETERANGAN, type AppUserRole } from '@/core/userPolicy';
import { PageHeader, Card, Badge } from '@/components/ui';
import { FormNama, FormSandi } from './ProfilForms';

/**
 * Profil dibaca dari DATABASE, bukan dari sesi.
 *
 * Sesi ini JWT (TECH_STACK.md), jadi isinya beku sejak login: nama dan peran di
 * dalamnya adalah keadaan berjam-jam lalu. Menampilkannya dari sana membuat
 * halaman ini berbohong tepat sesudah penggunanya mengubah namanya sendiri --
 * satu-satunya tempat yang paling wajib benar.
 */
export default async function ProfilPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = await AppUser.findByPk(Number(session.user.id));
  if (!user) redirect('/login');

  const loginTerakhir = await AuditLog.findAll({
    where: { actor: user.username, action: 'login_success' },
    order: [['id', 'DESC']],
    limit: 2,
    attributes: ['createdAt'],
  });
  // Baris paling baru adalah sesi yang SEDANG berjalan, jadi yang berarti
  // sebagai "login sebelumnya" adalah baris kedua. Menampilkan yang pertama
  // hanya memberi tahu orang bahwa ia sedang login -- yang sudah ia ketahui.
  const sebelumnya = loginTerakhir[1]?.createdAt ?? null;

  return (
    <div>
      <PageHeader title="Profil saya" description="Nama tampilan dan kata sandi akun Anda sendiri." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-title">Akun</h2>
          <dl className="space-y-2 text-sm">
            <Baris label="Nama pengguna">
              <span className="font-mono text-xs">{user.username}</span>
              {/* Kenapa tidak bisa diubah dijelaskan di sini, bukan disembunyikan:
                  kotak yang tidak ada tanpa penjelasan terbaca sebagai fitur
                  yang belum dibuat, lalu ditanyakan berulang kali. */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tidak bisa diubah &mdash; nama ini dipakai sebagai penanda Anda di seluruh jejak audit, dan menggantinya
                akan memutus riwayat lama dari pemiliknya.
              </p>
            </Baris>
            <Baris label="Peran">
              <Badge variant={user.role === 'admin' ? 'success' : 'neutral'}>{PERAN_LABEL[user.role as AppUserRole]}</Badge>
              <p className="mt-0.5 text-xs text-muted-foreground">{PERAN_KETERANGAN[user.role as AppUserRole]}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Hanya admin yang bisa mengubah peran, termasuk peran Anda.</p>
            </Baris>
            <Baris label="Akun dibuat">
              <span className="text-xs">{user.createdAt.toLocaleString('id-ID')}</span>
            </Baris>
            <Baris label="Login sebelumnya">
              <span className="text-xs">
                {sebelumnya ? sebelumnya.toLocaleString('id-ID') : 'belum ada catatan login lain'}
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Kalau waktu ini tidak Anda kenali, segera ganti kata sandi dan beri tahu admin.
              </p>
            </Baris>
          </dl>
        </Card>

        <FormNama namaSekarang={user.name} />
      </div>

      <div className="mt-4">
        <FormSandi />
      </div>
    </div>
  );
}

function Baris({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t pt-2 first:border-t-0 first:pt-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
