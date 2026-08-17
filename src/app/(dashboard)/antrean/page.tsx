import { Op, type WhereOptions } from 'sequelize';
import { Outbox, type OutboxStatus } from '@/models';
import { ACK_ERROR, labelAck, sudahSampai } from '@/core/waAck';
import { normalizePhone } from '@/core/phone';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { resendOutboxAction } from './actions';
import { LihatPesan, type RincianPesan } from './LihatPesan';
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

/**
 * Dirakit di SERVER lalu diserahkan sebagai string yang sudah jadi, bukan
 * sebagai `Date` dan kode mentah.
 *
 * Dua sebabnya. `toLocaleString('id-ID')` di komponen klien dijalankan mesin
 * PETUGAS, jadi hasilnya bisa berbeda dari yang dirender server untuk baris
 * yang sama di tabel yang sama -- selain memicu ketidakcocokan hidrasi.
 * Kedua, pelabelan (`triggerLabel`, `outboxStatusLabel`, `labelAck`) sudah jadi
 * satu penurunan bersama di `components/ui/labels.ts`; menyerahkan kode mentah
 * berarti komponen klien memutuskan sendiri lagi, dan yang menyimpang adalah
 * yang paling jarang dilihat.
 */
function rincianDari(row: Outbox): RincianPesan {
  const grup = !!row.chatId;
  return {
    jenis: triggerLabel(row.triggerCode),
    kodePemicu: row.triggerCode,
    noRkmMedis: row.noRkmMedis,
    tujuan: row.chatId ?? row.phoneE164,
    tujuanGrup: grup,
    status: outboxStatusLabel(row.status),
    ack: row.status === 'sent' ? labelAck(row.ackLevel, grup) : null,
    kejadian: row.eventAt.toLocaleString('id-ID'),
    dijadwalkan: row.scheduledAt.toLocaleString('id-ID'),
    // Sengaja tidak menyebut SEBABNYA. Jam tenang memang satu-satunya yang
    // memundurkan `scheduled_at` saat enqueue, tapi tombol "Kirim ulang" juga
    // menulisnya ke waktu sekarang -- jadi menuduh jam tenang di sini akan
    // keliru justru pada baris yang paling sering dibuka orang.
    dimundurkan: row.scheduledAt.getTime() - row.eventAt.getTime() > 1000,
    terkirim: row.sentAt ? row.sentAt.toLocaleString('id-ID') : null,
    percobaan: row.attempts,
    lampiran: row.mediaName,
    galat: row.lastError,
    isi: row.body,
  };
}

export default async function AntreanPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const { status, page: pageParam, q: qParam } = await searchParams;
  const q = qParam?.trim() ?? '';

  const active = status && STATUSES.includes(status as OutboxStatus) ? (status as OutboxStatus) : null;

  const syarat: WhereOptions[] = [];
  if (active) syarat.push({ status: active });
  if (q) syarat.push(buildSearchWhere(q));
  const where: WhereOptions = syarat.length > 0 ? { [Op.and]: syarat } : {};

  const jumlah = await Outbox.count({ where });
  const p = hitungPaginasi(bacaHalaman(pageParam), jumlah, UKURAN_HALAMAN.riwayat);

  const rows = await Outbox.findAll({
    where,
    order: [['id', 'DESC']],
    limit: p.limit,
    offset: p.offset,
  });

  const saringan = { status: active, q };
  const hrefFor = (n: number) => hrefHalaman('/antrean', saringan, n);
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
          {p.jumlah} pesan cocok dengan &ldquo;{q}&rdquo;
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
                {/* `line-clamp-2` + `whitespace-pre-line`, BUKAN `truncate`:
                    883 dari 885 baris produksi berbaris banyak, dan `truncate`
                    meratakannya jadi satu baris terpotong sehingga yang
                    terlihat bukan awal pesannya melainkan awal kalimat pertama
                    yang disambung kalimat kedua. Atribut `title` dibuang --
                    isinya sudah pindah ke tombol Lihat, dan tooltip bawaan
                    peramban tidak pernah muncul di layar sentuh. */}
                <td className={`${cellClass} hidden max-w-xs align-top lg:table-cell`}>
                  <span className="line-clamp-2 whitespace-pre-line text-muted-foreground">{row.body}</span>
                </td>
                {/* Konfirmasi ditempelkan ke sel Status, BUKAN jadi kolom
                    kesembilan. Tabel ini sudah menyembunyikan empat kolom di
                    bawah xl, jadi kolom baru akan berakhir tak pernah terlihat
                    di layar loket -- persis yang sudah terjadi pada centang
                    tujuan di /farmasi. Status justru tempat mata staf sudah
                    tertuju saat menjawab "pesannya sampai tidak". */}
                <td className={cellClass}>
                  <Badge variant={outboxStatusVariant(row.status)}>{outboxStatusLabel(row.status)}</Badge>
                  {row.status === 'sent' && (
                    <span
                      className={`mt-1 block text-xs ${
                        row.ackLevel === ACK_ERROR
                          ? 'text-destructive'
                          : sudahSampai(row.ackLevel)
                            ? 'text-success'
                            : 'text-muted-foreground'
                      }`}
                      title={
                        row.ackLevel === null || row.ackLevel === undefined
                          ? 'Konfirmasi hanya tiba selama sesi yang mengirimnya masih hidup. Kosong BUKAN berarti pesannya tidak sampai.'
                          : row.ackAt
                            ? `Tercatat ${row.ackAt.toLocaleString('id-ID')}`
                            : undefined
                      }
                    >
                      {labelAck(row.ackLevel, !!row.chatId)}
                    </span>
                  )}
                </td>
                <td className={`${cellClass} hidden whitespace-nowrap text-xs sm:table-cell`}>
                  {row.eventAt.toLocaleString('id-ID')}
                </td>
                <td className={`${cellClass} hidden whitespace-nowrap text-xs xl:table-cell`}>
                  {row.sentAt ? row.sentAt.toLocaleString('id-ID') : '-'}
                </td>
                <td className={cellClass}>
                  <div className="flex items-center justify-end gap-1">
                    {/* Tidak ikut disembunyikan di layar sempit: di bawah 1024
                        px kolom "Isi" hilang, jadi tombol ini satu-satunya
                        jalan menuju isi pesannya. */}
                    <LihatPesan rincian={rincianDari(row)} />
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
                  </div>
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

      <Pagination page={p.halaman} totalPages={p.totalHalaman} count={p.jumlah} hrefFor={hrefFor} unit="pesan" />
    </div>
  );
}
