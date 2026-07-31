import { SendLog, Outbox } from '@/models';
import { PageHeader, Badge, EmptyState, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

const PAGE_SIZE = 50;

export default async function LogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const { rows, count } = await SendLog.findAndCountAll({
    order: [['id', 'DESC']],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const outboxIds = [...new Set(rows.map((r) => r.outboxId))];
  const outboxRows = outboxIds.length > 0 ? await Outbox.findAll({ where: { id: outboxIds } }) : [];
  const outboxMap = new Map(outboxRows.map((o) => [o.id, o]));

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Log pengiriman" description="Setiap percobaan kirim, termasuk yang gagal dan dicoba ulang." />
      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Waktu</th>
              <th className={cellClass}>Pemicu</th>
              <th className={cellClass}>Percobaan</th>
              <th className={cellClass}>Hasil</th>
              <th className={cellClass}>Detail</th>
              <th className={cellClass}>Durasi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const outbox = outboxMap.get(row.outboxId);
              return (
                <tr key={row.id} className={rowClass}>
                  <td className={`${cellClass} text-xs`}>{row.createdAt.toLocaleString('id-ID')}</td>
                  <td className={`${cellClass} font-mono text-xs`}>{outbox?.triggerCode ?? '-'}</td>
                  <td className={cellClass}>{row.attempt}</td>
                  <td className={cellClass}>
                    <Badge variant={row.outcome === 'sent' ? 'success' : 'danger'}>{row.outcome}</Badge>
                  </td>
                  <td className={`${cellClass} text-xs`}>{row.detail ?? '-'}</td>
                  <td className={`${cellClass} text-xs`}>{row.durationMs ? `${row.durationMs} ms` : '-'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState>Belum ada log.</EmptyState>
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
          <a className="text-primary underline underline-offset-2" href={`/log?page=${page - 1}`}>
            Sebelumnya
          </a>
        )}
        {page < totalPages && (
          <a className="text-primary underline underline-offset-2" href={`/log?page=${page + 1}`}>
            Berikutnya
          </a>
        )}
      </div>
    </div>
  );
}
