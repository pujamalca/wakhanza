import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchPatientSegment, fetchRegionOptions, fetchPaymentOptions } from '@/khanza/pasienSegment';
import { getHospitalIdentity, formatSqlDate } from '@/khanza/common';
import { identityVars } from '@/worker/pipeline';
import { Outbox, BroadcastCampaign } from '@/models';
import { parseFilters, DATE_PRESETS, type RawFilterInput } from './filters';
import { summarizeSegment } from './segment';
import { ComposeForm } from './ComposeForm';
import { PageHeader, Card, cardClassName, Button, Input, CheckboxList, Badge, EmptyState, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

interface SearchParams extends RawFilterInput {
  sent?: string;
}

function toSet(value: string | string[] | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(Array.isArray(value) ? value : [value]);
}

export default async function BroadcastPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat
  // URL harus tetap ditolak di server (pola sama seperti /audit).
  if (session?.user.role !== 'admin') redirect('/koneksi');

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const selectedKab = toSet(sp.kab);
  const selectedKec = toSet(sp.kec);
  const selectedPj = toSet(sp.pj);

  const [regionOptions, paymentOptions, recipients, identity] = await Promise.all([
    fetchRegionOptions(),
    fetchPaymentOptions(),
    fetchPatientSegment(filters),
    getHospitalIdentity(),
  ]);
  const summary = await summarizeSegment(recipients);

  let sentCampaign: { id: number; recipientCount: number; createdAt: Date; counts: Record<string, number> } | null = null;
  if (sp.sent) {
    const campaign = await BroadcastCampaign.findByPk(Number(sp.sent));
    if (campaign) {
      const outboxRows = await Outbox.findAll({ where: { campaignId: campaign.id }, attributes: ['status'] });
      const counts: Record<string, number> = {};
      for (const o of outboxRows) counts[o.status] = (counts[o.status] ?? 0) + 1;
      sentCampaign = { id: campaign.id, recipientCount: campaign.recipientCount, createdAt: campaign.createdAt, counts };
    }
  }

  const firstPreview = summary.preview[0];
  const sampleVars = firstPreview
    ? { ...identityVars(identity), nama_pasien: firstPreview.row.nm_pasien ?? '', no_rm: firstPreview.row.no_rkm_medis }
    : null;

  return (
    <div>
      <PageHeader
        title="Broadcast"
        description="Pilih segmen pasien dari riwayat kunjungan (tanggal, wilayah, cara bayar, nama/no. RM/no. pendaftaran), lalu kirim WhatsApp ke semuanya sekaligus. Tetap menghormati jam tenang, kuota per jam, dan daftar berhenti yang sama seperti notifikasi otomatis -- lihat ARCHITECTURE §2/§5/§6."
      />

      {sentCampaign && (
        <div className="mb-4 rounded-md border border-green-600/30 bg-green-50 p-3 text-sm dark:border-green-500/30 dark:bg-green-950">
          Kampanye #{sentCampaign.id} dibuat untuk {sentCampaign.recipientCount} pasien pada{' '}
          {sentCampaign.createdAt.toLocaleString('id-ID')}. Status saat ini:{' '}
          {Object.entries(sentCampaign.counts)
            .map(([status, n]) => `${status}=${n}`)
            .join(', ') || 'belum ada baris'}
          . Rincian lengkap ada di halaman Log.
        </div>
      )}

      <form method="get" className={`mb-4 space-y-3 ${cardClassName}`}>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Rentang kunjungan</p>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(DATE_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="submit"
                name="preset"
                value={key}
                className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {preset.label}
              </button>
            ))}
            <span className="text-xs text-muted-foreground">atau</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={formatSqlDate(filters.dateFrom)}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            />
            <span className="text-xs">s/d</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={formatSqlDate(filters.dateTo)}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Cari nama, no. RM (tabel pasien), atau no. pendaftaran (tabel reg_periksa) -- kosong = semua
          </p>
          <Input
            name="cari"
            defaultValue={filters.cari ?? ''}
            placeholder="mis. Budi, TESTWA00001, atau 2026/07/31/000001..."
            className="w-full sm:w-1/2"
            fieldSize="sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Kabupaten/kota (kosong = semua)</p>
            <CheckboxList name="kab" options={regionOptions.kabupaten} defaultSelected={[...selectedKab]} searchPlaceholder="Cari kabupaten/kota..." />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Kecamatan (kosong = semua)</p>
            <CheckboxList name="kec" options={regionOptions.kecamatan} defaultSelected={[...selectedKec]} searchPlaceholder="Cari kecamatan..." />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Cara bayar (kosong = semua)</p>
          <div className="sm:w-1/2">
            <CheckboxList name="pj" options={paymentOptions} defaultSelected={[...selectedPj]} />
          </div>
        </div>

        <Button type="submit" variant="secondary" size="sm">
          Terapkan filter
        </Button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Cocok" value={summary.total} />
        <Stat label="Bisa dihubungi" value={summary.reachable} />
        <Stat label="Tanpa nomor valid" value={summary.noContact} />
        <Stat label="Sudah berhenti" value={summary.optedOut} />
        <Stat label="Layanan sensitif" value={summary.sensitive} />
      </div>

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>No. RM</th>
              <th className={cellClass}>Nama</th>
              <th className={cellClass}>Wilayah</th>
              <th className={cellClass}>Cara bayar</th>
              <th className={cellClass}>Kunjungan terakhir</th>
              <th className={cellClass}>Nomor</th>
            </tr>
          </thead>
          <tbody>
            {summary.preview.map(({ row, phoneE164, safe }) => (
              <tr key={row.no_rkm_medis} className={rowClass}>
                <td className={`${cellClass} font-mono text-xs`}>{row.no_rkm_medis}</td>
                <td className={cellClass}>{row.nm_pasien ?? '-'}</td>
                <td className={`${cellClass} text-xs`}>{[row.nm_kec, row.nm_kab].filter(Boolean).join(', ') || '-'}</td>
                <td className={`${cellClass} text-xs`}>{row.png_jawab ?? '-'}</td>
                <td className={`${cellClass} text-xs`}>{row.tgl_kunjungan_terakhir}</td>
                <td className={`${cellClass} text-xs`}>
                  {phoneE164 ?? <span className="text-destructive">tanpa nomor</span>}
                  {!safe && (
                    <Badge variant="warning" className="ml-1">
                      privasi
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
            {summary.preview.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState>Tidak ada pasien yang cocok dengan filter ini.</EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {summary.total > summary.preview.length && (
        <p className="mt-1 text-xs text-muted-foreground">
          Menampilkan {summary.preview.length} dari {summary.total} pasien cocok.
        </p>
      )}

      <ComposeForm
        hiddenFilters={{
          dateFrom: [formatSqlDate(filters.dateFrom)],
          dateTo: [formatSqlDate(filters.dateTo)],
          kab: [...selectedKab],
          kec: [...selectedKec],
          pj: [...selectedPj],
          cari: filters.cari ? [filters.cari] : [],
        }}
        sampleVars={sampleVars}
        total={summary.total}
        reachable={summary.reachable}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}
