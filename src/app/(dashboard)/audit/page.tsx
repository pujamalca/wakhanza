import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AuditLog } from '@/models';
import { PageHeader, EmptyState, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi itu UI saja -- akses
  // langsung lewat URL harus tetap ditolak di server (IMPLEMENTATION_PLAN Fase 3 DoD).
  if (session?.user.role !== 'admin') redirect('/koneksi');

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const { rows, count } = await AuditLog.findAndCountAll({
    order: [['id', 'DESC']],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Audit" description="Riwayat tindakan petugas. Tidak dapat dihapus atau diubah (ARCHITECTURE §9.5)." />
      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Waktu</th>
              <th className={cellClass}>Pelaku</th>
              <th className={cellClass}>Tindakan</th>
              <th className={cellClass}>Target</th>
              <th className={cellClass}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass}>
                <td className={`${cellClass} text-xs`}>{row.createdAt.toLocaleString('id-ID')}</td>
                <td className={cellClass}>{row.actor}</td>
                <td className={`${cellClass} font-mono text-xs`}>{row.action}</td>
                <td className={`${cellClass} text-xs`}>{row.target ?? '-'}</td>
                <td className={`${cellClass} text-xs`}>{row.detail ?? '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState>Belum ada riwayat.</EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Halaman {page} / {totalPages} ({count} baris)
        </span>
        {page > 1 && (
          <a className="text-primary underline underline-offset-2" href={`/audit?page=${page - 1}`}>
            Sebelumnya
          </a>
        )}
        {page < totalPages && (
          <a className="text-primary underline underline-offset-2" href={`/audit?page=${page + 1}`}>
            Berikutnya
          </a>
        )}
      </div>
    </div>
  );
}
