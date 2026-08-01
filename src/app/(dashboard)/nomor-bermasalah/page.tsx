import { QueryTypes } from 'sequelize';
import { PatientContact } from '@/models';
import { sik } from '@/db/sik';
import { CorrectionForm } from './CorrectionForm';
import { PageHeader, FilterChip, Input, Button, LinkButton, EmptyState, IconSearch, IconCheck, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

const REASON_LABELS: Record<string, string> = {
  empty: 'Kosong',
  too_short: 'Terlalu pendek',
  not_mobile: 'Bukan nomor seluler',
  unparseable: 'Tidak terbaca',
};

async function namesFor(rmList: string[]): Promise<Map<string, string>> {
  if (rmList.length === 0) return new Map();
  const rows = await sik.query<{ no_rkm_medis: string; nm_pasien: string | null }>(
    'SELECT no_rkm_medis, nm_pasien FROM pasien WHERE no_rkm_medis IN (:rmList)',
    { replacements: { rmList }, type: QueryTypes.SELECT },
  );
  return new Map(rows.map((r) => [r.no_rkm_medis, r.nm_pasien ?? '(tanpa nama)']));
}

export default async function NomorBermasalahPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; reason?: string }>;
}) {
  const { q, reason } = await searchParams;

  let rows: PatientContact[];
  if (q && q.trim()) {
    const term = q.trim();
    const matches = await sik.query<{ no_rkm_medis: string }>(
      'SELECT no_rkm_medis FROM pasien WHERE nm_pasien LIKE :term OR no_rkm_medis = :exact LIMIT 50',
      { replacements: { term: `%${term}%`, exact: term }, type: QueryTypes.SELECT },
    );
    const rmList = matches.map((m) => m.no_rkm_medis);
    rows =
      rmList.length > 0
        ? await PatientContact.findAll({ where: { noRkmMedis: rmList }, order: [['checkedAt', 'DESC']] })
        : [];
  } else {
    const where: Record<string, unknown> = { phoneE164: null };
    if (reason) where.reason = reason;
    rows = await PatientContact.findAll({ where, order: [['checkedAt', 'DESC']], limit: 100 });
  }

  const nameMap = await namesFor(rows.map((r) => r.noRkmMedis));

  return (
    <div>
      <PageHeader
        title="Nomor bermasalah"
        description="Nomor yang gagal dinormalisasi otomatis. Koreksi di sini tidak pernah mengubah data SIMRS Khanza."
      />

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Cari nama atau no. RM..." className="w-64" />
        <Button type="submit" variant="secondary" size="md">
          Cari
        </Button>
        {q && (
          <LinkButton href="/nomor-bermasalah" variant="secondary" size="md">
            Reset
          </LinkButton>
        )}
      </form>

      {!q && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <FilterChip href="/nomor-bermasalah" active={!reason}>
            Semua
          </FilterChip>
          {Object.entries(REASON_LABELS).map(([key, label]) => (
            <FilterChip key={key} href={`/nomor-bermasalah?reason=${key}`} active={reason === key}>
              {label}
            </FilterChip>
          ))}
        </div>
      )}

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>No. RM</th>
              <th className={cellClass}>Nama</th>
              <th className={cellClass}>Nilai asli</th>
              <th className={cellClass}>Sumber</th>
              <th className={cellClass}>Alasan</th>
              <th className={cellClass}>Koreksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.noRkmMedis} className={rowClass}>
                <td className={`${cellClass} font-mono text-xs`}>{row.noRkmMedis}</td>
                <td className={cellClass}>{nameMap.get(row.noRkmMedis) ?? '-'}</td>
                <td className={`${cellClass} text-xs`}>{row.rawValue ?? '(kosong)'}</td>
                <td className={`${cellClass} text-xs`}>{row.source}</td>
                <td className={`${cellClass} text-xs`}>{row.reason ? (REASON_LABELS[row.reason] ?? row.reason) : '-'}</td>
                <td className={cellClass}>
                  <CorrectionForm noRkmMedis={row.noRkmMedis} currentValue={row.phoneE164} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  {q ? (
                    <EmptyState icon={<IconSearch className="h-5 w-5" />} title={`Tidak ada hasil untuk "${q}"`}>
                      Pencarian mencakup nama pasien dan nomor rekam medis. Pasien yang nomornya sudah benar memang tidak muncul
                      di halaman ini.
                    </EmptyState>
                  ) : (
                    <EmptyState icon={<IconCheck className="h-5 w-5" />} title="Tidak ada nomor bermasalah">
                      Semua pasien yang sudah diproses punya nomor yang bisa dipakai.
                    </EmptyState>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
