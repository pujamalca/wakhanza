import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AuditLog } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { PageHeader, EmptyState, Pagination, IconShield, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi itu UI saja -- akses
  // langsung lewat URL harus tetap ditolak di server (IMPLEMENTATION_PLAN Fase 3 DoD).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { page: pageParam } = await searchParams;
  // Dihitung SESUDAH count supaya nomor halaman di luar rentang dijepit ke
  // halaman terakhir alih-alih menampilkan tabel kosong yang tak bisa
  // ditinggalkan -- lihat core/pagination.ts.
  const jumlah = await AuditLog.count();
  const p = hitungPaginasi(bacaHalaman(pageParam), jumlah, UKURAN_HALAMAN.riwayat);

  const rows = await AuditLog.findAll({
    order: [['id', 'DESC']],
    limit: p.limit,
    offset: p.offset,
  });

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
                  <EmptyState icon={<IconShield className="h-5 w-5" />} title="Belum ada riwayat">
                    Setiap tindakan petugas -- kirim ulang, ubah template, koreksi nomor -- tercatat di sini secara otomatis.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={p.halaman}
        totalPages={p.totalHalaman}
        count={p.jumlah}
        hrefFor={(n) => hrefHalaman('/audit', {}, n)}
        unit="tindakan"
      />
    </div>
  );
}
