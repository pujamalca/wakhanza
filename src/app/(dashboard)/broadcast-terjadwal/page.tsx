import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchPatientSegment, fetchRegionOptions, fetchPaymentOptions } from '@/khanza/pasienSegment';
import { scheduleFiltersToSegment } from '@/khanza/broadcastSchedule';
import { getHospitalIdentity } from '@/khanza/common';
import { identityVars, previewUniqueCodeFooter } from '@/worker/pipeline';
import { BroadcastSchedule } from '@/models';
import { parseScheduleFilters, DATE_PRESETS, type RawFilterInput } from './filters';
import { summarizeSegment } from '../broadcast/segment';
import { toggleScheduleAction, deleteScheduleAction } from './actions';
import { ScheduleForm } from './ScheduleForm';
import {
  PageHeader,
  Card,
  cardClassName,
  Button,
  Input,
  CheckboxList,
  Badge,
  EmptyState,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

interface SearchParams extends RawFilterInput {
  created?: string;
}

function toSet(value: string | string[] | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(Array.isArray(value) ? value : [value]);
}

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function describeRepeat(s: BroadcastSchedule): string {
  const time = s.timeOfDay;
  if (s.repeatKind === 'once') return s.runOnceAt ? `Sekali, ${s.runOnceAt.toLocaleString('id-ID')}` : 'Sekali';
  if (s.repeatKind === 'daily') return `Harian, ${time}`;
  if (s.repeatKind === 'weekly') return `Mingguan, ${DAY_LABELS[s.dayOfWeek ?? 0]} ${time}`;
  return `Bulanan, tgl ${s.dayOfMonth} ${time}`;
}

export default async function BroadcastTerjadwalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (session?.user.role !== 'admin') redirect('/koneksi');

  const sp = await searchParams;
  const filterConfig = parseScheduleFilters(sp);
  const selectedKab = toSet(sp.kab);
  const selectedKec = toSet(sp.kec);
  const selectedPj = toSet(sp.pj);

  const [schedules, regionOptions, paymentOptions, recipients, identity] = await Promise.all([
    BroadcastSchedule.findAll({ order: [['id', 'DESC']] }),
    fetchRegionOptions(),
    fetchPaymentOptions(),
    fetchPatientSegment(scheduleFiltersToSegment(filterConfig)),
    getHospitalIdentity(),
  ]);
  const summary = await summarizeSegment(recipients);

  const firstPreview = summary.preview[0];
  const sampleVars = firstPreview
    ? { ...identityVars(identity), nama_pasien: firstPreview.row.nm_pasien ?? '', no_rm: firstPreview.row.no_rkm_medis }
    : null;
  // Seed tetap (bukan acak/waktu) supaya kode contoh tidak berubah tiap kali
  // halaman dimuat ulang -- kode SUNGGUHAN diturunkan dari idempotency_key
  // masing-masing pesan saat worker menjalankan jadwalnya.
  const uniqueCodeFooter = await previewUniqueCodeFooter(`preview|${firstPreview?.row.no_rkm_medis ?? ''}`);

  return (
    <div>
      <PageHeader
        title="Broadcast terjadwal"
        description="Simpan segmen pasien (dari reg_periksa+pasien, sama seperti Broadcast biasa) dan pesan sekali, lalu kirim otomatis di jadwal yang ditentukan -- sekali, harian, mingguan, atau bulanan. Rentang tanggal segmen selalu DIHITUNG ULANG relatif tiap kali jalan, bukan tanggal tetap."
      />

      {sp.created && (
        <div className="mb-4 rounded-md border border-green-600/30 bg-green-50 p-3 text-sm dark:border-green-500/30 dark:bg-green-950">
          Jadwal berhasil disimpan dan akan mulai berjalan sesuai polanya.
        </div>
      )}

      <Card className="mb-6">
        <h2 className="mb-3 font-medium">Jadwal tersimpan</h2>
        <div className={tableWrapperClass}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={cellClass}>Nama</th>
                <th className={cellClass}>Pola</th>
                <th className={cellClass}>Jalan berikutnya</th>
                <th className={cellClass}>Terakhir jalan</th>
                <th className={cellClass}>Status</th>
                <th className={cellClass}></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className={rowClass}>
                  <td className={cellClass}>{s.name}</td>
                  <td className={`${cellClass} text-xs`}>{describeRepeat(s)}</td>
                  <td className={`${cellClass} text-xs`}>{s.nextRunAt ? s.nextRunAt.toLocaleString('id-ID') : '-'}</td>
                  <td className={`${cellClass} text-xs`}>
                    {s.lastRunAt ? s.lastRunAt.toLocaleString('id-ID') : 'Belum pernah'}
                  </td>
                  <td className={cellClass}>
                    <Badge variant={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                  </td>
                  <td className={cellClass}>
                    <div className="flex gap-1">
                      <form
                        action={async () => {
                          'use server';
                          await toggleScheduleAction(s.id, !s.isActive);
                        }}
                      >
                        <Button type="submit" variant="secondary" size="xs">
                          {s.isActive ? 'Jeda' : 'Aktifkan'}
                        </Button>
                      </form>
                      <form
                        action={async () => {
                          'use server';
                          await deleteScheduleAction(s.id);
                        }}
                      >
                        <Button type="submit" variant="destructive" size="xs">
                          Hapus
                        </Button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {schedules.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState>Belum ada jadwal broadcast.</EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="mb-2 font-medium">Buat jadwal baru</h2>

      <form method="get" className={`mb-4 space-y-3 ${cardClassName}`}>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Jendela kunjungan (dihitung ulang relatif tiap kali jalan)</p>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(DATE_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="submit"
                name="preset"
                value={key}
                className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {preset.label} terakhir
              </button>
            ))}
            <span className="text-xs text-muted-foreground">atau</span>
            <input
              type="number"
              name="lookback"
              min={1}
              defaultValue={filterConfig.lookbackDays}
              className="w-20 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            />
            <span className="text-xs text-muted-foreground">hari terakhir</span>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Cari nama, no. RM (tabel pasien), atau no. pendaftaran (tabel reg_periksa) -- kosong = semua
          </p>
          <Input name="cari" defaultValue={filterConfig.cari ?? ''} placeholder="mis. Budi, TESTWA00001..." className="w-full sm:w-1/2" fieldSize="sm" />
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
        <Stat label="Cocok saat ini" value={summary.total} />
        <Stat label="Bisa dihubungi" value={summary.reachable} />
        <Stat label="Tanpa nomor valid" value={summary.noContact} />
        <Stat label="Sudah berhenti" value={summary.optedOut} />
        <Stat label="Layanan sensitif" value={summary.sensitive} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Angka ini pratinjau HARI INI -- jumlah sesungguhnya saat jadwal jalan bisa berbeda karena jendela tanggal dihitung ulang.
      </p>

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

      <ScheduleForm
        hiddenFilters={{
          lookback: [String(filterConfig.lookbackDays)],
          kab: [...selectedKab],
          kec: [...selectedKec],
          pj: [...selectedPj],
          cari: filterConfig.cari ? [filterConfig.cari] : [],
        }}
        sampleVars={sampleVars}
        total={summary.total}
        uniqueCodeFooter={uniqueCodeFooter}
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
