import { Op, fn, col } from 'sequelize';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { InboundMessage, WaGroup, WaSession, getSettingBool, getSettingNumber } from '@/models';
import {
  PageHeader,
  FilterChip,
  Badge,
  CopyButton,
  EmptyState,
  IconInbox,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { GrupPanel, type GrupRow } from './GrupPanel';
import { SimpanTeksSwitch } from './SimpanTeksSwitch';

const PER_HALAMAN = 100;

/** Jenis pesan WhatsApp yang tidak jelas artinya bagi petugas. */
const TIPE_LABEL: Record<string, string> = {
  chat: 'Teks',
  image: 'Gambar',
  video: 'Video',
  audio: 'Audio',
  ptt: 'Pesan suara',
  document: 'Dokumen',
  sticker: 'Stiker',
  location: 'Lokasi',
  vcard: 'Kontak',
  revoked: 'Ditarik kembali',
  e2e_notification: 'Notifikasi sistem',
};

type Saringan = 'semua' | 'perorangan' | 'grup' | 'belum-dibalas';

/**
 * Di luar badan komponen karena `Date.now()` adalah pemanggilan tak murni, dan
 * `react-hooks/purity` menolaknya saat render -- aturan yang benar: dua render
 * atas data yang sama tidak boleh memberi hasil berbeda hanya karena waktunya
 * berjalan.
 */
async function hitungBarisKedaluwarsa(hariSimpan: number): Promise<number> {
  const sejak = new Date(Date.now() - hariSimpan * 24 * 60 * 60 * 1000);
  return InboundMessage.count({ where: { createdAt: { [Op.lt]: sejak } } });
}

function whereUntuk(saringan: Saringan) {
  if (saringan === 'perorangan') return { jenis: 'perorangan' as const };
  if (saringan === 'grup') return { jenis: 'grup' as const };
  // "Belum dibalas" sengaja dibatasi ke perorangan: pesan grup memang TIDAK
  // pernah dibalas otomatis (lihat wa-client.ts), jadi memasukkannya akan
  // membuat daftar ini selalu penuh oleh baris yang tidak menunggu jawaban
  // siapa pun -- dan menenggelamkan pertanyaan pasien yang benar-benar
  // menunggu, yaitu satu-satunya alasan saringan ini ada.
  if (saringan === 'belum-dibalas') return { jenis: 'perorangan' as const, dibalas: false };
  return {};
}

export default async function PesanMasukPage({
  searchParams,
}: {
  searchParams: Promise<{ saring?: string }>;
}) {
  const session = await auth();
  // Isi pesan pasien bisa memuat keluhan medis, jadi halaman ini admin-only --
  // sama seperti /audit dan /balasan-otomatis. Nav sudah menyembunyikannya
  // untuk operator, tapi akses langsung lewat URL harus ditolak di server.
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { saring } = await searchParams;
  const saringan: Saringan = (['perorangan', 'grup', 'belum-dibalas'] as const).includes(saring as never)
    ? (saring as Saringan)
    : 'semua';

  const [pesan, cocok, jumlahSemua, jumlahPerorangan, jumlahGrup, jumlahBelumDibalas, grup, sesi, simpanTeks, hariSimpan] =
    await Promise.all([
      InboundMessage.findAll({ where: whereUntuk(saringan), order: [['id', 'DESC']], limit: PER_HALAMAN }),
      InboundMessage.count({ where: whereUntuk(saringan) }),
      InboundMessage.count(),
      InboundMessage.count({ where: { jenis: 'perorangan' } }),
      InboundMessage.count({ where: { jenis: 'grup' } }),
      InboundMessage.count({ where: { jenis: 'perorangan', dibalas: false } }),
      WaGroup.findAll({ order: [['nama', 'ASC']] }),
      WaSession.findByPk(1),
      getSettingBool('inbox.simpan_teks', true),
      getSettingNumber('inbox.simpan_hari', 30),
    ]);

  // Jumlah pesan per grup, satu kueri agregat -- bukan satu count per baris grup.
  const perGrup = await InboundMessage.findAll({
    attributes: ['chatId', [fn('COUNT', col('id')), 'jml']],
    where: { jenis: 'grup' },
    group: ['chatId'],
    raw: true,
  });
  const hitungGrup = new Map(
    (perGrup as unknown as Array<{ chatId: string; jml: number }>).map((r) => [r.chatId, Number(r.jml)]),
  );

  const barisGrup: GrupRow[] = grup.map((g) => ({
    chatId: g.chatId,
    nama: g.nama,
    jumlahPeserta: g.jumlahPeserta,
    pesan: hitungGrup.get(g.chatId) ?? 0,
    // Diformat di server: toLocaleString di komponen klien memberi hasil berbeda
    // antara render server dan klien, dan React melaporkannya sebagai hydration mismatch.
    syncedAt: g.syncedAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
  }));

  const barisLama = await hitungBarisKedaluwarsa(hariSimpan);

  return (
    <div>
      <PageHeader
        title="Pesan masuk"
        description="Pesan yang diterima nomor WhatsApp rumah sakit, dari perorangan maupun grup — berikut ID pengirim dan ID grupnya."
      />

      <GrupPanel grup={barisGrup} waSiap={sesi?.status === 'ready'} />

      <SimpanTeksSwitch aktif={simpanTeks} hariSimpan={hariSimpan} />

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterChip href="/pesan-masuk" active={saringan === 'semua'}>
            Semua ({jumlahSemua.toLocaleString('id-ID')})
          </FilterChip>
          <FilterChip href="/pesan-masuk?saring=perorangan" active={saringan === 'perorangan'}>
            Perorangan ({jumlahPerorangan.toLocaleString('id-ID')})
          </FilterChip>
          <FilterChip href="/pesan-masuk?saring=grup" active={saringan === 'grup'}>
            Grup ({jumlahGrup.toLocaleString('id-ID')})
          </FilterChip>
          <FilterChip href="/pesan-masuk?saring=belum-dibalas" active={saringan === 'belum-dibalas'}>
            Belum dibalas ({jumlahBelumDibalas.toLocaleString('id-ID')})
          </FilterChip>
        </div>

        {cocok > PER_HALAMAN && (
          <p className="mb-3 text-xs text-muted-foreground">
            Menampilkan {PER_HALAMAN} terbaru dari {cocok.toLocaleString('id-ID')}.
          </p>
        )}

        {pesan.length === 0 ? (
          <EmptyState icon={<IconInbox className="h-6 w-6" />} title="Belum ada pesan masuk yang tercatat">
            Pencatatan baru dimulai sejak fitur ini dipasang — pesan yang masuk sebelumnya tidak ikut terekam. Nol pesan
            seharian di nomor yang dipakai pasien adalah tanda rusak, bukan hari sepi.
          </EmptyState>
        ) : (
          <div className={tableWrapperClass}>
            <table className="w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className={`${cellClass} whitespace-nowrap`}>Waktu</th>
                  <th className={cellClass}>Pengirim</th>
                  <th className={cellClass}>ID pengirim</th>
                  <th className={`${cellClass} hidden lg:table-cell`}>Nomor</th>
                  <th className={`${cellClass} hidden sm:table-cell`}>Jenis</th>
                  <th className={cellClass}>Isi</th>
                  <th className={`${cellClass} hidden md:table-cell`}>Dibalas</th>
                </tr>
              </thead>
              <tbody>
                {pesan.map((m) => (
                  <tr key={m.id} className={rowClass}>
                    <td className={`${cellClass} whitespace-nowrap text-xs text-muted-foreground`}>
                      {m.createdAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className={cellClass}>
                      <div className="font-medium">{m.namaKontak ?? <span className="text-muted-foreground">—</span>}</div>
                      {m.jenis === 'grup' && (
                        <div className="text-xs text-muted-foreground">di {m.namaChat ?? 'grup'}</div>
                      )}
                    </td>
                    <td className={cellClass}>
                      {m.pengirimId ? (
                        <div className="flex items-center gap-1">
                          <span className="break-all font-mono text-xs text-muted-foreground">{m.pengirimId}</span>
                          <CopyButton value={m.pengirimId} label="ID pengirim" />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {m.jenis === 'grup' && (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="break-all font-mono text-[11px] text-muted-foreground/70">{m.chatId}</span>
                          <CopyButton value={m.chatId} label="ID grup" />
                        </div>
                      )}
                    </td>
                    <td className={`${cellClass} hidden whitespace-nowrap font-mono text-xs lg:table-cell`}>
                      {m.phoneE164 ?? (
                        // Kolom kosong di sini BUKAN detail sepele: pengalamatan
                        // @lid yang nomornya tidak terpetakan pernah membuat
                        // pesan pasien hilang berjam-jam tanpa jejak.
                        <span className="text-warning" title="Nomor tidak bisa dipetakan dari pengalamatan @lid">
                          tidak terpetakan
                        </span>
                      )}
                    </td>
                    <td className={`${cellClass} hidden whitespace-nowrap sm:table-cell`}>
                      <Badge variant="neutral">{m.jenis === 'grup' ? 'Grup' : 'Perorangan'}</Badge>
                    </td>
                    <td className={`${cellClass} max-w-md`}>
                      {m.teks ? (
                        <span className="break-words">{m.teks.length > 200 ? `${m.teks.slice(0, 200)}…` : m.teks}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {m.tipe === 'chat'
                            ? `(isi tidak disimpan — ${m.panjangTeks} karakter)`
                            : (TIPE_LABEL[m.tipe] ?? m.tipe)}
                        </span>
                      )}
                      {m.teks && m.tipe !== 'chat' && (
                        <span className="ml-1 text-xs text-muted-foreground">({TIPE_LABEL[m.tipe] ?? m.tipe})</span>
                      )}
                    </td>
                    <td className={`${cellClass} hidden whitespace-nowrap md:table-cell`}>
                      {m.jenis === 'grup' ? (
                        <span className="text-xs text-muted-foreground" title="Pesan grup memang tidak pernah dibalas otomatis">
                          —
                        </span>
                      ) : (
                        <Badge variant={m.dibalas ? 'success' : 'neutral'}>{m.dibalas ? 'Ya' : 'Tidak'}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Pesan grup dicatat tapi tidak pernah dibalas otomatis.</span>{' '}
          Membalas di dalam grup berarti seluruh anggota menerima jawaban atas pertanyaan satu orang, dan satu percakapan
          ramai bisa memicu balasan beruntun — pola yang membuat nomor rumah sakit diblokir WhatsApp.
        </p>
        <p>
          <span className="font-medium text-foreground">Status kontak dan saluran tidak ikut dicatat.</span> Nomor rumah
          sakit menerima status dari setiap kontaknya; memasukkannya ke sini berarti ribuan baris sehari yang tidak
          seorang pun cari.
        </p>
        {barisLama > 0 && (
          <p>
            {barisLama.toLocaleString('id-ID')} baris sudah melewati {hariSimpan} hari dan akan dihapus pada pembersihan
            berkala berikutnya (02:00).
          </p>
        )}
      </div>
    </div>
  );
}
