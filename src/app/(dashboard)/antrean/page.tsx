import { Op, type WhereOptions } from 'sequelize';
import { Outbox, type OutboxStatus } from '@/models';
import { normalizePhone } from '@/core/phone';
import { resendOutboxAction } from './actions';
import {
  PageHeader,
  FilterChip,
  Badge,
  Button,
  Input,
  EmptyState,
  Pagination,
  outboxStatusVariant,
  outboxStatusLabel,
  OUTBOX_STATUS_LABEL,
  OUTBOX_STATUS_HELP,
  triggerLabel,
  IconInbox,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';

const PAGE_SIZE = 50;
const STATUSES: OutboxStatus[] = [
  'pending',
  'sending',
  'sent',
  'failed',
  'failed_permanent',
  'skipped_no_contact',
  'skipped_opt_out',
  'expired',
];
const RESENDABLE: OutboxStatus[] = ['failed', 'failed_permanent', 'expired'];

/**
 * Pencarian satu kotak untuk tiga hal yang berbeda, karena penelepon hanya
 * tahu SALAH SATU: no. RM, nomor WhatsApp-nya sendiri, atau kode pengiriman
 * yang tertulis di pesan.
 *
 * Kode pengiriman hanya bisa dicari lewat `body LIKE` -- ia sengaja tidak
 * disimpan di kolom tersendiri (lihat CLAUDE.md § kode unik), dan karena
 * diturunkan dari kunci idempoten lewat hash, ia juga tidak bisa dihitung
 * mundur menjadi baris tertentu. Itu berarti satu pemindaian `outbox` per
 * pencarian. Ditanggung sadar-sadar: ini tindakan sesekali saat ada yang
 * menelepon, bukan kueri yang berjalan sendiri, dan `outbox` dipangkas pada
 * 90 hari sehingga tidak tumbuh tanpa batas.
 *
 * Nomor telepon dinormalkan lewat `normalizePhone()` yang SAMA dipakai
 * pipeline, bukan dicocokkan apa adanya -- petugas mengetik `0822...` atau
 * `+62822...` sementara yang tersimpan `62822...`, dan pencarian yang gagal
 * karena bentuk penulisan akan terbaca sebagai "pesannya tidak ada".
 */
function buildSearchWhere(q: string): WhereOptions {
  const alternatif: WhereOptions[] = [
    { noRkmMedis: q }, // persis, lewat ix_rm
    { body: { [Op.like]: `%${q}%` } }, // kode pengiriman atau penggalan isi
  ];

  const telepon = normalizePhone(q);
  if (telepon.ok) alternatif.push({ phoneE164: telepon.value });

  return { [Op.or]: alternatif };
}

export default async function AntreanPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const { status, page: pageParam, q: qParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const q = qParam?.trim() ?? '';

  const active = status && STATUSES.includes(status as OutboxStatus) ? (status as OutboxStatus) : null;

  const syarat: WhereOptions[] = [];
  if (active) syarat.push({ status: active });
  if (q) syarat.push(buildSearchWhere(q));
  const where: WhereOptions = syarat.length > 0 ? { [Op.and]: syarat } : {};

  const { rows, count } = await Outbox.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const bagian = (p: number) =>
    [active ? `status=${active}` : '', q ? `q=${encodeURIComponent(q)}` : '', `page=${p}`].filter(Boolean).join('&');
  const hrefFor = (p: number) => `/antrean?${bagian(p)}`;
  // Chip status harus MEMPERTAHANKAN pencarian yang sedang aktif -- kalau
  // tidak, menyaring "gagal" atas hasil pencarian justru membuang pencariannya
  // dan menampilkan seluruh antrean.
  const chipHref = (s: OutboxStatus | null) =>
    `/antrean?${[s ? `status=${s}` : '', q ? `q=${encodeURIComponent(q)}` : ''].filter(Boolean).join('&')}`;

  return (
    <div>
      <PageHeader
        title="Antrean pesan"
        description="Semua pesan yang pernah masuk antrean kirim -- termasuk yang sudah terkirim, gagal, atau sengaja dilewati."
      />

      {/* Pertanyaan tersering dari telepon pasien -- "kenapa saya tidak
          menerima pesan?" -- hanya bisa dijawab dengan menemukan barisnya.
          Sebelum kotak ini ada, satu-satunya jalannya lewat SQL langsung,
          yang justru dilarang untuk petugas. */}
      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        {active && <input type="hidden" name="status" value={active} />}
        <Input
          name="q"
          defaultValue={q}
          fieldSize="sm"
          placeholder="Cari no. RM, nomor WhatsApp, atau kode pengiriman..."
          className="w-full sm:w-96"
        />
        <Button type="submit" variant="secondary" size="sm">
          Cari
        </Button>
        {q && (
          <a href={chipHref(active)} className="text-xs text-muted-foreground underline">
            hapus pencarian
          </a>
        )}
      </form>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip href={chipHref(null)} active={!active}>
          Semua
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} href={chipHref(s)} active={active === s}>
            {OUTBOX_STATUS_LABEL[s]}
          </FilterChip>
        ))}
      </div>

      {q && (
        <p className="mb-4 text-sm text-muted-foreground">
          {count} pesan cocok dengan &ldquo;{q}&rdquo;
          {active && ` dan berstatus "${OUTBOX_STATUS_LABEL[active]}"`}.
        </p>
      )}

      {/* Saat satu status dipilih, jelaskan artinya sekali di sini alih-alih
          mengandalkan petugas menebak dari nama statusnya. */}
      {active && <p className="mb-4 text-sm text-muted-foreground">{OUTBOX_STATUS_HELP[active]}</p>}

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Jenis pesan</th>
              <th className={cellClass}>No. RM</th>
              <th className={`${cellClass} hidden md:table-cell`}>Nomor</th>
              <th className={`${cellClass} hidden lg:table-cell`}>Isi</th>
              <th className={cellClass}>Status</th>
              <th className={`${cellClass} hidden sm:table-cell`}>Kejadian</th>
              <th className={`${cellClass} hidden xl:table-cell`}>Terkirim</th>
              <th className={cellClass}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass}>
                {/* Label manusia di depan, kode mesin tetap tersedia lewat
                    tooltip -- tiket dukungan dan baris log memakai kodenya. */}
                <td className={cellClass} title={row.triggerCode}>
                  {triggerLabel(row.triggerCode)}
                </td>
                <td className={`${cellClass} tabular-nums`}>{row.noRkmMedis ?? '-'}</td>
                <td className={`${cellClass} hidden tabular-nums md:table-cell`}>{row.phoneE164 ?? '-'}</td>
                <td className={`${cellClass} hidden max-w-xs truncate lg:table-cell`} title={row.body}>
                  {row.body}
                </td>
                <td className={cellClass}>
                  <Badge variant={outboxStatusVariant(row.status)}>{outboxStatusLabel(row.status)}</Badge>
                </td>
                <td className={`${cellClass} hidden whitespace-nowrap text-xs sm:table-cell`}>
                  {row.eventAt.toLocaleString('id-ID')}
                </td>
                <td className={`${cellClass} hidden whitespace-nowrap text-xs xl:table-cell`}>
                  {row.sentAt ? row.sentAt.toLocaleString('id-ID') : '-'}
                </td>
                <td className={cellClass}>
                  {RESENDABLE.includes(row.status) && (
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
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={<IconInbox className="h-5 w-5" />}
                    title={
                      q
                        ? `Tidak ada pesan cocok dengan "${q}"`
                        : active
                          ? `Tidak ada pesan berstatus "${OUTBOX_STATUS_LABEL[active]}"`
                          : 'Antrean masih kosong'
                    }
                  >
                    {/* Nol hasil pencarian punya dua sebab yang sangat berbeda,
                        dan menyamakan keduanya membuat petugas menyimpulkan
                        "pesannya tidak pernah dibuat" padahal mungkin hanya
                        sudah lewat masa simpan. */}
                    {q
                      ? 'Periksa lagi ketikannya. Perlu diingat: pesan yang lebih tua dari 90 hari sudah dipangkas otomatis, jadi tidak ditemukan di sini bukan berarti dulu tidak pernah terkirim.'
                      : active
                        ? 'Coba pilih status lain, atau lihat Semua.'
                        : 'Pesan muncul di sini segera setelah worker mendeteksi kejadiannya di Khanza.'}
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} count={count} hrefFor={hrefFor} unit="pesan" />
    </div>
  );
}
