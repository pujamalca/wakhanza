import { auth } from '@/auth';
import { WaSession, getSettingBool, getSetting } from '@/models';
import { resendOutboxAction } from '../antrean/actions';
import { SystemStatus } from './SystemStatus';
import { InboundStatus } from './InboundStatus';
import { AlertConfigWarning } from './AlertConfigWarning';
import { VolumeChart } from './VolumeChart';
import {
  startOfDay,
  fetchStatusCounts,
  fetchQueueDepth,
  fetchDailyVolume,
  fetchTriggerBreakdown,
  fetchRecentProblems,
  fetchInboundActivity,
  NEEDS_REVIEW,
} from './queries';
import {
  PageHeader,
  Card,
  StatCard,
  Button,
  LinkButton,
  Badge,
  EmptyState,
  triggerLabel,
  outboxStatusLabel,
  IconCheck,
  IconMegaphone,
  IconInbox,
  IconAlertTriangle,
  IconPhoneAlert,
  IconActivity,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

// Pandangan operasional yang harus selalu menunjukkan keadaan SEKARANG.
// Halaman ini juga jadi tujuan pendaratan sesudah login, jadi versi ter-cache
// justru akan menyembunyikan hal yang paling perlu terlihat (worker mati).
export const dynamic = 'force-dynamic';

const CHART_DAYS = 14;
const REVIEW_WINDOW_DAYS = 7;

export default async function RingkasanPage() {
  const session = await auth();
  const isAdmin = session?.user.role === 'admin';

  const [waSession, queue, weekCounts, daily, triggers, problems, inbound, autoReplyEnabled, alertWebhookUrl] =
    await Promise.all([
      WaSession.findByPk(1),
      fetchQueueDepth(),
      fetchStatusCounts(startOfDay(REVIEW_WINDOW_DAYS - 1)),
      fetchDailyVolume(CHART_DAYS),
      fetchTriggerBreakdown(startOfDay(CHART_DAYS - 1)),
      fetchRecentProblems(5),
      fetchInboundActivity(),
      getSettingBool('autoreply.enabled', false),
      getSetting('alert.webhook_url'),
    ]);

  const today = daily[daily.length - 1]!;
  const yesterday = daily[daily.length - 2];
  // Dijumlahkan dari NEEDS_REVIEW, bukan diketik ulang: daftar itu yang juga
  // dipakai `fetchRecentProblems()` tepat di bawah, dan versi lamanya sudah
  // sempat berbeda satu status dari daftarnya (`failed` tidak ikut terhitung
  // padahal barisnya muncul di tabel di bawah -- angka KPI mengatakan nol
  // sementara daftarnya tidak kosong).
  const needsReview = NEEDS_REVIEW.reduce((total, status) => total + (weekCounts[status] ?? 0), 0);
  const noContact = weekCounts.skipped_no_contact ?? 0;
  const triggerMax = Math.max(...triggers.map((t) => t.total), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ringkasan"
        description="Keadaan gateway saat ini. Semua angka dihitung menurut hari pesan masuk antrean, bukan hari pesan berhasil terkirim."
        actions={
          <>
            <LinkButton href="/antrean" variant="secondary" size="md">
              <IconInbox className="h-4 w-4" />
              Antrean pesan
            </LinkButton>
            {isAdmin && (
              <LinkButton href="/broadcast" variant="primary" size="md">
                <IconMegaphone className="h-4 w-4" />
                Kirim broadcast
              </LinkButton>
            )}
          </>
        }
      />

      <SystemStatus
        status={waSession?.status ?? 'disconnected'}
        phoneNumber={waSession?.phoneNumber ?? null}
        heartbeatAt={waSession?.heartbeatAt ?? null}
        lastError={waSession?.lastError ?? null}
      />

      {/* Tepat di bawah SystemStatus, dan itu disengaja: keduanya menjawab
          "apakah sistemnya masih bekerja" -- yang satu arah keluar, yang satu
          arah masuk. Semua angka di bawahnya mengukur arah keluar saja, dan
          itulah kenapa bug LID bisa berjam-jam tanpa satu pun indikator
          berubah. */}
      <InboundStatus inbound={inbound} autoReplyEnabled={autoReplyEnabled} />

      {/* Operator tidak punya akses ke /pengaturan (admin-only), jadi
          menampilkannya kepada mereka cuma menunjuk masalah yang tidak bisa
          mereka selesaikan -- pola yang sama dengan tombol Kirim broadcast
          di atas. */}
      {isAdmin && <AlertConfigWarning webhookConfigured={Boolean(alertWebhookUrl)} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Terkirim hari ini"
          value={today.sent}
          icon={<IconCheck className="h-5 w-5" />}
          tone={today.sent > 0 ? 'success' : 'default'}
          delta={yesterday ? { value: today.sent - yesterday.sent, label: 'vs kemarin' } : undefined}
          trend={daily.map((d) => d.sent)}
          href="/antrean?status=sent"
        />
        <StatCard
          label="Menunggu kirim"
          value={queue.waiting}
          icon={<IconActivity className="h-5 w-5" />}
          hint={
            queue.scheduledLater > 0
              ? `${queue.scheduledLater} di antaranya baru dijadwalkan nanti (jam tenang)`
              : 'Tidak ada yang tertahan jam tenang'
          }
          href="/antrean?status=pending"
        />
        <StatCard
          label={`Perlu ditinjau (${REVIEW_WINDOW_DAYS} hari)`}
          value={needsReview}
          icon={<IconAlertTriangle className="h-5 w-5" />}
          tone={needsReview > 0 ? 'danger' : 'default'}
          hint="Sudah berhenti dicoba ulang sendiri"
          href="/antrean?status=failed_permanent"
        />
        <StatCard
          label={`Tanpa nomor (${REVIEW_WINDOW_DAYS} hari)`}
          value={noContact}
          icon={<IconPhoneAlert className="h-5 w-5" />}
          tone={noContact > 0 ? 'warning' : 'default'}
          hint="Pasien tidak bisa dihubungi sama sekali"
          href="/nomor-bermasalah"
        />
      </div>

      {/* Grafik memakai lebar penuh: 14 kolom yang diperas ke dua per tiga
          halaman membuat batangnya berdempetan, sementara panel di sebelahnya
          jauh lebih tinggi sehingga menyisakan lubang kosong di bawah grafik. */}
      <VolumeChart days={daily} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="font-medium">Per jenis pesan</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{CHART_DAYS} hari terakhir, termasuk yang dilewati.</p>

          {triggers.length === 0 ? (
            <EmptyState>Belum ada pesan.</EmptyState>
          ) : (
            <ul className="mt-4 space-y-3">
              {triggers.map((t) => (
                <li key={t.code}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate" title={t.code}>
                      {triggerLabel(t.code)}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <span className="text-xs text-muted-foreground">{t.sent} terkirim dari</span>{' '}
                      <span className="font-medium">{t.total}</span>
                    </span>
                  </div>
                  {/* Meter satu warna: isian dan relnya dari ramp yang sama,
                      supaya besarannya terbaca di seluruh lebar bar. */}
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(t.total / triggerMax) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="lg:col-span-2">
          <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">Perlu ditinjau</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pesan yang sudah kehabisan percobaan otomatis. Kirim ulang setelah penyebabnya diperbaiki.
              </p>
            </div>
            <LinkButton href="/antrean?status=failed_permanent" variant="ghost">
              Lihat semua
            </LinkButton>
          </div>

          {problems.length === 0 ? (
            <EmptyState icon={<IconCheck className="h-5 w-5" />} title="Tidak ada yang perlu ditinjau">
              Semua pesan terkirim atau masih dalam percobaan otomatis.
            </EmptyState>
          ) : (
            <div className={tableWrapperClass}>
              <table className="w-full text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className={cellClass}>Jenis</th>
                    <th className={cellClass}>No. RM</th>
                    <th className={cellClass}>Status</th>
                    <th className={`${cellClass} hidden md:table-cell`}>Penyebab</th>
                    <th className={`${cellClass} hidden sm:table-cell`}>Kejadian</th>
                    <th className={cellClass}></th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((row) => (
                    <tr key={row.id} className={rowClass}>
                      <td className={cellClass} title={row.triggerCode}>
                        {triggerLabel(row.triggerCode)}
                      </td>
                      <td className={`${cellClass} tabular-nums`}>{row.noRkmMedis ?? '-'}</td>
                      <td className={cellClass}>
                        <Badge variant="danger">{outboxStatusLabel(row.status)}</Badge>
                      </td>
                      <td
                        className={`${cellClass} hidden max-w-xs truncate text-xs text-muted-foreground md:table-cell`}
                        title={row.lastError ?? ''}
                      >
                        {row.lastError ?? '-'}
                      </td>
                      <td className={`${cellClass} hidden whitespace-nowrap text-xs sm:table-cell`}>
                        {row.eventAt.toLocaleString('id-ID')}
                      </td>
                      <td className={cellClass}>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </Card>
        </div>
      </div>
    </div>
  );
}
