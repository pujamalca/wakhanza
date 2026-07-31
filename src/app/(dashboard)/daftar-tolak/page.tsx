import { auth } from '@/auth';
import { OptOut } from '@/models';
import { AddOptOutForm } from './AddOptOutForm';
import { removeOptOutAction } from './actions';
import { PageHeader, Button, EmptyState, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

export default async function DaftarTolakPage() {
  const session = await auth();
  const isAdmin = session?.user.role === 'admin';

  const rows = await OptOut.findAll({ order: [['createdAt', 'DESC']], limit: 200 });

  return (
    <div>
      <PageHeader
        title="Daftar tolak"
        description="Nomor yang berhenti berlangganan (F5.5). Seluruh pengiriman berikutnya ke nomor ini dilewati."
      />

      {isAdmin && <AddOptOutForm />}

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Nomor</th>
              <th className={cellClass}>Sumber</th>
              <th className={cellClass}>Catatan</th>
              <th className={cellClass}>Ditambahkan</th>
              {isAdmin && <th className={cellClass}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.phoneE164} className={rowClass}>
                <td className={`${cellClass} font-mono text-xs`}>{row.phoneE164}</td>
                <td className={`${cellClass} text-xs`}>{row.source}</td>
                <td className={`${cellClass} text-xs`}>{row.note ?? '-'}</td>
                <td className={`${cellClass} text-xs`}>{row.createdAt.toLocaleString('id-ID')}</td>
                {isAdmin && (
                  <td className={cellClass}>
                    <form
                      action={async () => {
                        'use server';
                        await removeOptOutAction(row.phoneE164);
                      }}
                    >
                      <Button type="submit" variant="secondary" size="xs">
                        Hapus
                      </Button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4}>
                  <EmptyState>Belum ada nomor yang berhenti berlangganan.</EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
