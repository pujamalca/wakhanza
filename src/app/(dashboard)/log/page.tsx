import { SendLog, Outbox } from '@/models';
import {
  PageHeader,
  Badge,
  EmptyState,
  Pagination,
  triggerLabel,
  SEND_OUTCOME_LABEL,
  IconActivity,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

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
      <PageHeader
        title="Log pengiriman"
        description="Setiap percobaan kirim, termasuk yang gagal lalu dicoba ulang. Satu pesan bisa punya beberapa baris di sini."
      />

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Waktu</th>
              <th className={cellClass}>Jenis pesan</th>
              <th className={`${cellClass} hidden sm:table-cell`}>Percobaan</th>
              <th className={cellClass}>Hasil</th>
              <th className={`${cellClass} hidden md:table-cell`}>Detail</th>
              <th className={`${cellClass} hidden lg:table-cell`}>Durasi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const outbox = outboxMap.get(row.outboxId);
              return (
                <tr key={row.id} className={rowClass}>
                  <td className={`${cellClass} whitespace-nowrap text-xs`}>{row.createdAt.toLocaleString('id-ID')}</td>
                  <td className={cellClass} title={outbox?.triggerCode ?? ''}>
                    {outbox ? triggerLabel(outbox.triggerCode) : '-'}
                  </td>
                  <td className={`${cellClass} hidden tabular-nums sm:table-cell`}>ke-{row.attempt}</td>
                  <td className={cellClass}>
                    <Badge variant={row.outcome === 'sent' ? 'success' : 'danger'}>{SEND_OUTCOME_LABEL[row.outcome]}</Badge>
                  </td>
                  <td className={`${cellClass} hidden max-w-md truncate text-xs text-muted-foreground md:table-cell`} title={row.detail ?? ''}>
                    {row.detail ?? '-'}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap tabular-nums text-xs lg:table-cell`}>
                    {row.durationMs ? `${row.durationMs} ms` : '-'}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState icon={<IconActivity className="h-5 w-5" />} title="Belum ada percobaan kirim">
                    Baris pertama muncul begitu worker mengirim pesan pertamanya.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} count={count} hrefFor={(p) => `/log?page=${p}`} unit="percobaan" />
    </div>
  );
}
