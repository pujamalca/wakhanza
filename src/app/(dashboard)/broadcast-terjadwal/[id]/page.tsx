import { notFound, redirect } from 'next/navigation';
import { QueryTypes } from 'sequelize';
import { auth } from '@/auth';
import { db } from '@/db/wakhanza';
import { BroadcastSchedule, BroadcastCampaign, Outbox, type OutboxStatus } from '@/models';
import { fetchSegmentUntukJadwal, isPilihSchedule } from '@/khanza/broadcastSchedule';
import { fetchRegionOptions, fetchPaymentOptions } from '@/khanza/pasienSegment';
import { scheduleActor } from '@/core/schedule';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { summarizeSegment } from '../../broadcast/segment';
import { bacaFilterJson, describeRepeat, describeWindowConfig, jelaskanSasaran } from '../deskripsi';
import {
  PageHeader,
  Card,
  LinkButton,
  Badge,
  EmptyState,
  Pagination,
  WaPreview,
  outboxStatusLabel,
  outboxStatusVariant,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

/**
 * Detail satu jadwal broadcast: SIAPA saja yang dikirimi.
 *
 * ==========================================================================
 * Kenapa halaman tersendiri, bukan baris yang bisa dibentangkan
 * ==========================================================================
 *
 * Tabel "Jadwal tersimpan" cuma menyebut BENTUK sasarannya ("Jendela 30
 * hari", "Daftar pilihan, 5 pasien") -- tidak pernah siapa. Untuk jadwal yang
 * berjalan sendiri tanpa ada yang meninjau tiap kali kirim, itu satu-satunya
 * pertanyaan yang benar-benar perlu dijawab, dan sampai halaman ini ada
 * jawabannya cuma bisa didapat lewat SQL langsung ke `outbox` -- yang justru
 * dilarang untuk petugas (RUNBOOK §8).
 *
 * Halaman tersendiri, karena penerimanya harus dibaca dari `sik` dan itu
 * berarti satu query per jadwal. Sebagai baris yang bisa dibentangkan, kedua
 * puluh lima baris tabel akan dibaca sekaligus setiap kali halaman daftar
 * dibuka -- lewat kolam yang sengaja dibatasi `pool.max: 2` supaya tidak
 * berebut dengan SIMRS yang sedang melayani pasien. Di sini query itu jalan
 * hanya untuk jadwal yang benar-benar dibuka seseorang.
 *
 * DUA sisi ditampilkan, dan keduanya perlu:
 *
 * - "Bila jalan sekarang" menjawab APAKAH SASARANNYA MASIH BENAR. Ia dihitung
 *   lewat `fetchSegmentUntukJadwal()` yang SAMA dipakai worker, jadi yang
 *   terlihat di sini adalah yang benar-benar akan dikirimi -- bukan tafsir
 *   kedua atas filter_json.
 * - "Riwayat pengiriman" menjawab SIAPA YANG SUDAH TERLANJUR DIKIRIMI. Segmen
 *   dihitung ulang tiap kali jalan, jadi daftar hari ini sama sekali tidak
 *   memberitahu siapa yang menerima pesan minggu lalu.
 */

interface SearchParams {
  page?: string;
  /** Membuka daftar penerima satu kampanye yang SUDAH terkirim. */
  campaign?: string;
  cpage?: string;
}

/** Jumlah baris outbox per (kampanye, status) -- satu query untuk seluruh kampanye jadwal ini. */
type PerStatus = Partial<Record<OutboxStatus, number>>;

async function hitungStatusKampanye(campaignIds: number[]): Promise<Map<number, PerStatus>> {
  const hasil = new Map<number, PerStatus>();
  if (campaignIds.length === 0) return hasil;

  // Lewat ix_campaign (migrations/005). GROUP BY di sisi database, bukan
  // menarik seluruh baris outbox tiap kampanye ke Node -- satu kampanye bisa
  // berisi ratusan baris dan halaman ini menampilkan sampai 20 kampanye.
  const rows = await db.query<{ campaign_id: number; status: OutboxStatus; n: unknown }>(
    'SELECT campaign_id, status, COUNT(*) AS n FROM outbox WHERE campaign_id IN (:ids) GROUP BY campaign_id, status',
    { replacements: { ids: campaignIds }, type: QueryTypes.SELECT },
  );
  for (const r of rows) {
    const per = hasil.get(Number(r.campaign_id)) ?? {};
    per[r.status] = Number(r.n) || 0;
    hasil.set(Number(r.campaign_id), per);
  }
  return hasil;
}

function namaDari(kode: string[] | undefined, opsi: { kode: string; nama: string }[]): string {
  if (!kode || kode.length === 0) return '';
  const peta = new Map(opsi.map((o) => [o.kode, o.nama]));
  // Kode yang tidak ketemu ditampilkan APA ADANYA, bukan dibuang: wilayah yang
  // dihapus dari master Khanza sesudah jadwalnya dibuat tetap ikut menyaring
  // di query, jadi menghilangkannya dari layar membuat penyaring yang aktif
  // tampak tidak ada.
  return kode.map((k) => peta.get(k) ?? k).join(', ');
}

export default async function DetailJadwalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { id } = await params;
  const sp = await searchParams;
  const scheduleId = Number(id);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) notFound();

  const schedule = await BroadcastSchedule.findByPk(scheduleId);
  if (!schedule) notFound();

  const config = bacaFilterJson(schedule.filterJson);
  if (!config) {
    return (
      <div>
        <PageHeader title={schedule.name} description="Jadwal broadcast" />
        <Card>
          <p className="text-sm text-destructive">
            filter_json jadwal ini tidak bisa diurai, jadi penerimanya tidak bisa dihitung. Baris ini kemungkinan disunting
            langsung lewat SQL. Hapus lalu buat ulang jadwalnya.
          </p>
        </Card>
      </div>
    );
  }

  const modePilih = isPilihSchedule(config);

  const [recipients, regionOptions, paymentOptions, campaigns] = await Promise.all([
    // Pintu yang SAMA dipakai worker saat jadwalnya jatuh tempo -- kalau
    // halaman ini menghitung sendiri, yang ditampilkan bukan lagi yang
    // benar-benar dikirimi, dan justru itu yang ingin diperiksa orang.
    fetchSegmentUntukJadwal(config),
    fetchRegionOptions(),
    fetchPaymentOptions(),
    BroadcastCampaign.findAll({
      where: { createdBy: scheduleActor(scheduleId) },
      order: [['id', 'DESC']],
      limit: 20,
    }),
  ]);

  // previewLimit = seluruh barisnya: halaman ini ada JUSTRU untuk melihat
  // semuanya, jadi batas 30 baris milik pratinjau segmen tidak berlaku di
  // sini. Paginasinya yang mengurus panjangnya.
  const summary = await summarizeSegment(recipients, recipients.length);
  const p = hitungPaginasi(bacaHalaman(sp.page), summary.preview.length, UKURAN_HALAMAN.riwayat);
  const barisPenerima = summary.preview.slice(p.offset, p.offset + p.limit);

  const statusKampanye = await hitungStatusKampanye(campaigns.map((c) => c.id));

  // Drill-down satu kampanye: siapa yang BENAR-BENAR dikirimi saat itu, apa
  // adanya dari outbox -- bukan dihitung ulang dari filter_json, yang hasilnya
  // hari ini bisa berbeda.
  const campaignId = Number(sp.campaign);
  const bukaKampanye = Number.isInteger(campaignId) && campaigns.some((c) => c.id === campaignId);
  const totalBarisKampanye = bukaKampanye ? await Outbox.count({ where: { campaignId } }) : 0;
  const cp = hitungPaginasi(bacaHalaman(sp.cpage), totalBarisKampanye, UKURAN_HALAMAN.riwayat);
  const barisKampanye = bukaKampanye
    ? await Outbox.findAll({
        where: { campaignId },
        order: [['id', 'ASC']],
        limit: cp.limit,
        offset: cp.offset,
        attributes: ['id', 'noRkmMedis', 'phoneE164', 'status', 'scheduledAt', 'sentAt', 'lastError'],
      })
    : [];

  const wilayahKab = namaDari(config.kdKab, regionOptions.kabupaten);
  const wilayahKec = namaDari(config.kdKec, regionOptions.kecamatan);
  const caraBayar = namaDari(config.kdPj, paymentOptions);

  return (
    <div>
      <PageHeader
        title={schedule.name}
        description="Rincian satu jadwal broadcast: pengaturannya, siapa yang akan dikirimi bila jalan sekarang, dan siapa yang sudah pernah dikirimi."
      />

      <div className="mb-4">
        <LinkButton href="/broadcast-terjadwal" variant="ghost" size="sm">
          &larr; Kembali ke daftar jadwal
        </LinkButton>
      </div>

      <Card className="mb-4">
        <h2 className="mb-3 font-medium">Pengaturan</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Baris label="Status">
            <Badge variant={schedule.isActive ? 'success' : 'neutral'}>{schedule.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
          </Baris>
          <Baris label="Pola">{describeRepeat(schedule)}</Baris>
          <Baris label="Jalan berikutnya">{schedule.nextRunAt ? schedule.nextRunAt.toLocaleString('id-ID') : '-'}</Baris>
          <Baris label="Terakhir jalan">
            {schedule.lastRunAt ? schedule.lastRunAt.toLocaleString('id-ID') : 'Belum pernah'}
          </Baris>
          <Baris label="Berhenti setelah">
            {schedule.stopAfterDate ? schedule.stopAfterDate.toLocaleDateString('id-ID') : 'Tanpa batas waktu'}
          </Baris>
          <Baris label="Dibuat oleh">{schedule.createdBy}</Baris>
        </dl>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-medium">Sasaran &mdash; {describeWindowConfig(config)}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{jelaskanSasaran(config)}</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Baris label="Pencarian pasien">{config.cari || <Kosong>tidak dipakai</Kosong>}</Baris>
          <Baris label="Kabupaten/kota">{wilayahKab || <Kosong>semua</Kosong>}</Baris>
          <Baris label="Kecamatan">{wilayahKec || <Kosong>semua</Kosong>}</Baris>
          <Baris label="Cara bayar">{caraBayar || <Kosong>semua</Kosong>}</Baris>
        </dl>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 font-medium">Isi pesan</h2>
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
          <WaPreview text={schedule.messageBody} />
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Variabel seperti <span className="font-mono">{'{nama_pasien}'}</span> diisi per pasien saat jadwal jalan, dan satu
          baris kode pengiriman yang berbeda untuk tiap pesan ditambahkan otomatis di akhir.
        </p>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-medium">
          Bila jalan sekarang &mdash; {summary.total} pasien
          {summary.total > 0 && <span className="text-muted-foreground"> ({summary.reachable} bisa dihubungi)</span>}
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {modePilih
            ? 'Daftar tetap: pasien inilah yang dikirimi setiap kali jadwal jalan. Data di bawah dibaca ulang dari Khanza, jadi nama/nomor selalu mutakhir.'
            : 'Dihitung ULANG dari jendela tanggal relatif setiap kali jadwal jalan, jadi daftar ini bisa berbeda besok. Ia menjawab "apakah sasarannya masih benar", bukan "siapa yang sudah dikirimi".'}
        </p>

        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Angka label="Bisa dihubungi" value={summary.reachable} />
          <Angka label="Tanpa nomor valid" value={summary.noContact} />
          <Angka label="Sudah berhenti" value={summary.optedOut} />
          <Angka label="Layanan sensitif" value={summary.sensitive} />
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
              {barisPenerima.map(({ row, phoneE164, safe }) => (
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
              {barisPenerima.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState>
                      Tidak ada pasien yang cocok saat ini. Untuk jadwal tindak lanjut ini sering wajar (jendelanya satu hari
                      kalender); untuk jendela berjalan, periksa kembali penyaringnya.
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
          hrefFor={(n) => hrefHalaman(`/broadcast-terjadwal/${scheduleId}`, { ...sp }, n)}
          unit="pasien"
        />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 font-medium">Riwayat pengiriman</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Satu baris per kali jadwal ini benar-benar jalan. Jumlahnya dihitung langsung dari antrean pesan saat halaman dibuka,
          bukan dari penghitung tersimpan yang bisa basi. Menampilkan 20 terakhir.
        </p>
        <div className={tableWrapperClass}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={cellClass}>Kampanye</th>
                <th className={cellClass}>Waktu</th>
                <th className={cellClass}>Penerima</th>
                <th className={cellClass}>Status pesan</th>
                <th className={cellClass}></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const per = statusKampanye.get(c.id) ?? {};
                return (
                  <tr key={c.id} className={rowClass}>
                    <td className={`${cellClass} font-mono text-xs`}>#{c.id}</td>
                    <td className={`${cellClass} text-xs`}>{c.createdAt.toLocaleString('id-ID')}</td>
                    <td className={cellClass}>{c.recipientCount}</td>
                    <td className={cellClass}>
                      <div className="flex flex-wrap gap-1">
                        {(Object.entries(per) as [OutboxStatus, number][]).map(([status, n]) => (
                          <Badge key={status} variant={outboxStatusVariant(status)}>
                            {outboxStatusLabel(status)}: {n}
                          </Badge>
                        ))}
                        {Object.keys(per).length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            tidak ada baris &mdash; kemungkinan sudah dipangkas (masa simpan 90 hari)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={cellClass}>
                      <LinkButton
                        href={`/broadcast-terjadwal/${scheduleId}?campaign=${c.id}`}
                        variant="secondary"
                        size="xs"
                      >
                        Lihat penerima
                      </LinkButton>
                    </td>
                  </tr>
                );
              })}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState>
                      Jadwal ini belum pernah jalan. Baris pertama muncul setelah worker mengeksekusinya pada waktu yang
                      dijadwalkan.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {bukaKampanye && (
        <Card>
          <h2 className="mb-1 font-medium">Penerima kampanye #{campaignId}</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Ini yang BENAR-BENAR dikirimi saat itu, apa adanya dari antrean pesan &mdash; bukan dihitung ulang dari
            penyaringnya, yang hasilnya hari ini bisa berbeda. Baris yang lebih tua dari masa simpan 90 hari sudah dipangkas.
          </p>
          <div className={tableWrapperClass}>
            <table className="w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className={cellClass}>No. RM</th>
                  <th className={cellClass}>Nomor</th>
                  <th className={cellClass}>Status</th>
                  <th className={cellClass}>Dijadwalkan</th>
                  <th className={cellClass}>Terkirim</th>
                </tr>
              </thead>
              <tbody>
                {barisKampanye.map((o) => (
                  <tr key={o.id} className={rowClass}>
                    <td className={`${cellClass} font-mono text-xs`}>{o.noRkmMedis ?? '-'}</td>
                    <td className={`${cellClass} text-xs tabular-nums`}>{o.phoneE164 ?? '-'}</td>
                    <td className={cellClass}>
                      <Badge variant={outboxStatusVariant(o.status)}>{outboxStatusLabel(o.status)}</Badge>
                      {o.lastError && <span className="ml-1 text-xs text-muted-foreground">{o.lastError}</span>}
                    </td>
                    <td className={`${cellClass} text-xs`}>{o.scheduledAt.toLocaleString('id-ID')}</td>
                    <td className={`${cellClass} text-xs`}>{o.sentAt ? o.sentAt.toLocaleString('id-ID') : '-'}</td>
                  </tr>
                ))}
                {barisKampanye.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState>
                        Tidak ada baris pesan untuk kampanye ini &mdash; kemungkinan sudah dipangkas oleh pembersihan berkala
                        (masa simpan 90 hari).
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={cp.halaman}
            totalPages={cp.totalHalaman}
            count={cp.jumlah}
            hrefFor={(n) => hrefHalaman(`/broadcast-terjadwal/${scheduleId}`, { ...sp }, n, 'cpage')}
            unit="pesan"
          />
        </Card>
      )}
    </div>
  );
}

function Baris({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Kosong({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function Angka({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-2 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
