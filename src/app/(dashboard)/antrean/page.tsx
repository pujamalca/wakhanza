import { Outbox, type OutboxStatus } from '@/models';
import { resendOutboxAction } from './actions';
import { PageHeader, FilterChip, Badge, Button, EmptyState, outboxStatusVariant, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

const PAGE_SIZE = 50;
const STATUSES: OutboxStatus[] = [
  'pending',
  'sending',
  'sent',
  'failed',
  'failed_permanent',
  'skipped_no_contact',
  'skipped_opt_out',
  'expired',
];
const RESENDABLE: OutboxStatus[] = ['failed', 'failed_permanent', 'expired'];

export default async function AntreanPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const where = status && STATUSES.includes(status as OutboxStatus) ? { status: status as OutboxStatus } : {};

  const { rows, count } = await Outbox.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Antrean pesan" description="Semua pesan yang pernah masuk antrean kirim -- termasuk yang sudah terkirim, gagal, atau dilewati." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip href="/antrean" active={!status}>
          Semua
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} href={`/antrean?status=${s}`} active={status === s}>
            {s}
          </FilterChip>
        ))}
      </div>

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Pemicu</th>
              <th className={cellClass}>No. RM</th>
              <th className={cellClass}>Nomor</th>
              <th className={cellClass}>Isi</th>
              <th className={cellClass}>Status</th>
              <th className={cellClass}>Kejadian</th>
              <th className={cellClass}>Terkirim</th>
              <th className={cellClass}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass}>
                <td className={`${cellClass} font-mono text-xs`}>{row.triggerCode}</td>
                <td className={cellClass}>{row.noRkmMedis ?? '-'}</td>
                <td className={cellClass}>{row.phoneE164 ?? '-'}</td>
                <td className={`${cellClass} max-w-xs truncate`} title={row.body}>
                  {row.body}
                </td>
                <td className={cellClass}>
                  <Badge variant={outboxStatusVariant(row.status)}>{row.status}</Badge>
                </td>
                <td className={`${cellClass} text-xs`}>{row.eventAt.toLocaleString('id-ID')}</td>
                <td className={`${cellClass} text-xs`}>{row.sentAt ? row.sentAt.toLocaleString('id-ID') : '-'}</td>
                <td className={cellClass}>
                  {RESENDABLE.includes(row.status) && (
                    <form
                      action={async () => {
                        'use server';
                        await resendOutboxAction(row.id);
                      }}
                    >
                      <Button type="submit" variant="secondary" size="xs">
                        Kirim ulang
                      </Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState>Tidak ada baris.</EmptyState>
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
          <a className="text-primary underline underline-offset-2" href={`/antrean?${status ? `status=${status}&` : ''}page=${page - 1}`}>
            Sebelumnya
          </a>
        )}
        {page < totalPages && (
          <a className="text-primary underline underline-offset-2" href={`/antrean?${status ? `status=${status}&` : ''}page=${page + 1}`}>
            Berikutnya
          </a>
        )}
      </div>
    </div>
  );
}
