import { Outbox, type OutboxStatus } from '@/models';
import { resendOutboxAction } from './actions';
import {
  PageHeader,
  FilterChip,
  Badge,
  Button,
  EmptyState,
  Pagination,
  outboxStatusVariant,
  outboxStatusLabel,
  OUTBOX_STATUS_LABEL,
  OUTBOX_STATUS_HELP,
  triggerLabel,
  IconInbox,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

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

  const active = status && STATUSES.includes(status as OutboxStatus) ? (status as OutboxStatus) : null;
  const where = active ? { status: active } : {};

  const { rows, count } = await Outbox.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hrefFor = (p: number) => `/antrean?${active ? `status=${active}&` : ''}page=${p}`;

  return (
    <div>
      <PageHeader
        title="Antrean pesan"
        description="Semua pesan yang pernah masuk antrean kirim -- termasuk yang sudah terkirim, gagal, atau sengaja dilewati."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip href="/antrean" active={!active}>
          Semua
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} href={`/antrean?status=${s}`} active={active === s}>
            {OUTBOX_STATUS_LABEL[s]}
          </FilterChip>
        ))}
      </div>

      {/* Saat satu status dipilih, jelaskan artinya sekali di sini alih-alih
          mengandalkan petugas menebak dari nama statusnya. */}
      {active && <p className="mb-4 text-sm text-muted-foreground">{OUTBOX_STATUS_HELP[active]}</p>}

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Jenis pesan</th>
              <th className={cellClass}>No. RM</th>
              <th className={`${cellClass} hidden md:table-cell`}>Nomor</th>
              <th className={`${cellClass} hidden lg:table-cell`}>Isi</th>
              <th className={cellClass}>Status</th>
              <th className={`${cellClass} hidden sm:table-cell`}>Kejadian</th>
              <th className={`${cellClass} hidden xl:table-cell`}>Terkirim</th>
              <th className={cellClass}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass}>
                {/* Label manusia di depan, kode mesin tetap tersedia lewat
                    tooltip -- tiket dukungan dan baris log memakai kodenya. */}
                <td className={cellClass} title={row.triggerCode}>
                  {triggerLabel(row.triggerCode)}
                </td>
                <td className={`${cellClass} tabular-nums`}>{row.noRkmMedis ?? '-'}</td>
                <td className={`${cellClass} hidden tabular-nums md:table-cell`}>{row.phoneE164 ?? '-'}</td>
                <td className={`${cellClass} hidden max-w-xs truncate lg:table-cell`} title={row.body}>
                  {row.body}
                </td>
                <td className={cellClass}>
                  <Badge variant={outboxStatusVariant(row.status)}>{outboxStatusLabel(row.status)}</Badge>
                </td>
                <td className={`${cellClass} hidden whitespace-nowrap text-xs sm:table-cell`}>
                  {row.eventAt.toLocaleString('id-ID')}
                </td>
                <td className={`${cellClass} hidden whitespace-nowrap text-xs xl:table-cell`}>
                  {row.sentAt ? row.sentAt.toLocaleString('id-ID') : '-'}
                </td>
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
                  <EmptyState
                    icon={<IconInbox className="h-5 w-5" />}
                    title={active ? `Tidak ada pesan berstatus "${OUTBOX_STATUS_LABEL[active]}"` : 'Antrean masih kosong'}
                  >
                    {active
                      ? 'Coba pilih status lain, atau lihat Semua.'
                      : 'Pesan muncul di sini segera setelah worker mendeteksi kejadiannya di Khanza.'}
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} count={count} hrefFor={hrefFor} unit="pesan" />
    </div>
  );
}
