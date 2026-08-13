import {
  Badge,
  EmptyState,
  FilterChip,
  Pagination,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import type { BarisPenilaian, StatusPenilaian } from '@/khanza/penilaianAwal';

const LABEL_KOLOM: Record<string, string> = {
  td: 'tekanan darah',
  nadi: 'nadi',
  suhu: 'suhu',
  rr: 'pernapasan',
  gcs: 'GCS',
  bb: 'berat badan',
  tb: 'tinggi badan',
  keluhan_utama: 'keluhan utama',
};

const BADGE: Record<StatusPenilaian, { variant: 'success' | 'warning' | 'danger'; teks: string }> = {
  lengkap: { variant: 'success', teks: 'Lengkap' },
  sebagian: { variant: 'warning', teks: 'Terisi sebagian' },
  belum: { variant: 'danger', teks: 'Belum diisi' },
};

/**
 * Komponen SERVER -- tidak ada state klien sama sekali.
 *
 * Saringan dan halaman semuanya lewat query string, jadi hasilnya bisa
 * dibagikan sebagai tautan dan tombol maju/mundur peramban bekerja. Pola yang
 * sama dipakai chip status di `/antrean`.
 */
export function PasienTable({
  baris,
  jumlah,
  halaman,
  totalHalaman,
  jumlahTampil,
  hrefHalamanFn,
  hrefStatus,
  statusAktif,
}: {
  baris: BarisPenilaian[];
  jumlah: { total: number; belum: number; sebagian: number; lengkap: number };
  halaman: number;
  totalHalaman: number;
  /** Jumlah baris pada golongan yang sedang disaring. */
  jumlahTampil: number;
  hrefHalamanFn: (n: number) => string;
  hrefStatus: (s: StatusPenilaian | null) => string;
  statusAktif: StatusPenilaian | null;
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <FilterChip href={hrefStatus(null)} active={statusAktif === null}>
          Semua ({jumlah.total})
        </FilterChip>
        {/*
          Urutan chip: yang PALING perlu dikerjakan lebih dulu.
          Pelajaran `/nomor-bermasalah` -- di sana chip diurutkan mengikuti
          urutan kunci enum, sehingga golongan yang tidak bisa dikerjakan siapa
          pun tampil paling depan dan mengubur yang bisa.
        */}
        <FilterChip href={hrefStatus('belum')} active={statusAktif === 'belum'}>
          Belum diisi ({jumlah.belum})
        </FilterChip>
        <FilterChip href={hrefStatus('sebagian')} active={statusAktif === 'sebagian'}>
          Terisi sebagian ({jumlah.sebagian})
        </FilterChip>
        <FilterChip href={hrefStatus('lengkap')} active={statusAktif === 'lengkap'}>
          Lengkap ({jumlah.lengkap})
        </FilterChip>
      </div>

      {baris.length === 0 ? (
        <EmptyState title="Tidak ada pasien yang cocok">
          {jumlah.total === 0
            ? 'Tidak ada pasien berstatus Baru pada rentang tanggal ini. Coba lebarkan rentangnya.'
            : 'Tidak ada pasien pada golongan ini. Pilih chip lain di atas.'}
        </EmptyState>
      ) : (
        <>
          <div className={tableWrapperClass}>
            <table className="w-full text-left text-body">
              <thead className={theadClass}>
                <tr>
                  <th className={cellClass}>Pasien</th>
                  <th className={`${cellClass} hidden sm:table-cell`}>Daftar</th>
                  <th className={`${cellClass} hidden lg:table-cell`}>Poli / dokter</th>
                  <th className={cellClass}>Asesmen</th>
                </tr>
              </thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.noRawat} className={rowClass}>
                    <td className={cellClass}>
                      <div className="font-medium">{b.namaPasien ?? '(tanpa nama)'}</div>
                      <div className="text-caption text-muted-foreground">{b.noRkmMedis}</div>
                    </td>
                    <td className={`${cellClass} hidden whitespace-nowrap sm:table-cell`}>
                      <div>{b.noRawat.slice(0, 10).replace(/\//g, '-')}</div>
                      <div className="text-caption text-muted-foreground">
                        {(b.jamReg ?? '').slice(0, 5)}
                      </div>
                    </td>
                    <td className={`${cellClass} hidden lg:table-cell`}>
                      <div>{b.namaPoli ?? b.kdPoli ?? '—'}</div>
                      <div className="text-caption text-muted-foreground">{b.namaDokter ?? '—'}</div>
                    </td>
                    <td className={cellClass}>
                      <Badge variant={BADGE[b.status].variant}>{BADGE[b.status].teks}</Badge>
                      {b.status === 'sebagian' && b.kosong.length > 0 && (
                        <div className="mt-0.5 text-caption text-muted-foreground">
                          belum: {b.kosong.map((k) => LABEL_KOLOM[k] ?? k).join(', ')}
                        </div>
                      )}
                      {b.status === 'lengkap' && b.diisiPada && (
                        <div className="mt-0.5 text-caption text-muted-foreground">
                          {String(b.diisiPada).slice(11, 16)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalHalaman > 1 && (
            <div className="mt-3">
              <Pagination
                page={halaman}
                totalPages={totalHalaman}
                count={jumlahTampil}
                hrefFor={hrefHalamanFn}
                unit="pasien"
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
