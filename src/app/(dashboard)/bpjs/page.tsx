import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { BpjsTarget, WaGroup, WaSession, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { bacaHariSebelum } from '@/core/bpjs';
import { Callout, PageHeader, Pagination, Tabs, type TabStatus } from '@/components/ui';
import { MasterSwitch, BatalSwitch, KontrolSwitch } from './Switches';
import { TargetTable, type TargetRow, type GrupRow } from './TargetTable';
import { BatalForm, type NilaiBatal } from './BatalForm';
import { KontrolForm, type NilaiKontrol } from './KontrolForm';

/**
 * Halaman BPJS -- dua fitur yang sumber datanya satu kanal tapi arahnya
 * berlawanan:
 *
 *   Pembatalan Mobile JKN  sik -> LOKET   (pasien membatalkan, slotnya kosong)
 *   Pengingat surat kontrol sik -> PASIEN (mengingatkan sebelum tanggal kontrol)
 *
 * Berbentuk tab lewat `?tab=`, bukan state klien, dengan alasan yang sama
 * seperti /farmasi: bagian yang tidak dibuka tidak di-query sama sekali --
 * termasuk pembacaan `sik`, kolam koneksi yang sengaja dibatasi `pool.max: 2`
 * supaya tidak berebut dengan SIMRS yang sedang melayani pasien.
 *
 * Daftar tujuan diberi tabnya SENDIRI alih-alih ditempel di dalam tab
 * Pembatalan, walau ia hanya dipakai penuh oleh fitur itu. Sebabnya sudah
 * dibayar saat /farmasi dipecah: instruksi yang menunjuk tempat ("tambahkan
 * tujuan di bawah") jadi salah begitu halamannya bukan satu gulungan lagi, dan
 * kesalahannya tidak menghasilkan satu pun galat -- cuma staf yang menggulir
 * mencari sesuatu yang tidak ada di layar. Dengan tab tersendiri, kedua fitur
 * menunjuknya lewat TAUTAN.
 */

const TAB = ['tujuan', 'batal', 'kontrol'] as const;
type TabKey = (typeof TAB)[number];

function bacaTab(param: string | undefined): TabKey {
  return TAB.includes(param as TabKey) ? (param as TabKey) : 'tujuan';
}

export default async function BpjsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat URL
  // harus tetap ditolak di server (pola sama seperti /audit dan /farmasi).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { page: pageParam, tab: tabParam } = await searchParams;
  const tab = bacaTab(tabParam);

  /**
   * Dihitung dari SELURUH tabel, bukan dari baris satu halaman.
   *
   * Tabel tujuan berpaginasi, dan angka-angka ini menyalakan peringatan
   * "menyala tapi tidak sampai ke mana pun". Menghitungnya dari satu halaman
   * berarti tujuan di halaman kedua tidak terhitung, peringatannya muncul tanpa
   * sebab, lalu staf mencentang tujuan KEDUA untuk membungkamnya -- dan grup
   * menerima dua pesan per kejadian. Bug itu benar-benar pernah ada di
   * /farmasi; ini menghindarinya sejak awal.
   */
  const [jumlahTujuan, jumlahAktif, jumlahTerimaBatal, jumlahTerimaKontrol] = await Promise.all([
    BpjsTarget.count(),
    BpjsTarget.count({ where: { isActive: true } }),
    BpjsTarget.count({ where: { isActive: true, terimaBatal: true } }),
    BpjsTarget.count({ where: { isActive: true, terimaKontrol: true } }),
  ]);

  const [enabled, batalEnabled, kontrolEnabled, kontrolKePasien, rawHari] = await Promise.all([
    getSettingBool('bpjs.enabled', false),
    getSettingBool('bpjs.batal_enabled', false),
    getSettingBool('bpjs.kontrol_enabled', false),
    getSettingBool('bpjs.kontrol_ke_pasien', true),
    getSetting('bpjs.kontrol_hari_sebelum', '1'),
  ]);

  // Titik status per tab. TIGA keadaan, bukan dua: mati, menyala, dan menyala
  // tapi setengah jadi -- yang ketiga itulah yang mahal, karena bergejala sama
  // persis dengan yang benar (halaman tampak wajar, nol pesan keluar).
  // Sakelar utama yang mati membuat KEDUANYA netral: setelan di bawahnya tidak
  // berlaku sama sekali, jadi menandainya hijau akan berbohong.
  const statusBatal: TabStatus = !enabled || !batalEnabled ? 'neutral' : jumlahTerimaBatal === 0 ? 'warning' : 'success';
  const labelBatal = !enabled
    ? 'Mati (sakelar utama)'
    : !batalEnabled
      ? 'Mati'
      : jumlahTerimaBatal === 0
        ? 'Menyala, tapi belum ada tujuan yang menerimanya'
        : 'Menyala';

  const hariSah = bacaHariSebelum(rawHari).length > 0;
  const kontrolTakSampai = !kontrolKePasien && jumlahTerimaKontrol === 0;
  const statusKontrol: TabStatus =
    !enabled || !kontrolEnabled ? 'neutral' : !hariSah || kontrolTakSampai ? 'warning' : 'success';
  const labelKontrol = !enabled
    ? 'Mati (sakelar utama)'
    : !kontrolEnabled
      ? 'Mati'
      : !hariSah
        ? 'Menyala, tapi “berapa hari sebelum” tidak terbaca'
        : kontrolTakSampai
          ? 'Menyala, tapi tidak dikirim ke pasien maupun tujuan mana pun'
          : 'Menyala';

  return (
    <div>
      <PageHeader
        title="BPJS"
        description="Pemberitahuan pembatalan dari Mobile JKN ke loket, dan pengingat surat kontrol ke pasien."
      />

      <Tabs
        label="Bagian halaman BPJS"
        active={tab}
        items={[
          { key: 'tujuan', href: '/bpjs?tab=tujuan', label: 'Tujuan pengiriman', count: jumlahTujuan },
          {
            key: 'batal',
            href: '/bpjs?tab=batal',
            label: 'Pembatalan Mobile JKN',
            status: statusBatal,
            statusLabel: labelBatal,
          },
          {
            key: 'kontrol',
            href: '/bpjs?tab=kontrol',
            label: 'Pengingat kontrol',
            status: statusKontrol,
            statusLabel: labelKontrol,
          },
        ]}
      />

      {tab === 'tujuan' && (
        <TabTujuan pageParam={pageParam} jumlahTujuan={jumlahTujuan} enabled={enabled} adaTujuan={jumlahAktif > 0} />
      )}
      {tab === 'batal' && <TabBatal enabled={batalEnabled} adaPenerima={jumlahTerimaBatal > 0} />}
      {tab === 'kontrol' && (
        <TabKontrol
          enabled={kontrolEnabled}
          kePasien={kontrolKePasien}
          adaPenerima={jumlahTerimaKontrol > 0}
          rawHari={rawHari ?? '1'}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Tujuan pengiriman                                                    */
/* ------------------------------------------------------------------------- */

async function TabTujuan({
  pageParam,
  jumlahTujuan,
  enabled,
  adaTujuan,
}: {
  pageParam: string | undefined;
  jumlahTujuan: number;
  enabled: boolean;
  adaTujuan: boolean;
}) {
  const p = hitungPaginasi(bacaHalaman(pageParam), jumlahTujuan, UKURAN_HALAMAN.konfigurasi);

  const [targets, grup, sesi] = await Promise.all([
    BpjsTarget.findAll({ order: [['id', 'ASC']], limit: p.limit, offset: p.offset }),
    // SENGAJA tidak dipaginasi: ini mengisi dropdown pemilih grup di dalam
    // TargetTable, bukan tabelnya. Daftar pilihan yang terpotong menyembunyikan
    // grup tanpa satu pun tanda, dan staf menyimpulkan grupnya belum tersinkron.
    WaGroup.findAll({ order: [['nama', 'ASC']] }),
    WaSession.findByPk(1),
  ]);

  const barisTarget: TargetRow[] = targets.map((t) => ({
    id: t.id,
    jenis: t.jenis,
    chatId: t.chatId,
    label: t.label,
    isActive: t.isActive,
    terimaBatal: t.terimaBatal,
    terimaKontrol: t.terimaKontrol,
  }));

  const barisGrup: GrupRow[] = grup.map((g) => ({
    chatId: g.chatId,
    nama: g.nama,
    jumlahPeserta: g.jumlahPeserta,
    // Diformat di SERVER: toLocaleString di komponen klien memberi hasil berbeda
    // antara render server dan klien, dan React melaporkannya sebagai hydration
    // mismatch.
    syncedAt: g.syncedAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
  }));

  return (
    <section>
      <MasterSwitch enabled={enabled} adaTujuan={adaTujuan} />

      <p className="mb-3 text-sm text-muted-foreground">
        Satu daftar, dipakai kedua fitur di tab sebelah. Dua centang di tiap baris menjawab dua pertanyaan yang berbeda:{' '}
        <span className="font-medium text-foreground">Terima pembatalan</span> menerima pemberitahuan saat pasien
        membatalkan lewat Mobile JKN, dan{' '}
        <span className="font-medium text-foreground">Terima salinan kontrol</span> menerima tembusan pengingat yang
        dikirim ke pasien.
      </p>

      <TargetTable targets={barisTarget} grup={barisGrup} waSiap={sesi?.status === 'ready'} />
      <Pagination
        page={p.halaman}
        totalPages={p.totalHalaman}
        count={p.jumlah}
        hrefFor={(n) => hrefHalaman('/bpjs', { tab: 'tujuan' }, n)}
        unit="tujuan"
      />
      {barisGrup.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Daftar grup terakhir dimuat {barisGrup[0]?.syncedAt}. Grup yang baru dibuat belum muncul sampai daftarnya
          dimuat ulang.
        </p>
      )}

      <Callout
        className="mt-8"
        collapsible
        title="Pembatalan berisi data pasien; pengingat kontrol tidak berisi data klinis"
      >
        <p>
          <span className="font-medium text-foreground">Pemberitahuan pembatalan</span> memuat nama pasien, nomor rekam
          medis, dan poli tujuannya. Siapa saja yang ada di dalam grup akan membacanya, dan{' '}
          <span className="font-medium text-foreground">anggota grup ditentukan di luar sistem ini</span> — admin grup
          mana pun bisa menambahkan orang tanpa terlihat di sini. Pakai grup yang khusus dibuat untuk pendaftaran, dan
          tinjau anggotanya berkala. Bila hanya perlu tahu bahwa ada slot yang kosong, kosongkan variabel pasien dari
          isi pesan dan sisakan jadwalnya saja.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">Pengingat kontrol</span> dibaca dari{' '}
          <span className="font-mono">bridging_surat_kontrol_bpjs</span>, tabel yang juga menyimpan diagnosis kronis
          pasien beserta hasil laboratoriumnya. Yang diambil sistem ini{' '}
          <span className="font-medium text-foreground">hanya kolom penjadwalan</span> — tanggal, poli, dan nama dokter.
          Tidak ada variabel untuk data klinis, dan kolomnya memang tidak pernah dibaca dari SIMRS.
        </p>
      </Callout>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Pembatalan Mobile JKN                                                */
/* ------------------------------------------------------------------------- */

async function TabBatal({ enabled, adaPenerima }: { enabled: boolean; adaPenerima: boolean }) {
  const [template, generic, rekap, maxPerCycle] = await Promise.all([
    getSetting('bpjs.template_batal', ''),
    getSetting('bpjs.template_batal_generic', ''),
    getSetting('bpjs.template_batal_rekap', ''),
    getSettingNumber('bpjs.batal_max_per_cycle', 20),
  ]);

  const nilai: NilaiBatal = {
    template: template ?? '',
    templateGeneric: generic ?? '',
    templateRekap: rekap ?? '',
    maxPerCycle,
  };

  return (
    <section>
      <p className="mb-3 text-sm text-muted-foreground">
        Dibaca dari <span className="font-mono">referensi_mobilejkn_bpjs_batal</span> milik SIMRS Khanza — pembatalan
        yang dilakukan pasien <span className="font-medium text-foreground">sendiri lewat aplikasi Mobile JKN</span>.
        Penerimanya loket, bukan pasien: ia sudah tahu, ia yang menekan tombolnya. Gunanya supaya slot yang jadi kosong
        bisa ditawarkan ke pasien lain.
      </p>

      <BatalSwitch enabled={enabled} adaPenerima={adaPenerima} />

      <Callout collapsible className="mb-4" title="Jam tenang dilewati, dan daftar tolak pasien tidak berlaku">
        <p>
          <span className="font-medium text-foreground">Jam tenang dilewati.</span> Penerimanya staf, bukan orang yang
          sedang tidur di rumah — dan slot yang batal sering untuk besok pagi. Pembatalan pukul 21.30 yang baru
          diberitahukan pukul 07.00 tiba bersamaan dengan pasiennya sendiri datang.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">Permintaan “Berhenti Kirim Otomatis” tidak berlaku.</span> Pesan
          ini tidak dikirim ke pasien, jadi tidak ada nomor pasien yang bisa dicocokkan ke daftar tolak — dan koordinasi
          kerja internal bukan sesuatu yang bisa dihentikan pasien.
        </p>
      </Callout>

      <BatalForm nilai={nilai} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Pengingat surat kontrol                                              */
/* ------------------------------------------------------------------------- */

async function TabKontrol({
  enabled,
  kePasien,
  adaPenerima,
  rawHari,
}: {
  enabled: boolean;
  kePasien: boolean;
  adaPenerima: boolean;
  rawHari: string;
}) {
  const [jam, template, generic, terakhir] = await Promise.all([
    getSettingNumber('bpjs.kontrol_jam', 9),
    getSetting('bpjs.template_kontrol', ''),
    getSetting('bpjs.template_kontrol_generic', ''),
    getSetting('bpjs.kontrol_last_run', ''),
  ]);

  const nilai: NilaiKontrol = {
    hariSebelum: rawHari,
    jam,
    kePasien,
    template: template ?? '',
    templateGeneric: generic ?? '',
    terakhirJalan: terakhir ? terakhir : null,
  };

  return (
    <section>
      <p className="mb-3 text-sm text-muted-foreground">
        Dibaca dari <span className="font-mono">bridging_surat_kontrol_bpjs</span> — rencana kunjungan berikutnya yang
        sudah dijadwalkan saat pasien pulang, sering berminggu-minggu di muka. Dipicu{' '}
        <span className="font-medium text-foreground">WAKTU</span>: sekali sehari pada jam yang dipilih di bawah.
      </p>

      <KontrolSwitch enabled={enabled} kePasien={kePasien} adaPenerima={adaPenerima} />

      <Callout
        variant="warning"
        className="mb-4"
        title="Ini satu-satunya pesan di halaman ini yang dibaca pasien"
      >
        Karena itu ia diperlakukan seperti notifikasi pasien lainnya, bukan seperti pemberitahuan ke loket:{' '}
        <span className="font-medium text-foreground">jam tenang berlaku</span> (pengingat yang jatuh di luar jam kirim
        ditahan sampai pagi), dan{' '}
        <span className="font-medium text-foreground">permintaan “Berhenti Kirim Otomatis” dihormati</span> — pasien yang
        sudah meminta berhenti tidak menerimanya. Salinan ke grup tetap terkirim, karena yang ia hentikan adalah pesan
        kepadanya.
      </Callout>

      <KontrolForm nilai={nilai} />
    </section>
  );
}
