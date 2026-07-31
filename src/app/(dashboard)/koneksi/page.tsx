import { auth } from '@/auth';
import { KoneksiClient } from './KoneksiClient';
import { PageHeader } from '@/components/ui';

export default async function KoneksiPage() {
  const session = await auth();
  return (
    <div>
      <PageHeader title="Koneksi WhatsApp" description="Status sesi worker yang mengirim notifikasi ke pasien." />
      <KoneksiClient isAdmin={session?.user.role === 'admin'} />
    </div>
  );
}
