import { auth } from '@/auth';
import { KoneksiClient } from './KoneksiClient';
import { PageHeader, LinkButton, IconGauge } from '@/components/ui';

export default async function KoneksiPage() {
  const session = await auth();
  return (
    <div>
      <PageHeader
        title="Koneksi WhatsApp"
        description="Status sesi worker yang mengirim notifikasi ke pasien. Selama sesi tidak tersambung, pesan tetap menumpuk di antrean dan tidak hilang."
        actions={
          <LinkButton href="/ringkasan" variant="secondary" size="md">
            <IconGauge className="h-4 w-4" />
            Ringkasan
          </LinkButton>
        }
      />
      <KoneksiClient isAdmin={session?.user.role === 'admin'} />
    </div>
  );
}
