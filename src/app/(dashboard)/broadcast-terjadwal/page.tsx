import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchRegionOptions, fetchPaymentOptions } from '@/khanza/pasienSegment';
import {
  fetchSegmentUntukJadwal,
  isFollowupSchedule,
  isPilihSchedule,
  DEFAULT_FOLLOWUP_OFFSET_DAYS,
  type ScheduleFilterConfig,
} from '@/khanza/broadcastSchedule';
import { getHospitalIdentity } from '@/khanza/common';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import { broadcastVars } from '@/core/broadcastVars';
import { MAX_PILIHAN_PASIEN, bacaPilihanRm } from '@/core/pilihanPasien';
import { BroadcastSchedule, BroadcastTemplate } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { parseScheduleFilters, DATE_PRESETS, type RawFilterInput } from './filters';
import { summarizeSegment } from '../broadcast/segment';
import { PenerimaBar, KolomPilihHeader, SelPilih, PilihanTersembunyi } from '../broadcast/PilihPenerima';
import { CariPasien, TombolSubmitBawaan } from '../broadcast/CariPasien';
import { toggleScheduleAction, deleteScheduleAction } from './actions';
import { ScheduleForm } from './ScheduleForm';
import { WindowModeFields } from './WindowModeFields';
import {
  PageHeader,
  Card,
  cardClassName,
  Button,
  CheckboxList,
  Badge,
  EmptyState,
  Pagination,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

interface SearchParams extends RawFilterInput {
  created?: string;
  page?: string;
}

function toSet(value: string | string[] | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(Array.isArray(value) ? value : [value]);
}

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Satu id, dirujuk checkbox & radio yang letaknya di luar <form> lewat atribut `form=`. */
const FORM_FILTER = 'filter-jadwal';

function describeRepeat(s: BroadcastSchedule): string {
  const time = s.timeOfDay;
  if (s.repeatKind === 'once') return s.runOnceAt ? `Sekali, ${s.runOnceAt.toLocaleString('id-ID')}` : 'Sekali';
  if (s.repeatKind === 'daily') return `Harian, ${time}`;
  if (s.repeatKind === 'weekly') return `Mingguan, ${DAY_LABELS[s.dayOfWeek ?? 0]} ${time}`;
  return `Bulanan, tgl ${s.dayOfMonth} ${time}`;
}

/**
 * Mode jendela disimpan di dalam filter_json, jadi harus diurai untuk
 * ditampilkan. Baris lama (dibuat sebelum mode ini ada) tidak punya field-nya
 * dan terbaca sebagai 'rolling' -- sesuai perilakunya selama ini.
 */
function describeWindow(s: BroadcastSchedule): string {
  let config: ScheduleFilterConfig;
  try {
    config = JSON.parse(s.filterJson);
  } catch {
    return '-';
  }
  // Daftar pilihan diperiksa DULU: ia menggantikan jendela, jadi menyebut
  // "Jendela 30 hari" untuk jadwal bercentang adalah keterangan yang salah
  // pada satu-satunya kolom yang menjelaskan siapa penerimanya.
  if (isPilihSchedule(config)) return `Daftar pilihan, ${config.noRkmMedis?.length ?? 0} pasien`;
  return isFollowupSchedule(config)
    ? `Tindak lanjut, H+${config.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS}`
    : `Jendela ${config.lookbackDays} hari`;
}

export default async function BroadcastTerjadwalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const sp = await searchParams;
  const filterConfig = parseScheduleFilters(sp);
  const selectedKab = toSet(sp.kab);
  const selectedKec = toSet(sp.kec);
  const selectedPj = toSet(sp.pj);

  const p = hitungPaginasi(bacaHalaman(sp.page), await BroadcastSchedule.count(), UKURAN_HALAMAN.konfigurasi);

  const modePilih = isPilihSchedule(filterConfig);
  const pilihan = bacaPilihanRm(sp.rm);
  const terpilih = new Set(pilihan.daftar);
  const followup = isFollowupSchedule(filterConfig);

  const [schedules, regionOptions, paymentOptions, recipients, identity, broadcastTemplates] = await Promise.all([
    BroadcastSchedule.findAll({ order: [['id', 'DESC']], limit: p.limit, offset: p.offset }),
    fetchRegionOptions(),
    fetchPaymentOptions(),
    // Pintu yang SAMA dipakai worker saat jadwalnya jatuh tempo -- pratinjau
    // yang bercabang sendiri adalah pratinjau yang cepat atau lambat
    // menampilkan penerima yang berbeda dari yang benar-benar dikirimi.
    fetchSegmentUntukJadwal(filterConfig),
    getHospitalIdentity(),
    BroadcastTemplate.findAll({ where: { isActive: true }, order: [['name', 'ASC']] }),
  ]);
  const summary = await summarizeSegment(recipients, modePilih ? MAX_PILIHAN_PASIEN : undefined);

  const firstPreview = summary.preview[0];
  // broadcastVars() yang SAMA dipakai runDueBroadcastSchedules() di worker --
  // di sinilah penyimpangannya paling mahal, karena jadwal berjalan tanpa ada
  // yang meninjau tiap kali kirim.
  const sampleVars = firstPreview ? broadcastVars(firstPreview.row, identity) : null;
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
                <th className={cellClass}>Sasaran</th>
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
                  <td className={`${cellClass} text-xs`}>{describeWindow(s)}</td>
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
                  <td colSpan={7}>
                    <EmptyState>Belum ada jadwal broadcast.</EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Seluruh `sp` dibawa apa adanya, termasuk pilihan wilayah/cara bayar
            yang berbentuk larik. Query string halaman ini juga mengisi form
            "Buat jadwal baru" di bawah, jadi tombol Berikutnya yang membuangnya
            akan mengosongkan form yang sedang disusun staf. */}
        <Pagination
          page={p.halaman}
          totalPages={p.totalHalaman}
          count={p.jumlah}
          hrefFor={(n) => hrefHalaman('/broadcast-terjadwal', { ...sp }, n)}
          unit="jadwal"
        />
      </Card>

      <h2 className="mb-2 font-medium">Buat jadwal baru</h2>

      <form id={FORM_FILTER} method="get" className={`mb-4 space-y-3 ${cardClassName}`}>
        {/* WAJIB paling awal: tanpa ini, Enter di kotak cari mengaktifkan tombol
            preset di dalam WindowModeFields dan menimpa jendela lookback staf --
            yang kemudian ikut TERSIMPAN ke filter_json. Lihat CariPasien.tsx. */}
        <TombolSubmitBawaan />

        {/* Centang yang tidak sedang tampil di tabel dititipkan di sini supaya
            bertahan saat filter diganti; yang tampil sengaja dikecualikan --
            lihat PilihanTersembunyi. */}
        <PilihanTersembunyi daftar={pilihan.daftar} tampil={new Set(summary.preview.map((s) => s.row.no_rkm_medis))} />

        {/* Kedua kotak jendela TETAP dirender saat mode pilih aktif, bukan
            disembunyikan: nilainya ikut terkirim tiap kali Terapkan ditekan,
            jadi menghilangkannya membuat pengaturan jendela staf lenyap begitu
            ia mencoba mode pilih lalu kembali. Yang ditambahkan cuma
            keterangan bahwa keduanya sedang tidak dipakai. */}
        {modePilih && (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            Penerimanya sedang daftar centang, jadi kedua pilihan jendela di bawah <strong>tidak dipakai</strong> — daftar itu
            menggantikan jendela tanggal, bukan menyaringnya. Kembali ke &ldquo;Semua yang cocok dengan filter&rdquo; untuk
            memakainya lagi.
          </p>
        )}

        <WindowModeFields
          presets={Object.entries(DATE_PRESETS).map(([key, preset]) => ({ key, label: preset.label }))}
          defaultMode={filterConfig.windowMode ?? 'rolling'}
          defaultLookback={filterConfig.lookbackDays}
          defaultOffset={filterConfig.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS}
        />

        {/* Kotak cari pasien SENGAJA tidak di sini melainkan tepat di atas
            tabel -- lihat CariPasien.tsx. Ia tetap milik form ini lewat
            atribut form=, jadi seluruh saringan tetap berangkat sekali jalan. */}

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

      <PenerimaBar
        formId={FORM_FILTER}
        basePath="/broadcast-terjadwal"
        params={{ ...sp }}
        mode={modePilih ? 'pilih' : 'semua'}
        jumlahCocok={modePilih ? null : summary.total}
        dicentang={pilihan.daftar.length}
        ditemukan={modePilih ? summary.total : null}
        terpotong={bacaPilihanRm(sp.rm).terpotong}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={modePilih ? 'Dipilih' : 'Cocok saat ini'} value={summary.total} />
        <Stat label="Bisa dihubungi" value={summary.reachable} />
        <Stat label="Tanpa nomor valid" value={summary.noContact} />
        <Stat label="Sudah berhenti" value={summary.optedOut} />
        <Stat label="Layanan sensitif" value={summary.sensitive} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {modePilih
          ? 'Daftar tetap: pasien inilah yang dikirimi SETIAP kali jadwal jalan, tanpa dihitung ulang dari tanggal kunjungan. Yang berubah tiap kali cuma data yang dibaca ulang dari Khanza (nama, nomor, kunjungan terakhir).'
          : followup
            ? `Ini pasien yang berkunjung ${filterConfig.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS} hari lalu -- yakni yang akan dikirimi SEANDAINYA jadwal jalan hari ini. Tiap hari isinya berbeda, dan tiap pasien hanya pernah masuk sekali.`
            : 'Angka ini pratinjau HARI INI -- jumlah sesungguhnya saat jadwal jalan bisa berbeda karena jendela tanggal dihitung ulang.'}
      </p>

      <CariPasien
        formId={FORM_FILTER}
        basePath="/broadcast-terjadwal"
        params={{ ...sp }}
        nilai={filterConfig.cari ?? ''}
        nonaktif={modePilih}
      />

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <KolomPilihHeader />
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
                <SelPilih
                  formId={FORM_FILTER}
                  noRkmMedis={row.no_rkm_medis}
                  nama={row.nm_pasien}
                  terpilih={terpilih.has(row.no_rkm_medis)}
                />
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
                <td colSpan={7}>
                  <EmptyState>
                    {modePilih
                      ? 'Belum ada pasien yang dicentang. Kembali ke "Semua yang cocok dengan filter" untuk memilihnya dari tabel.'
                      : 'Tidak ada pasien yang cocok dengan filter ini.'}
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {summary.total > summary.preview.length && (
        <p className="mt-1 text-xs text-muted-foreground">
          Menampilkan {summary.preview.length} dari {summary.total} pasien &mdash; hanya baris yang tampil di sini yang bisa
          dicentang. Pakai kotak cari atau persempit filter untuk menjangkau yang lain; centang yang sudah ada tidak hilang.
        </p>
      )}

      <ScheduleForm
        hiddenFilters={{
          windowMode: [filterConfig.windowMode ?? 'rolling'],
          lookback: [String(filterConfig.lookbackDays)],
          offset: [String(filterConfig.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS)],
          kab: [...selectedKab],
          kec: [...selectedKec],
          pj: [...selectedPj],
          cari: filterConfig.cari ? [filterConfig.cari] : [],
          // Keduanya WAJIB ikut: createScheduleAction menyusun ulang
          // filter_json dari FormData satu per satu, jadi field yang lupa
          // dititipkan akan benar di pratinjau lalu diam-diam hilang saat
          // jadwalnya disimpan.
          mode: [modePilih ? 'pilih' : 'semua'],
          rm: pilihan.daftar,
        }}
        sampleVars={sampleVars}
        total={summary.total}
        uniqueCodeFooter={uniqueCodeFooter}
        isFollowup={followup}
        isPilih={modePilih}
        templates={broadcastTemplates.map((t) => ({ id: t.id, name: t.name, body: t.body }))}
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
