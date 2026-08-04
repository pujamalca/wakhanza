import { redirect } from 'next/navigation';
import { Op, fn, col } from 'sequelize';
import { auth } from '@/auth';
import { AutoReplyRule, AutoReplyLog, parseKeywords, getSettingBool, getSettingNumber, getSetting } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { PageHeader, Card, Pagination } from '@/components/ui';
import { MasterSwitch } from './MasterSwitch';
import { TestBox } from './TestBox';
import { RuleTable } from './RuleTable';

// Angka ringkasan dan sakelar dibaca tiap kali halaman dibuka -- tidak boleh
// tersaji dari cache build.
export const dynamic = 'force-dynamic';

const HARI_RINGKASAN = 7;

/**
 * Sengaja memakai `outcome`, bukan menghitung baris outbox: yang perlu dilihat
 * staf di halaman ini adalah seberapa sering pasien bertanya sesuatu yang
 * BELUM punya aturan (`no_match`) -- dan pertanyaan itu tidak meninggalkan
 * jejak apa pun di outbox justru karena tidak dibalas.
 */
async function ringkasan() {
  const sejak = new Date(Date.now() - HARI_RINGKASAN * 24 * 60 * 60 * 1000);
  const rows = (await AutoReplyLog.findAll({
    attributes: ['outcome', [fn('COUNT', col('id')), 'jumlah']],
    where: { createdAt: { [Op.gte]: sejak } },
    group: ['outcome'],
    raw: true,
  })) as unknown as Array<{ outcome: string; jumlah: number | string }>;

  const map = new Map(rows.map((r) => [r.outcome, Number(r.jumlah)]));
  return {
    matched: map.get('matched') ?? 0,
    fallback: map.get('fallback') ?? 0,
    noMatch: map.get('no_match') ?? 0,
    rateLimited: map.get('rate_limited') ?? 0,
    duplicate: map.get('duplicate') ?? 0,
  };
}

/** Aturan mana yang benar-benar terpakai -- aturan nol pemakaian biasanya salah kata kunci. */
async function pemakaianPerAturan() {
  const sejak = new Date(Date.now() - HARI_RINGKASAN * 24 * 60 * 60 * 1000);
  const rows = (await AutoReplyLog.findAll({
    attributes: ['ruleId', [fn('COUNT', col('id')), 'jumlah']],
    where: { createdAt: { [Op.gte]: sejak }, ruleId: { [Op.ne]: null } },
    group: ['ruleId'],
    raw: true,
  })) as unknown as Array<{ ruleId: number; jumlah: number | string }>;
  return new Map(rows.map((r) => [Number(r.ruleId), Number(r.jumlah)]));
}

function Angka({ label, nilai, warna, help }: { label: string; nilai: number; warna?: string; help: string }) {
  return (
    <div className="rounded-lg border bg-card p-3" title={help}>
      <div className={`text-2xl font-semibold tabular-nums ${warna ?? ''}`}>{nilai}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default async function BalasanOtomatisPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  // Konsisten dengan /broadcast dan /audit: operator diarahkan ke Ringkasan,
  // bukan diberi halaman kosong yang tidak bisa dipakai.
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { page: pageParam } = await searchParams;
  const p = hitungPaginasi(bacaHalaman(pageParam), await AutoReplyRule.count(), UKURAN_HALAMAN.konfigurasi);

  const [enabled, rules, stat, pakai, maxPerJam, fallbackBody, simpanTeks] = await Promise.all([
    getSettingBool('autoreply.enabled', false),
    // Urutan `priority, id` adalah urutan yang MENENTUKAN aturan mana yang
    // menang -- jadi ia juga urutan halamannya. Aturan berprioritas tertinggi
    // selalu di halaman 1, tempat orang mencarinya.
    AutoReplyRule.findAll({
      order: [['priority', 'ASC'], ['id', 'ASC']],
      limit: p.limit,
      offset: p.offset,
    }),
    ringkasan(),
    pemakaianPerAturan(),
    getSettingNumber('autoreply.max_per_number_per_hour', 5),
    getSetting('autoreply.fallback_body', ''),
    getSettingBool('autoreply.log_inbound_text', false),
  ]);

  const adaFallback = Boolean(fallbackBody?.trim());

  return (
    <div>
      <PageHeader
        title="Balasan otomatis"
        description="Membalas sendiri pesan yang masuk dari pasien berdasarkan kata kunci — misalnya mengirimkan jadwal dokter saat pasien menanyakannya."
      />

      <MasterSwitch enabled={enabled} canEdit />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Angka
          label={`Dibalas (${HARI_RINGKASAN} hari)`}
          nilai={stat.matched + stat.fallback}
          help="Pesan masuk yang cocok dengan salah satu aturan, lalu balasannya masuk antrean kirim."
        />
        <Angka
          label="Tidak ada aturan yang cocok"
          nilai={stat.noMatch}
          warna={stat.noMatch > 0 ? 'text-warning' : undefined}
          help="Pasien bertanya sesuatu yang belum tercakup aturan mana pun, jadi tidak dibalas. Angka yang terus naik berarti ada kata kunci yang perlu ditambah."
        />
        <Angka
          label="Melebihi kuota nomor"
          nilai={stat.rateLimited}
          warna={stat.rateLimited > 0 ? 'text-warning' : undefined}
          help={`Satu nomor mengirim lebih dari ${maxPerJam} pesan yang perlu dibalas dalam satu jam. Sisanya sengaja tidak dibalas agar nomor rumah sakit tidak terbaca sebagai spam.`}
        />
        <Angka
          label="Pesan berulang"
          nilai={stat.duplicate}
          help="Pesan yang sama diserahkan ulang oleh WhatsApp (lazim setelah sesi tersambung kembali) dan sengaja tidak dibalas dua kali."
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <TestBox />
        <Card>
          <div className="space-y-3 text-sm">
            <h3 className="font-medium">Cara kerjanya</h3>
            <ol className="ml-4 list-decimal space-y-1.5 text-muted-foreground">
              <li>
                Pasien mengirim pesan ke nomor WhatsApp rumah sakit. Permintaan{' '}
                <span className="font-mono text-xs">Berhenti Kirim Otomatis</span> selalu diperiksa lebih dulu dan tidak pernah
                bisa disandera aturan di bawah.
              </li>
              <li>
                Aturan diperiksa berurutan dari <span className="font-medium">urutan terkecil</span>. Yang pertama cocok yang
                dipakai — satu pesan hanya pernah dibalas satu kali.
              </li>
              <li>
                Balasannya masuk ke antrean kirim yang sama dengan notifikasi lain, jadi ikut tercatat di Antrean dan Log. Jam
                tenang <span className="font-medium">tidak berlaku</span> di sini: pasien sedang menunggu jawaban atas pesannya
                sendiri.
              </li>
              <li>
                Pasien yang meminta <span className="font-mono text-xs">Berhenti Kirim Otomatis</span>{' '}
                <span className="font-medium">tetap dibalas di sini</span> — yang ia hentikan adalah pemberitahuan otomatis
                (antrian, hasil, obat, tagihan, pengingat jadwal), bukan jawaban atas pesan yang ia kirim sendiri.
              </li>
            </ol>
            <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs">
              <span className="font-medium">Bukan untuk pertanyaan medis.</span> Sistem ini hanya mencocokkan kata kunci — tidak
              memahami keluhan. Pesan yang tidak cocok sengaja dibiarkan tanpa jawaban supaya tetap dibaca petugas.
            </div>
            <p className="text-xs text-muted-foreground">
              Pesan cadangan saat tidak ada yang cocok: {adaFallback ? 'aktif' : <span className="font-medium">tidak ada (diam)</span>}
              . Menyimpan teks pesan pasien untuk penyetelan kata kunci:{' '}
              {simpanTeks ? <span className="font-medium text-warning">menyala</span> : 'mati'}. Keduanya diatur di Pengaturan.
            </p>
          </div>
        </Card>
      </div>

      <h2 className="mb-1 font-medium">Aturan</h2>

      <RuleTable
        hariRingkasan={HARI_RINGKASAN}
        rules={rules.map((r) => ({
          id: r.id,
          label: r.label,
          keywords: parseKeywords(r.keywords),
          matchMode: r.matchMode,
          body: r.body,
          priority: r.priority,
          isActive: r.isActive,
          usage: pakai.get(r.id) ?? 0,
        }))}
      />

      <Pagination
        page={p.halaman}
        totalPages={p.totalHalaman}
        count={p.jumlah}
        hrefFor={(n) => hrefHalaman('/balasan-otomatis', {}, n)}
        unit="aturan"
      />
    </div>
  );
}
