import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { FarmasiTarget, StokAlertSchedule, WaGroup, WaSession, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { daftarJenisBarang } from '@/khanza/stokDarurat';
import { Callout, PageHeader, Pagination, Tabs, type TabStatus } from '@/components/ui';
import { MasterSwitch } from './MasterSwitch';
import { TargetTable, type TargetRow, type GrupRow } from './TargetTable';
import { PesanForm, type NilaiPesan } from './PesanForm';
import { StokForm, type NilaiStok } from './StokForm';
import { DaruratForm, type JadwalRow, type JenisOption, type NilaiDarurat } from './DaruratForm';
import { DaruratSwitch } from './DaruratSwitch';
import { PengadaanForm, type NilaiPengadaan } from './PengadaanForm';
import { PengadaanSwitch } from './PengadaanSwitch';

/**
 * Halaman ini memuat EMPAT bagian yang berdiri sendiri: satu daftar tujuan yang
 * dipakai bersama, plus tiga fitur yang masing-masing punya sakelarnya sendiri
 * (notifikasi resep, balasan stok, darurat stok). Ditumpuk vertikal seperti
 * sebelumnya, halaman ini beberapa layar panjangnya -- dan bagian yang paling
 * jarang disentuh (isi pesan) mendorong bagian yang paling sering dilihat
 * (jadwal darurat stok) ke dasar halaman.
 *
 * Karena itu dipecah jadi tab lewat `?tab=`, bukan lewat state klien:
 * bagian yang tidak dibuka tidak perlu di-query sama sekali -- termasuk
 * `daftarJenisBarang()` yang menyentuh `sik`, kolam koneksi yang sengaja
 * dibatasi `pool.max: 2` supaya tidak berebut dengan SIMRS yang sedang dipakai
 * petugas.
 *
 * Yang TIDAK ikut dipindah ke dalam tab adalah keadaan ketiga sakelar: itu
 * dibawa titik status di tab masing-masing (`TabStatus`), supaya "menyala tapi
 * tidak akan mengirim apa pun" tetap terlihat tanpa membuka tabnya -- keadaan
 * yang sebelumnya hanya terbaca sesudah menggulir ke bagiannya.
 */

const TAB = ['tujuan', 'resep', 'stok', 'darurat', 'pengadaan'] as const;
type TabKey = (typeof TAB)[number];

function bacaTab(param: string | undefined): TabKey {
  return TAB.includes(param as TabKey) ? (param as TabKey) : 'tujuan';
}

export default async function FarmasiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat URL
  // harus tetap ditolak di server (pola sama seperti /audit dan /broadcast).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { page: pageParam, tab: tabParam } = await searchParams;
  const tab = bacaTab(tabParam);

  /**
   * Dihitung dari SELURUH tabel, bukan dari baris satu halaman.
   *
   * Tabel tujuan berpaginasi 25 baris, dan ketiga angka di bawah menyalakan
   * peringatan "menyala tapi tidak sampai ke mana pun". Menghitungnya dari satu
   * halaman berarti tujuan yang ada di halaman kedua tidak terhitung, lalu
   * peringatannya muncul tanpa sebab -- dan staf mencentang tujuan KEDUA untuk
   * membungkamnya, sehingga grup menerima dua pesan untuk tiap kejadian.
   *
   * `jumlahTujuanDarurat` sudah begini sejak awal; `jumlahTujuanAktif` dulu
   * dibaca dari `barisTarget.some(...)` satu halaman, dan itu bug yang sama
   * persis yang komentar di sebelahnya sudah menjelaskan.
   */
  const [jumlahTujuan, jumlahTujuanAktif, jumlahBolehTanya, jumlahTujuanDarurat, jumlahTujuanPengadaan, jumlahJadwal] =
    await Promise.all([
      FarmasiTarget.count(),
      FarmasiTarget.count({ where: { isActive: true } }),
      FarmasiTarget.count({ where: { bolehTanya: true } }),
      FarmasiTarget.count({ where: { terimaDaruratStok: true } }),
      FarmasiTarget.count({ where: { terimaPengadaan: true } }),
      StokAlertSchedule.count(),
    ]);

  const [enabled, stokModeMentah, daruratEnabled, pengadaanEnabled] = await Promise.all([
    getSettingBool('farmasi.enabled', false),
    getSetting('farmasi.stok_mode', 'mati'),
    getSettingBool('farmasi.darurat_enabled', false),
    getSettingBool('farmasi.pengadaan_enabled', false),
  ]);

  // Dinormalkan SEKALI di sini, bukan sekali untuk titik status lalu sekali
  // lagi di dalam tabnya: dua tempat yang menurunkan satu fakta yang sama
  // cepat atau lambat menyimpang, dan yang muncul saat menyimpang adalah titik
  // status yang mengatakan hal berbeda dari isi tabnya sendiri.
  const stokMode: NilaiStok['mode'] =
    stokModeMentah === 'petugas' || stokModeMentah === 'semua' ? stokModeMentah : 'mati';

  // Titik status per tab. Tiga keadaan, bukan dua: MATI, MENYALA, dan menyala
  // tapi setengah jadi -- yang ketiga itulah yang mahal, karena bergejala sama
  // persis dengan yang benar (halaman tampak wajar, nol pesan keluar).
  const statusResep: TabStatus = !enabled ? 'neutral' : jumlahTujuanAktif === 0 ? 'warning' : 'success';
  const labelResep = !enabled
    ? 'Mati'
    : jumlahTujuanAktif === 0
      ? 'Menyala, tapi belum ada tujuan yang aktif'
      : 'Menyala';

  const statusStok: TabStatus =
    stokMode === 'mati' ? 'neutral' : stokMode === 'petugas' && jumlahBolehTanya === 0 ? 'warning' : 'success';
  const labelStok =
    stokMode === 'mati'
      ? 'Mati'
      : stokMode === 'petugas'
        ? jumlahBolehTanya === 0
          ? 'Hanya petugas, tapi belum ada tujuan yang dicentang “Boleh tanya”'
          : 'Hanya petugas apotek'
        : 'Siapa saja yang bertanya';

  const statusDarurat: TabStatus = !daruratEnabled
    ? 'neutral'
    : jumlahTujuanDarurat === 0 || jumlahJadwal === 0
      ? 'warning'
      : 'success';
  const labelDarurat = !daruratEnabled
    ? 'Mati'
    : jumlahTujuanDarurat === 0
      ? 'Menyala, tapi belum ada tujuan yang menerimanya'
      : jumlahJadwal === 0
        ? 'Menyala, tapi belum ada satu pun jadwal'
        : 'Menyala';

  const statusPengadaan: TabStatus = !pengadaanEnabled
    ? 'neutral'
    : jumlahTujuanPengadaan === 0
      ? 'warning'
      : 'success';
  const labelPengadaan = !pengadaanEnabled
    ? 'Mati'
    : jumlahTujuanPengadaan === 0
      ? 'Menyala, tapi belum ada tujuan yang menerimanya'
      : 'Menyala';

  return (
    <div>
      <PageHeader
        title="Farmasi"
        description="Pemberitahuan ke grup atau petugas apotek, balasan stok dan harga obat, dan peringatan persediaan menipis."
      />

      <Tabs
        label="Bagian halaman Farmasi"
        active={tab}
        items={[
          { key: 'tujuan', href: '/farmasi?tab=tujuan', label: 'Tujuan pengiriman', count: jumlahTujuan },
          {
            key: 'resep',
            href: '/farmasi?tab=resep',
            label: 'Notifikasi resep',
            status: statusResep,
            statusLabel: labelResep,
          },
          { key: 'stok', href: '/farmasi?tab=stok', label: 'Balasan stok', status: statusStok, statusLabel: labelStok },
          {
            key: 'darurat',
            href: '/farmasi?tab=darurat',
            label: 'Darurat stok',
            count: jumlahJadwal,
            status: statusDarurat,
            statusLabel: labelDarurat,
          },
          {
            key: 'pengadaan',
            href: '/farmasi?tab=pengadaan',
            label: 'Pengadaan',
            status: statusPengadaan,
            statusLabel: labelPengadaan,
          },
        ]}
      />

      {tab === 'tujuan' && <TabTujuan pageParam={pageParam} jumlahTujuan={jumlahTujuan} />}
      {tab === 'resep' && <TabResep enabled={enabled} adaTujuanAktif={jumlahTujuanAktif > 0} />}
      {tab === 'stok' && <TabStok mode={stokMode} />}
      {tab === 'darurat' && (
        <TabDarurat enabled={daruratEnabled} adaTujuan={jumlahTujuanDarurat > 0} adaJadwal={jumlahJadwal > 0} />
      )}
      {tab === 'pengadaan' && (
        <TabPengadaan enabled={pengadaanEnabled} adaTujuan={jumlahTujuanPengadaan > 0} />
      )}

      {/* Berlaku untuk SEMUA pesan farmasi, jadi ditaruh di luar tab mana pun --
          tapi dilipat, karena keduanya jawaban atas pertanyaan yang muncul
          sekali lalu tidak lagi. */}
      <Callout
        className="mt-8"
        collapsible
        title="Daftar tolak pasien tidak berlaku di sini, dan jam tenang dilewati"
      >
        <p>
          <span className="font-medium text-foreground">Permintaan “Berhenti Kirim Otomatis” dari pasien tidak
          berlaku.</span>{' '}
          Pesan di halaman ini tidak dikirim ke pasien melainkan ke staf, jadi tidak ada nomor pasien yang bisa
          dicocokkan ke daftar tolak — dan koordinasi kerja internal memang bukan sesuatu yang bisa dihentikan pasien.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">Jam tenang dilewati.</span> Jam tenang melindungi orang yang
          sedang tidur di rumah, bukan shift malam yang justru menunggu pesan ini. Menahannya sampai pagi juga akan
          membuat seluruh resep semalam menumpuk lalu terkirim serentak sebagai puluhan pesan basi sekaligus.
        </p>
      </Callout>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Tujuan pengiriman                                                    */
/* ------------------------------------------------------------------------- */

async function TabTujuan({ pageParam, jumlahTujuan }: { pageParam: string | undefined; jumlahTujuan: number }) {
  const p = hitungPaginasi(bacaHalaman(pageParam), jumlahTujuan, UKURAN_HALAMAN.konfigurasi);

  const [targets, grup, sesi] = await Promise.all([
    FarmasiTarget.findAll({ order: [['id', 'ASC']], limit: p.limit, offset: p.offset }),
    // SENGAJA tidak dipaginasi: ini mengisi dropdown pemilih grup di dalam
    // TargetTable, bukan tabelnya. Daftar pilihan yang terpotong akan
    // menyembunyikan grup tanpa satu pun tanda, dan staf menyimpulkan grupnya
    // belum tersinkron.
    WaGroup.findAll({ order: [['nama', 'ASC']] }),
    WaSession.findByPk(1),
  ]);

  const barisTarget: TargetRow[] = targets.map((t) => ({
    id: t.id,
    jenis: t.jenis,
    chatId: t.chatId,
    label: t.label,
    isActive: t.isActive,
    bolehTanya: t.bolehTanya,
    terimaDaruratStok: t.terimaDaruratStok,
    terimaPengadaan: t.terimaPengadaan,
  }));

  const barisGrup: GrupRow[] = grup.map((g) => ({
    chatId: g.chatId,
    nama: g.nama,
    jumlahPeserta: g.jumlahPeserta,
    // Diformat di server: toLocaleString di komponen klien memberi hasil berbeda
    // antara render server dan klien, dan React melaporkannya sebagai hydration
    // mismatch.
    syncedAt: g.syncedAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
  }));

  return (
    <section>
      <p className="mb-3 text-sm text-muted-foreground">
        Satu daftar, dipakai keempat fitur di tab sebelah. Empat centang di tiap baris menjawab empat pertanyaan yang
        berbeda: <span className="font-medium text-foreground">Aktif</span> menerima notifikasi resep,{' '}
        <span className="font-medium text-foreground">Boleh tanya</span> boleh membuat nomor rumah sakit menjawab,{' '}
        <span className="font-medium text-foreground">Darurat stok</span> menerima rekap persediaan, dan{' '}
        <span className="font-medium text-foreground">Pengadaan</span> menerima nota pembelian. Sengaja terpisah —
        sebuah grup sangat wajar perlu tahu tiap resep tanpa ikut membaca harga beli dari pemasok.
      </p>

      <TargetTable targets={barisTarget} grup={barisGrup} waSiap={sesi?.status === 'ready'} />
      <Pagination
        page={p.halaman}
        totalPages={p.totalHalaman}
        count={p.jumlah}
        hrefFor={(n) => hrefHalaman('/farmasi', { tab: 'tujuan' }, n)}
        unit="tujuan"
      />
      {barisGrup.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Daftar grup terakhir dimuat {barisGrup[0]?.syncedAt}. Grup yang baru dibuat belum muncul sampai daftarnya
          dimuat ulang.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Notifikasi resep                                                     */
/* ------------------------------------------------------------------------- */

async function TabResep({ enabled, adaTujuanAktif }: { enabled: boolean; adaTujuanAktif: boolean }) {
  const [validasiEnabled, penyerahanEnabled, tValidasi, tPenyerahan, tGeneric, tRekap, maxPerCycle] = await Promise.all([
    getSettingBool('farmasi.validasi_enabled', true),
    getSettingBool('farmasi.penyerahan_enabled', true),
    getSetting('farmasi.template_validasi', ''),
    getSetting('farmasi.template_penyerahan', ''),
    getSetting('farmasi.template_generic', ''),
    getSetting('farmasi.template_rekap', ''),
    getSettingNumber('farmasi.max_per_cycle', 20),
  ]);

  const nilaiPesan: NilaiPesan = {
    validasiEnabled,
    penyerahanEnabled,
    templateValidasi: tValidasi ?? '',
    templatePenyerahan: tPenyerahan ?? '',
    templateGeneric: tGeneric ?? '',
    templateRekap: tRekap ?? '',
    maxPerCycle,
  };

  return (
    <section>
      {/* Ditempatkan SEBELUM sakelar, bukan sesudahnya, dan sengaja TIDAK
          dilipat: ini satu-satunya fitur di sistem ini yang mengirim data
          pasien ke penerima yang keanggotaannya diatur di luar sistem. Yang
          perlu dibaca sebelum menyalakan, bukan setelah terlanjur. */}
      <Callout
        variant="warning"
        className="mb-4"
        title="Pesan ini berisi data pasien, dan grup bukan sistem tertutup"
      >
        Isi bawaannya memuat nama pasien, nomor rekam medis, dan poli. Siapa saja yang ada di dalam grup akan
        membacanya, dan <span className="font-medium text-foreground">anggota grup ditentukan di luar sistem ini</span>{' '}
        — admin grup mana pun bisa menambahkan orang tanpa terlihat di sini. Pakai grup yang khusus dibuat untuk apotek,
        bukan grup umum rumah sakit; tinjau anggotanya secara berkala. Bila hanya perlu penanda kerja, kosongkan
        variabel pasien dari isi pesan di bawah dan sisakan{' '}
        <span className="font-mono text-xs">{'{no_resep}'}</span> saja — nomor itu sudah cukup untuk membukanya di
        SIMRS.
      </Callout>

      <MasterSwitch enabled={enabled} adaTargetAktif={adaTujuanAktif} />

      <p className="mb-3 text-xs text-muted-foreground">
        Kedua kejadian di bawah dibaca dari tabel <span className="font-mono">resep_obat</span> milik SIMRS Khanza.
        wakhanza tidak pernah menulis apa pun ke sana.
      </p>
      <PesanForm nilai={nilaiPesan} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Balasan stok & harga                                                 */
/* ------------------------------------------------------------------------- */

async function TabStok({ mode }: { mode: NilaiStok['mode'] }) {
  const [stokKeywords, stokMaxHasil, stokHarga, stokTemplate, stokKosong, stokTanpaNama] = await Promise.all([
    getSetting('farmasi.stok_keywords', 'stok,harga'),
    getSettingNumber('farmasi.stok_max_hasil', 5),
    getSetting('farmasi.stok_harga', 'jualbebas'),
    getSetting('farmasi.stok_template', ''),
    getSetting('farmasi.stok_template_kosong', ''),
    getSetting('farmasi.stok_template_tanpa_nama', ''),
  ]);

  const nilaiStok: NilaiStok = {
    mode,
    keywords: stokKeywords ?? '',
    maxHasil: stokMaxHasil,
    harga: stokHarga === 'ralan' ? 'ralan' : 'jualbebas',
    template: stokTemplate ?? '',
    templateKosong: stokKosong ?? '',
    templateTanpaNama: stokTanpaNama ?? '',
  };

  return (
    <section>
      <p className="mb-3 text-sm text-muted-foreground">
        Arah <span className="font-medium text-foreground">MASUK</span> — menjawab pertanyaan yang dikirim ke nomor
        rumah sakit (“stok paracetamol?”) dengan data dari <span className="font-mono">databarang</span> dan{' '}
        <span className="font-mono">gudangbarang</span> milik SIMRS Khanza. Punya sakelarnya sendiri:{' '}
        <span className="font-medium text-foreground">tidak</span> terpengaruh sakelar di tab Notifikasi resep maupun
        sakelar di Balasan otomatis.
      </p>

      <Callout
        variant="warning"
        collapsible
        className="mb-4"
        title="Ini katalog apotek, bukan resep siapa pun"
      >
        Yang dibaca hanya daftar barang beserta harga dan stok gudang — tidak ada kolom yang menghubungkan sebuah obat
        dengan seorang pasien, dan pertanyaan dari sebuah nomor tidak pernah dipakai untuk mencari pasien. Yang tetap
        keputusan apotek: apakah <span className="font-medium text-foreground">persediaan dan daftar harga</span> boleh
        dijawab otomatis, dan kepada siapa.
      </Callout>

      <StokForm nilai={nilaiStok} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Darurat stok                                                         */
/* ------------------------------------------------------------------------- */

async function TabDarurat({
  enabled,
  adaTujuan,
  adaJadwal,
}: {
  enabled: boolean;
  adaTujuan: boolean;
  adaJadwal: boolean;
}) {
  const [tDarurat, tDaruratKosong, pakaiBatch, daruratTanya, daruratFrasa, jadwalRows] = await Promise.all([
    getSetting('farmasi.template_darurat', ''),
    getSetting('farmasi.template_darurat_kosong', ''),
    getSettingBool('farmasi.stok_pakai_batch', false),
    getSettingBool('farmasi.darurat_tanya', true),
    getSetting('farmasi.darurat_keywords', ''),
    // SENGAJA tidak dipaginasi: jadwal peringatan persediaan jumlahnya beberapa,
    // bukan puluhan, dan daftar yang terpotong akan menyembunyikan jadwal yang
    // sedang aktif tanpa satu pun tanda -- staf lalu membuat jadwal kedua yang
    // isinya sama dan grupnya menerima dua peringatan.
    StokAlertSchedule.findAll({ order: [['id', 'ASC']] }),
  ]);

  /**
   * Daftar jenis dibaca dari `sik`, jadi ia bisa GAGAL sementara halaman
   * lainnya baik-baik saja (pool `sik` terpisah, `pool.max: 2`). Kegagalannya
   * tidak boleh menjatuhkan seluruh halaman: tujuan pengiriman dan isi pesan
   * resep sama sekali tidak bergantung padanya, dan halaman yang mati total
   * membuat sakelar utama pun tidak bisa dimatikan saat sedang bermasalah.
   */
  let jenisBarang: JenisOption[] = [];
  try {
    jenisBarang = await daftarJenisBarang();
  } catch {
    jenisBarang = [];
  }

  const namaJenis = new Map(jenisBarang.map((j) => [j.kdjns, j.nama]));
  const waktu = (d: Date | null) =>
    // Diformat di SERVER: toLocaleString di komponen klien memberi hasil berbeda
    // antara render server dan klien, dan React melaporkannya sebagai hydration
    // mismatch.
    d ? d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : null;

  const barisJadwal: JadwalRow[] = jadwalRows.map((j) => ({
    id: j.id,
    nama: j.nama,
    repeatKind: j.repeatKind,
    intervalDays: j.intervalDays,
    timeOfDay: j.timeOfDay,
    dayOfWeek: j.dayOfWeek,
    dayOfMonth: j.dayOfMonth,
    kdJenis: j.kdJenis,
    namaJenis: j.kdJenis ? (namaJenis.get(j.kdJenis) ?? j.kdJenis) : '',
    maxBaris: j.maxBaris,
    isActive: j.isActive,
    nextRunAt: waktu(j.nextRunAt),
    lastRunAt: waktu(j.lastRunAt),
    lastJumlah: j.lastJumlah,
  }));

  const nilaiDarurat: NilaiDarurat = {
    template: tDarurat ?? '',
    templateKosong: tDaruratKosong ?? '',
    pakaiBatch,
    bolehTanya: daruratTanya,
    frasa: daruratFrasa ?? '',
  };

  return (
    <section>
      <p className="mb-3 text-sm text-muted-foreground">
        Dipicu <span className="font-medium text-foreground">WAKTU</span> — pada jam yang dijadwalkan, sistem membaca
        barang yang stoknya sudah menyentuh atau turun di bawah <span className="font-mono">stokminimal</span> di
        Khanza, lalu mengirimkan daftarnya. Sakelarnya sendiri,{' '}
        <span className="font-medium text-foreground">tidak</span> terpengaruh sakelar di tab Notifikasi resep.
      </p>

      <Callout collapsible className="mb-4" title="Barang tanpa ambang minimal tidak ikut dihitung">
        Khanza membandingkan stok dengan <span className="font-mono">stokminimal</span> apa adanya, sehingga barang yang
        ambangnya belum pernah disetel (stok 0, minimum 0) ikut terhitung darurat — di database ini 141 dari 348. Itu
        bukan keadaan darurat melainkan entri katalog yang belum pernah distok, dan daftar yang dipenuhi kebisingan
        berhenti dibaca dalam seminggu. Yang dilaporkan hanya barang yang ambangnya memang disetel apotek.
      </Callout>

      <DaruratSwitch enabled={enabled} adaTujuan={adaTujuan} adaJadwal={adaJadwal} />

      <DaruratForm nilai={nilaiDarurat} jadwal={barisJadwal} jenis={jenisBarang} adaTujuan={adaTujuan} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Pengadaan                                                            */
/* ------------------------------------------------------------------------- */

async function TabPengadaan({ enabled, adaTujuan }: { enabled: boolean; adaTujuan: boolean }) {
  const [template, harga, lookback, kuota, sejak] = await Promise.all([
    getSetting('farmasi.template_pengadaan', ''),
    getSettingBool('farmasi.pengadaan_harga', true),
    getSettingNumber('farmasi.pengadaan_lookback_hari', 7),
    getSettingNumber('farmasi.pengadaan_max_per_siklus', 5),
    getSetting('farmasi.pengadaan_sejak', ''),
  ]);

  const nilai: NilaiPengadaan = { template: template ?? '', harga, lookback, kuota };

  return (
    <section>
      <p className="mb-3 text-sm text-muted-foreground">
        Dipicu <span className="font-medium text-foreground">kejadian di Khanza</span> — setiap pembelian yang disimpan
        lewat menu <span className="font-medium text-foreground">Transaksi Pengadaan Obat, Alkes &amp; BHP Medis</span>{' '}
        dikirim sebagai nota berisi pemasok, daftar barang, dan totalnya. Sakelarnya sendiri,{' '}
        <span className="font-medium text-foreground">tidak</span> terpengaruh sakelar di tab Notifikasi resep.
      </p>

      {/* Sengaja TIDAK dilipat, dan isinya kebalikan dari peringatan di tab
          Notifikasi resep: yang di sana memperingatkan adanya data pasien, yang
          di sini justru menjelaskan ketiadaannya. Keduanya perlu dikatakan,
          karena tanpa ini pembacanya wajar mengira seluruh halaman Farmasi
          membawa risiko yang sama -- dan rumah sakit yang menunda menyalakan
          notifikasi resep akan ikut menunda yang ini tanpa sebab. */}
      <Callout className="mb-4" title="Nota pembelian tidak menyebut satu pun pasien">
        Yang dibaca hanya <span className="font-mono">pembelian</span> dan <span className="font-mono">detailbeli</span>{' '}
        beserta master pemasok, barang, dan petugas — tidak ada satu kolom pun yang menautkan sebuah pembelian dengan
        seorang pasien, dan variabel pasien memang tidak tersedia untuk ditambahkan ke isi pesan. Yang tetap perlu
        dipertimbangkan adalah <span className="font-medium text-foreground">harga beli dari pemasok</span>, yang punya
        nilai dagang tersendiri — lihat sakelarnya di bawah.
      </Callout>

      <PengadaanSwitch enabled={enabled} adaTujuan={adaTujuan} sejak={sejak ?? ''} />

      <PengadaanForm nilai={nilai} adaTujuan={adaTujuan} />
    </section>
  );
}
