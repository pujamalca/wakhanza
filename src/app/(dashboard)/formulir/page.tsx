import { redirect } from 'next/navigation';
import { Op } from 'sequelize';
import { auth } from '@/auth';
import {
  WaForm,
  WaFormField,
  WaFormEntry,
  parseKeywords,
  parseJawaban,
  getSettingBool,
  type StatusEntry,
} from '@/models';
import { isTipeField, type TipeField } from '@/core/waFormulir';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { isGroupAddress } from '@/core/waAddress';
import { Card, HelpPanel, PageHeader, Section, Tabs, Pagination, FilterChip } from '@/components/ui';
import { BantuanFormulir } from './bantuan';
import { MasterSwitch } from './Switches';
import { FormTable, type FormRow } from './FormTable';
import { EntryTable, type EntryRow } from './EntryTable';

/**
 * FORMULIR LEWAT WHATSAPP (051).
 *
 * ==========================================================================
 * Urutan bagian: PEKERJAAN dulu di tab Masuk, PENGATURAN di tab Formulir
 * ==========================================================================
 *
 * Tab bawaannya `masuk`, bukan `formulir`, dan itu kebalikan dari urutan
 * membangunnya. Definisi formulir disusun sekali lalu tidak disentuh
 * berbulan-bulan; daftar permintaan yang belum ditindaklanjuti dibuka tiap hari.
 * Pelajaran yang sama sudah dibayar saat tab Darurat `/farmasi` dibalik dan saat
 * `/erm/penilaian-umum` menaruh tabelnya di atas jadwalnya.
 */

const RUTE = '/formulir';

const SEMUA_STATUS: StatusEntry[] = ['baru', 'diproses', 'selesai', 'batal'];

const LABEL_STATUS: Record<StatusEntry, string> = {
  baru: 'Baru',
  diproses: 'Diproses',
  selesai: 'Selesai',
  batal: 'Batal',
};

function bacaTab(v: string | string[] | undefined): 'masuk' | 'formulir' {
  return (Array.isArray(v) ? v[0] : v) === 'formulir' ? 'formulir' : 'masuk';
}

function bacaStatus(v: string | string[] | undefined): StatusEntry | null {
  const s = Array.isArray(v) ? v[0] : v;
  return SEMUA_STATUS.includes(s as StatusEntry) ? (s as StatusEntry) : null;
}

/** `dd/MM HH:mm` -- cukup untuk daftar kerja, dan muat di kolom sempit. */
function waktuSingkat(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function FormulirPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const sp = await searchParams;
  const tab = bacaTab(sp.tab);
  const status = bacaStatus(sp.status);

  const enabled = await getSettingBool('formulir.enabled', false);

  // Selalu dibaca: jumlahnya menentukan peringatan "menyala tapi belum ada
  // formulir aktif" di sakelar utama, yang tampil di KEDUA tab. Tabel konfigurasi
  // kecil di `wakhanza`, bukan `sik`.
  const jumlahAktif = await WaForm.count({ where: { isActive: true } });

  const href = (t: string, s?: StatusEntry | null) => {
    const q = new URLSearchParams();
    q.set('tab', t);
    if (s) q.set('status', s);
    return `${RUTE}?${q.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Formulir lewat WhatsApp"
        description="Pasien mengisi lewat percakapan, jawabannya masuk ke daftar kerja di sini."
        help={
          <HelpPanel title="Tentang formulir lewat WhatsApp">
            <BantuanFormulir />
          </HelpPanel>
        }
      />

      <MasterSwitch enabled={enabled} jumlahAktif={jumlahAktif} />

      <Tabs
        label="Bagian halaman Formulir"
        active={tab}
        items={[
          { key: 'masuk', href: href('masuk'), label: 'Masuk' },
          {
            key: 'formulir',
            href: href('formulir'),
            label: 'Formulir',
            status: jumlahAktif > 0 ? 'success' : 'warning',
            statusLabel: jumlahAktif > 0 ? `${jumlahAktif} formulir aktif` : 'belum ada yang aktif',
          },
        ]}
      />

      {tab === 'masuk' ? (
        <TabMasuk sp={sp} status={status} href={href} />
      ) : (
        <TabFormulir />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

async function TabFormulir() {
  const rows = await WaForm.findAll({ order: [['priority', 'ASC'], ['id', 'ASC']] });

  // Pertanyaan dan jumlah jawaban dibaca sekali untuk SELURUH formulir, bukan
  // satu query per baris: `/administrasi` sudah membayar pelajaran N+1 itu.
  const ids = rows.map((r) => r.id);
  const [fields, masuk] = await Promise.all([
    ids.length > 0
      ? WaFormField.findAll({ where: { formId: { [Op.in]: ids } }, order: [['urutan', 'ASC'], ['id', 'ASC']] })
      : Promise.resolve([]),
    ids.length > 0
      ? WaFormEntry.findAll({
          where: { formId: { [Op.in]: ids } },
          attributes: ['formId'],
          raw: true,
        })
      : Promise.resolve([] as Array<{ formId: number }>),
  ]);

  const perForm = new Map<number, FormRow['fields']>();
  for (const f of fields) {
    const daftar = perForm.get(f.formId) ?? [];
    daftar.push({
      label: f.label,
      tipe: (isTipeField(f.tipe) ? f.tipe : 'teks') as TipeField,
      wajib: f.wajib,
      pilihan: f.pilihanJson ? (JSON.parse(f.pilihanJson) as string[]) : [],
      maksPanjang: f.maksPanjang,
    });
    perForm.set(f.formId, daftar);
  }

  const jumlahMasuk = new Map<number, number>();
  for (const m of masuk as Array<{ formId: number }>) {
    jumlahMasuk.set(m.formId, (jumlahMasuk.get(m.formId) ?? 0) + 1);
  }

  const forms: FormRow[] = rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    kataKunci: parseKeywords(r.kataKunci),
    matchMode: r.matchMode === 'exact' ? 'exact' : 'contains',
    priority: r.priority,
    pesanPembuka: r.pesanPembuka,
    pesanPenutup: r.pesanPenutup,
    isActive: r.isActive,
    bolehGrup: r.bolehGrup,
    fields: perForm.get(r.id) ?? [],
    jumlahMasuk: jumlahMasuk.get(r.id) ?? 0,
  }));

  return (
    <Section title="Formulir tersimpan">
      <Card>
        <FormTable forms={forms} />
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------

async function TabMasuk({
  sp,
  status,
  href,
}: {
  sp: Record<string, string | string[] | undefined>;
  status: StatusEntry | null;
  href: (t: string, s?: StatusEntry | null) => string;
}) {
  const where = status ? { status } : {};
  const diminta = bacaHalaman(sp.page);
  const jumlah = await WaFormEntry.count({ where });
  const p = hitungPaginasi(diminta, jumlah, UKURAN_HALAMAN.riwayat);

  const rows = await WaFormEntry.findAll({
    where,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: p.limit,
    offset: p.offset,
  });

  // Jumlah per status untuk chip -- satu query bergerombol, bukan satu per chip.
  const perStatus = (await WaFormEntry.findAll({
    attributes: ['status', [WaFormEntry.sequelize!.fn('COUNT', '*'), 'n']],
    group: ['status'],
    raw: true,
  })) as unknown as Array<{ status: StatusEntry; n: number }>;
  const hitung = new Map(perStatus.map((r) => [r.status, Number(r.n)]));

  const entries: EntryRow[] = rows.map((r) => ({
    id: r.id,
    formNama: r.formNama,
    phoneE164: r.phoneE164,
    noRkmMedis: r.noRkmMedis,
    dariGrup: isGroupAddress(r.chatId),
    jawaban: parseJawaban(r.jawabanJson),
    status: r.status,
    catatan: r.catatan,
    ditanganiOleh: r.ditanganiOleh,
    createdAt: waktuSingkat(r.createdAt),
  }));

  return (
    <Section title="Jawaban masuk">
      <Card>
        <div className="mb-3 flex flex-wrap gap-1">
          <FilterChip href={href('masuk')} active={status === null}>
            Semua ({jumlah})
          </FilterChip>
          {SEMUA_STATUS.map((s) => (
            <FilterChip key={s} href={href('masuk', s)} active={status === s}>
              {LABEL_STATUS[s]} ({hitung.get(s) ?? 0})
            </FilterChip>
          ))}
        </div>

        <EntryTable entries={entries} />

        {p.totalHalaman > 1 && (
          <div className="mt-3">
            <Pagination
              page={p.halaman}
              totalPages={p.totalHalaman}
              count={p.jumlah}
              unit="jawaban"
              hrefFor={(n) => hrefHalaman(RUTE, { tab: 'masuk', status }, n)}
            />
          </div>
        )}

        <p className="mt-3 text-caption text-muted-foreground">
          Jawaban dipangkas otomatis menurut <span className="font-mono">formulir.simpan_hari</span> (bawaan 90 hari).
          Yang sudah lewat masa simpannya tidak bisa dikembalikan.
        </p>
      </Card>
    </Section>
  );
}
