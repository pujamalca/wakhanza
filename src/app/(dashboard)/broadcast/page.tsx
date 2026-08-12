import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchPatientSegment, fetchPatientsByRm, fetchRegionOptions, fetchPaymentOptions, SEGMENT_LIMIT } from '@/khanza/pasienSegment';
import { getHospitalIdentity, formatSqlDate } from '@/khanza/common';
import { segmentScope, PESAN_TANPA_BATAS } from '@/core/segmentScope';
import { bacaModePenerima, bacaPilihanRm, MAX_PILIHAN_PASIEN } from '@/core/pilihanPasien';
import { pemicuSegmen, PARAM_TAMPIL, PESAN_BELUM_DIMUAT } from '@/core/segmentGate';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import { broadcastVars } from '@/core/broadcastVars';
import { Outbox, BroadcastCampaign, BroadcastTemplate } from '@/models';
import { parseFilters, DATE_PRESETS, PRESET_SEMUA_WAKTU, type RawFilterInput } from './filters';
import { summarizeSegment } from './segment';
import { ComposeForm } from './ComposeForm';
import { PenerimaBar, KolomPilihHeader, SelPilih, PilihanTersembunyi } from './PilihPenerima';
import { CariPasien, TombolSubmitBawaan } from './CariPasien';
import { PageHeader, Card, cardClassName, Button, CheckboxList, Badge, EmptyState, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

interface SearchParams extends RawFilterInput {
  sent?: string;
  mode?: string | string[];
  rm?: string | string[];
  /** Penanda "staf menekan Terapkan" -- lihat core/segmentGate.ts. */
  tampil?: string | string[];
}

/** Satu id, dirujuk checkbox & radio yang letaknya di luar <form> lewat atribut `form=`. */
const FORM_FILTER = 'filter-broadcast';

function toSet(value: string | string[] | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(Array.isArray(value) ? value : [value]);
}

export default async function BroadcastPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat
  // URL harus tetap ditolak di server (pola sama seperti /audit).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const scope = segmentScope(filters);
  const selectedKab = toSet(sp.kab);
  const selectedKec = toSet(sp.kec);
  const selectedPj = toSet(sp.pj);

  const mode = bacaModePenerima(sp.mode);
  const pilihan = bacaPilihanRm(sp.rm);
  const modePilih = mode === 'pilih';
  const terpilih = new Set(pilihan.daftar);

  // Segmen TIDAK dibaca sampai staf memintanya -- lihat core/segmentGate.ts.
  const pemicu = pemicuSegmen({ modePilih, cari: filters.cari, tampil: sp.tampil, preset: sp.preset });
  const belumDimuat = pemicu === null;

  const [regionOptions, paymentOptions, recipients, identity, broadcastTemplates] = await Promise.all([
    fetchRegionOptions(),
    fetchPaymentOptions(),
    // Daftar pilihan MENGGANTIKAN segmen, tidak menyaringnya -- lihat
    // core/pilihanPasien.ts. Konsekuensi yang disengaja: pada mode `pilih`,
    // query segmen tidak dijalankan sama sekali, jadi filter tanggal/wilayah
    // yang kebetulan masih terpasang tidak bisa diam-diam membuang pasien yang
    // dicentang staf sendiri.
    belumDimuat ? Promise.resolve([]) : modePilih ? fetchPatientsByRm(pilihan.daftar) : fetchPatientSegment(filters),
    getHospitalIdentity(),
    BroadcastTemplate.findAll({ where: { isActive: true }, order: [['name', 'ASC']] }),
  ]);
  // Pada mode `pilih` tabelnya bukan cuplikan melainkan DAFTAR PENERIMA, jadi
  // batas 30 baris tidak berlaku: penerima ke-31 harus bisa dibatalkan.
  const summary = await summarizeSegment(recipients, modePilih ? MAX_PILIHAN_PASIEN : undefined);

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
  // broadcastVars() yang SAMA dipakai sendBroadcastAction -- pratinjau yang
  // memetakan barisnya sendiri adalah pratinjau yang cepat atau lambat
  // menampilkan pesan berbeda dari yang benar-benar terkirim.
  const sampleVars = firstPreview ? broadcastVars(firstPreview.row, identity) : null;
  // Seed tetap (bukan acak/waktu) supaya kode contoh tidak berubah tiap kali
  // halaman dimuat ulang -- kode SUNGGUHAN diturunkan dari idempotency_key
  // masing-masing pesan saat enqueue, jadi ini murni contoh bentuknya.
  const uniqueCodeFooter = await previewUniqueCodeFooter(`preview|${firstPreview?.row.no_rkm_medis ?? ''}`);

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

      <form id={FORM_FILTER} method="get" className={`mb-4 space-y-3 ${cardClassName}`}>
        {/* WAJIB paling awal: tanpa ini, Enter di kotak cari mengaktifkan tombol
            preset di bawah dan menimpa rentang tanggal staf. Lihat CariPasien.tsx. */}
        <TombolSubmitBawaan />

        {/* Centang yang tidak sedang tampil di tabel dititipkan di sini supaya
            bertahan saat filter diganti; yang tampil sengaja dikecualikan --
            lihat PilihanTersembunyi. */}
        <PilihanTersembunyi daftar={pilihan.daftar} tampil={new Set(summary.preview.map((p) => p.row.no_rkm_medis))} />

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Rentang kunjungan (opsional)</p>
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
            <button
              type="submit"
              name="preset"
              value={PRESET_SEMUA_WAKTU}
              className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Semua waktu
            </button>
            <span className="text-xs text-muted-foreground">atau</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom ? formatSqlDate(filters.dateFrom) : ''}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            />
            <span className="text-xs">s/d</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo ? formatSqlDate(filters.dateTo) : ''}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Kosongkan keduanya untuk mencari di seluruh riwayat kunjungan -- perlu bila pasien yang dicari terakhir datang
            lama sekali.
          </p>
        </div>

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

        {/* name/value WAJIB: inilah penanda "staf meminta" yang membedakan
            halaman yang baru dibuka dari filter yang sengaja dikosongkan --
            lihat core/segmentGate.ts. Tombol ini BUKAN tombol bawaan form
            (TombolSubmitBawaan di atas lebih dulu dalam urutan dokumen), jadi
            Enter di kotak cari tetap tidak menitipkan apa pun. */}
        <Button type="submit" name={PARAM_TAMPIL} value="1" variant="secondary" size="sm">
          Terapkan filter
        </Button>
      </form>

      {/* Rentang tanggal yang mati harus TERLIHAT mati. Kotak tanggal kosong
          gampang terbaca sebagai "belum diisi" alih-alih "sengaja tanpa batas",
          dan bedanya menentukan siapa saja yang masuk segmen. */}
      {/* Keduanya menjelaskan BENTUK query segmen, jadi tidak berlaku pada mode
          pilih -- di sana query itu memang tidak dijalankan. Menampilkannya
          tetap akan menyuruh staf membetulkan filter yang sedang tidak dipakai. */}
      {/* Keduanya juga tidak berlaku sebelum segmennya dibaca: keterangan
          cakupan atas query yang belum pernah dijalankan menyuruh staf
          membetulkan sesuatu yang belum terjadi. */}
      {!modePilih && !belumDimuat && scope === 'tanpa-batas' && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">{PESAN_TANPA_BATAS}</div>
      )}
      {!modePilih && !belumDimuat && scope === 'semua-waktu' && (
        <p className="mb-4 text-xs text-muted-foreground">
          Tanpa batas rentang kunjungan &mdash; mencari di seluruh riwayat, disaring filter lain di atas.
        </p>
      )}

      <PenerimaBar
        formId={FORM_FILTER}
        basePath="/broadcast"
        // Disebar, bukan diteruskan apa adanya: interface tidak punya index
        // signature implisit, sementara objek literal punya -- idiom yang sama
        // sudah dipakai pemanggil hrefHalaman.
        params={{ ...sp }}
        mode={mode}
        jumlahCocok={modePilih || belumDimuat ? null : summary.total}
        dicentang={pilihan.daftar.length}
        ditemukan={modePilih ? summary.total : null}
        terpotong={pilihan.terpotong}
      />

      {/* Lima angka nol pada segmen yang belum pernah dibaca terbaca sebagai
          "tidak ada yang cocok" -- kesimpulan yang salah, dan yang menyuruh
          staf melonggarkan filter yang sebenarnya belum dijalankan. */}
      {!belumDimuat && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label={modePilih ? 'Dipilih' : 'Cocok'} value={summary.total} />
          <Stat label="Bisa dihubungi" value={summary.reachable} />
          <Stat label="Tanpa nomor valid" value={summary.noContact} />
          <Stat label="Sudah berhenti" value={summary.optedOut} />
          <Stat label="Layanan sensitif" value={summary.sensitive} />
        </div>
      )}

      <CariPasien
        formId={FORM_FILTER}
        basePath="/broadcast"
        params={{ ...sp }}
        nilai={filters.cari ?? ''}
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
                    {belumDimuat
                      ? PESAN_BELUM_DIMUAT
                      : modePilih
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
          Menampilkan {summary.preview.length} dari {summary.total} pasien cocok &mdash; hanya baris yang tampil di sini yang
          bisa dicentang. Pakai kotak cari atau persempit filter untuk menjangkau yang lain; centang yang sudah ada tidak
          hilang.
        </p>
      )}
      {/* Angka "cocok" berhenti di batas query, jadi tepat pada angka itu ia
          berubah arti: bukan lagi jumlah yang cocok, melainkan jumlah yang
          sempat terbaca. Diam di sini membuat segmen yang terpotong terlihat
          persis seperti segmen yang utuh. */}
      {!modePilih && !belumDimuat && summary.total >= SEGMENT_LIMIT && (
        <p className="mt-1 text-xs text-warning">
          Hasil dipotong di {SEGMENT_LIMIT} pasien pertama (kunjungan terbaru lebih dulu) &mdash; yang cocok kemungkinan
          lebih banyak. Persempit filter supaya jelas siapa saja yang dikirimi.
        </p>
      )}

      <ComposeForm
        hiddenFilters={{
          // Kunci tetap dikirim walau nilainya kosong: kosong = "tanpa batas
          // waktu", sedangkan kunci yang HILANG dibaca server action sebagai
          // hal yang sama tanpa pernah dinyatakan. Membuatnya eksplisit
          // menjaga apa yang dikirim tetap sama dengan apa yang dipratinjau.
          dateFrom: [filters.dateFrom ? formatSqlDate(filters.dateFrom) : ''],
          dateTo: [filters.dateTo ? formatSqlDate(filters.dateTo) : ''],
          kab: [...selectedKab],
          kec: [...selectedKec],
          pj: [...selectedPj],
          cari: filters.cari ? [filters.cari] : [],
          // Mode dan daftar centang ikut dikirim ke server action, yang
          // MENJALANKAN ULANG query-nya sendiri dari keduanya -- baris pratinjau
          // tidak pernah jadi sumber kebenaran siapa yang dikirimi.
          mode: [mode],
          rm: modePilih ? pilihan.daftar : [],
        }}
        sampleVars={sampleVars}
        total={summary.total}
        reachable={summary.reachable}
        modePilih={modePilih}
        belumDimuat={belumDimuat}
        uniqueCodeFooter={uniqueCodeFooter}
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
