import { QueryTypes, fn, col } from 'sequelize';
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

/**
 * Urutan chip: yang BISA dikerjakan petugas dari mejanya lebih dulu.
 *
 * Sesudah `npm run scan:contacts` mengisi seluruh pasien sekaligus, sebaran
 * nyatanya sangat timpang -- di database ini 3.166 dari 3.284 baris beralasan
 * `empty`, yaitu pasien yang di Khanza memang tidak punya nomor sama sekali.
 * Itu bukan salah ketik yang bisa dibetulkan sambil menatap layar; nomornya
 * harus diminta saat pasien datang lagi. Menaruhnya lebih dulu (urutan abjad
 * kunci enum) mengubur 118 baris yang justru bisa langsung diperbaiki.
 */
const REASON_ORDER = ['too_short', 'not_mobile', 'unparseable', 'empty'] as const;

const JUMLAH_PER_HALAMAN = 100;

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

  // Dihitung lewat satu query GROUP BY, bukan satu COUNT per alasan: angkanya
  // dipakai untuk menunjukkan sebaran yang timpang itu langsung di chip-nya,
  // supaya petugas tahu mana yang sepadan dibuka tanpa harus mencobanya satu-satu.
  const reasonCounts = new Map<string, number>();
  let totalBermasalah = 0;
  if (!q?.trim()) {
    const counts = await PatientContact.findAll({
      attributes: ['reason', [fn('COUNT', col('no_rkm_medis')), 'n']],
      where: { phoneE164: null },
      group: ['reason'],
      raw: true,
    });
    for (const c of counts as unknown as { reason: string | null; n: number | string }[]) {
      const n = Number(c.n) || 0;
      totalBermasalah += n;
      if (c.reason) reasonCounts.set(c.reason, n);
    }
  }

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
    rows = await PatientContact.findAll({ where, order: [['checkedAt', 'DESC']], limit: JUMLAH_PER_HALAMAN });
  }

  const ditampilkan = reason ? (reasonCounts.get(reason) ?? 0) : totalBermasalah;

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
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            <FilterChip href="/nomor-bermasalah" active={!reason}>
              Semua ({totalBermasalah.toLocaleString('id-ID')})
            </FilterChip>
            {REASON_ORDER.map((key) => (
              <FilterChip key={key} href={`/nomor-bermasalah?reason=${key}`} active={reason === key}>
                {REASON_LABELS[key]} ({(reasonCounts.get(key) ?? 0).toLocaleString('id-ID')})
              </FilterChip>
            ))}
          </div>
          {ditampilkan > JUMLAH_PER_HALAMAN && (
            <p className="mb-3 text-xs text-muted-foreground">
              Menampilkan {JUMLAH_PER_HALAMAN} dari {ditampilkan.toLocaleString('id-ID')}. Persempit lewat saringan di
              atas atau cari nama/no. RM tertentu.
            </p>
          )}
          {reason === 'empty' && (
            <p className="mb-3 text-xs text-muted-foreground">
              Nomornya memang belum pernah dicatat di SIMRS Khanza, jadi tidak ada yang bisa dibetulkan dari sini --
              nomornya perlu diminta saat pasien datang lagi.
            </p>
          )}
        </>
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
