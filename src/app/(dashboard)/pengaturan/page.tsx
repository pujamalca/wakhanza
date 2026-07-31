import { auth } from '@/auth';
import { PengaturanClient } from './PengaturanClient';
import { PageHeader } from '@/components/ui';

export default async function PengaturanPage() {
  const session = await auth();
  return (
    <div>
      <PageHeader title="Pengaturan" description="Berlaku langsung untuk siklus polling/kirim berikutnya, tanpa perlu restart worker." />
      <PengaturanClient isAdmin={session?.user.role === 'admin'} />
    </div>
  );
}
