import { redirect } from 'next/navigation';
import { Op } from 'sequelize';
import { auth } from '@/auth';
import {
  WaForm,
  WaFormField,
  WaFormEntry,
  WaFormTarget,
  WaGroup,
  WaSession,
  parseKeywords,
  parseJawaban,
  getSettingBool,
  type StatusEntry,
} from '@/models';
import { isTipeField, type TipeField } from '@/core/waFormulir';
import { bacaRincian } from '@/core/waFormulirTujuan';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { isGroupAddress } from '@/core/waAddress';
import { Card, HelpPanel, PageHeader, Section, Tabs, Pagination, FilterChip } from '@/components/ui';
import { BantuanFormulir } from './bantuan';
import { MasterSwitch } from './Switches';
import { FormTable, type FormRow } from './FormTable';
import { EntryTable, type EntryRow } from './EntryTable';
import { RentangTanggal } from './RentangTanggal';

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

/**
 * `YYYY-MM-DD` dari `<input type="date">` menjadi batas rentang.
 *
 * Nilai yang tidak berbentuk tanggal mengembalikan null -- rentangnya
 * DILEWATI, bukan dijadikan hari ini. Query string bisa disunting siapa saja,
 * dan menjatuhkannya ke hari ini akan membuat `?dari=kemarin-sore` diam-diam
 * menyembunyikan seluruh permintaan lama tanpa satu pun keterangan di layar.
 *
 * ==========================================================================
 * Jam dinding, bukan tengah malam UTC
 * ==========================================================================
 *
 * `new Date('2026-08-17')` diuraikan JavaScript sebagai tengah malam UTC, yaitu
 * pukul 07.00 WIB -- jadi rentang "17 Agustus" akan membuang tujuh jam pertama
 * harinya dan diam-diam menyeret tujuh jam pertama tanggal 18 ke dalamnya.
 * Konstruktor per-komponen di bawah selalu berarti tengah malam WAKTU SERVER,
 * yang memang jam yang dilihat staf.
 *
 * `sampai` berakhir pada 23:59:59.999 hari itu, bukan tengah malamnya: batas
 * eksklusif tengah malam akan membuang seluruh jawaban yang masuk pada hari
 * TERAKHIR rentang yang baru saja dipilih staf sendiri.
 */
function bacaBatas(nilai: string | string[] | undefined, akhirHari: boolean): Date | null {
  const s = Array.isArray(nilai) ? nilai[0] : nilai;
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const tanggal = akhirHari
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(tanggal.getTime()) ? null : tanggal;
}

/** Bentuk `YYYY-MM-DD` untuk mengisi kembali kotak tanggalnya. */
function teksTanggal(d: Date | null): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  const dari = bacaBatas(sp.dari, false);
  const sampai = bacaBatas(sp.sampai, true);

  /**
   * Rentang tanggal ikut ke SETIAP tautan chip status. Tanpa itu, menekan
   * "Selesai" diam-diam melepas rentang yang baru saja disetel staf -- dan yang
   * terlihat cuma daftar yang tiba-tiba jauh lebih panjang, tanpa satu pun
   * keterangan bahwa saringannya hilang. Bentuk kegagalan yang sama yang sudah
   * dibayar di `hrefHalaman()` (`core/pagination.ts`).
   */
  const href = (t: string, s?: StatusEntry | null) => {
    const q = new URLSearchParams();
    q.set('tab', t);
    if (s) q.set('status', s);
    if (t === 'masuk') {
      if (dari) q.set('dari', teksTanggal(dari));
      if (sampai) q.set('sampai', teksTanggal(sampai));
    }
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
        <TabMasuk sp={sp} status={status} dari={dari} sampai={sampai} href={href} />
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
  const [fields, masuk, semuaTujuan, grup, sesi] = await Promise.all([
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
    // Tidak dipaginasi: mengisi modal Tujuan per formulir, bukan tabel.
    ids.length > 0
      ? WaFormTarget.findAll({ where: { formId: { [Op.in]: ids } }, order: [['id', 'ASC']] })
      : Promise.resolve([]),
    // Pengisi dropdown pemilih grup, bukan tabel -- daftar pilihan yang
    // terpotong menyembunyikan grup tanpa satu pun tanda, dan staf menyimpulkan
    // grupnya belum tersinkron.
    WaGroup.findAll({ order: [['nama', 'ASC']] }),
    WaSession.findByPk(1),
  ]);

  const tujuanPerForm = new Map<number, FormRow['tujuan']>();
  for (const t of semuaTujuan) {
    const daftar = tujuanPerForm.get(t.formId) ?? [];
    daftar.push({ id: t.id, jenis: t.jenis, chatId: t.chatId, label: t.label, isActive: t.isActive });
    tujuanPerForm.set(t.formId, daftar);
  }

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
    tujuanRincian: bacaRincian(r.tujuanRincian),
    tujuan: tujuanPerForm.get(r.id) ?? [],
  }));

  return (
    <Section title="Formulir tersimpan">
      <Card>
        <FormTable
          forms={forms}
          grup={grup.map((g) => ({ chatId: g.chatId, nama: g.nama, jumlahPeserta: g.jumlahPeserta }))}
          waSiap={sesi?.status === 'ready'}
        />
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------

async function TabMasuk({
  sp,
  status,
  dari,
  sampai,
  href,
}: {
  sp: Record<string, string | string[] | undefined>;
  status: StatusEntry | null;
  dari: Date | null;
  sampai: Date | null;
  href: (t: string, s?: StatusEntry | null) => string;
}) {
  /**
   * Rentang tanggal dan status DIPISAH menjadi dua bagian `where`, dan
   * pemisahan itu bukan kerapian.
   *
   * Jumlah di tiap chip status harus dihitung DI DALAM rentang yang sedang
   * berlaku -- kalau tidak, chip berbunyi "Baru (12)" lalu tabelnya kosong
   * karena kedua belas baris itu di luar rentang, dan staf menyimpulkan
   * halamannya rusak. Tapi chip juga TIDAK boleh ikut menyaring statusnya
   * sendiri; kalau ikut, tiap chip cuma pernah menghitung dirinya sendiri dan
   * kelimanya berbunyi sama.
   */
  const dalamRentang = {
    ...(dari || sampai
      ? {
          createdAt: {
            ...(dari ? { [Op.gte]: dari } : {}),
            ...(sampai ? { [Op.lte]: sampai } : {}),
          },
        }
      : {}),
  };
  const where = { ...dalamRentang, ...(status ? { status } : {}) };

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
    where: dalamRentang,
    attributes: ['status', [WaFormEntry.sequelize!.fn('COUNT', '*'), 'n']],
    group: ['status'],
    raw: true,
  })) as unknown as Array<{ status: StatusEntry; n: number }>;
  const hitung = new Map(perStatus.map((r) => [r.status, Number(r.n)]));
  // "Semua" pada rentang ini = jumlah seluruh status di dalamnya. Memakai
  // `jumlah` di atas akan salah begitu sebuah chip status sedang aktif, karena
  // angka itu sudah ikut tersaring statusnya.
  const jumlahRentang = [...hitung.values()].reduce((a, b) => a + b, 0);

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
        <RentangTanggal
          status={status}
          dari={teksTanggal(dari)}
          sampai={teksTanggal(sampai)}
          jumlah={jumlahRentang}
          aktif={dari !== null || sampai !== null}
        />

        <div className="mb-3 flex flex-wrap gap-1">
          <FilterChip href={href('masuk')} active={status === null}>
            Semua ({jumlahRentang})
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
              hrefFor={(n) =>
                hrefHalaman(
                  RUTE,
                  { tab: 'masuk', status, dari: teksTanggal(dari) || null, sampai: teksTanggal(sampai) || null },
                  n,
                )
              }
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
