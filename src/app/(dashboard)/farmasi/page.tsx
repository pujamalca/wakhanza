import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { FarmasiTarget, StokAlertSchedule, WaGroup, WaSession, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { daftarJenisBarang } from '@/khanza/stokDarurat';
import { Callout, HelpPanel, PageHeader, Pagination, Tabs, type TabStatus } from '@/components/ui';
import { BantuanFarmasi } from './bantuan';
import { MasterSwitch } from './MasterSwitch';
import { TargetTable, type TargetRow, type GrupRow } from './TargetTable';
import { PesanForm, type NilaiPesan } from './PesanForm';
import { RekapResepForm, type NilaiRekapResep } from './RekapResepForm';
import { RekapResepSwitch } from './RekapResepSwitch';
import { StokForm, type NilaiStok } from './StokForm';
import { DaruratForm, type JadwalRow, type JenisOption, type NilaiDarurat } from './DaruratForm';
import { DaruratSwitch } from './DaruratSwitch';
import { PengadaanForm, type NilaiPengadaan } from './PengadaanForm';
import { PengadaanSwitch } from './PengadaanSwitch';
import { HibahForm, type NilaiHibah } from './HibahForm';
import { HibahSwitch } from './HibahSwitch';
import { PemesananForm, type NilaiPemesanan } from './PemesananForm';
import { PemesananSwitch } from './PemesananSwitch';
import { PenjualanForm, type NilaiPenjualan } from './PenjualanForm';
import { PenjualanSwitch } from './PenjualanSwitch';
import { RekapForm, type NilaiRekap } from './RekapForm';
import { RekapSwitch } from './RekapSwitch';

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

// Pemesanan duduk tepat di sebelah Pengadaan karena keduanya PASANGAN (pesanan
// dikirim -> barang datang); Hibah ditaruh sesudah keduanya, bukan di antaranya,
// justru supaya pasangan itu tidak terpisah -- ia jalur pemasukan barang yang
// berdiri sendiri, bukan tahap ketiga dari alur yang sama.
// Penjualan ditaruh PALING AKHIR di antara nota barang, dan itu bukan urutan
// pembuatan melainkan arah barangnya: pengadaan/pemesanan/hibah semuanya
// barang MASUK, yang ini satu-satunya barang KELUAR. Menyelipkannya di
// tengah membuat tiga tab yang bertetangga tidak lagi menjawab satu
// pertanyaan yang sama.
const TAB = ['tujuan', 'resep', 'stok', 'darurat', 'pengadaan', 'pemesanan', 'hibah', 'penjualan'] as const;
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
  const [
    jumlahTujuan,
    jumlahTujuanAktif,
    jumlahBolehTanya,
    jumlahTujuanDarurat,
    jumlahTujuanPengadaan,
    jumlahTujuanHibah,
    jumlahTujuanPemesanan,
    jumlahTujuanPenjualan,
    jumlahJadwal,
  ] = await Promise.all([
    FarmasiTarget.count(),
    FarmasiTarget.count({ where: { isActive: true } }),
    FarmasiTarget.count({ where: { bolehTanya: true } }),
    FarmasiTarget.count({ where: { terimaDaruratStok: true } }),
    FarmasiTarget.count({ where: { terimaPengadaan: true } }),
    FarmasiTarget.count({ where: { terimaHibah: true } }),
    FarmasiTarget.count({ where: { terimaPemesanan: true } }),
    FarmasiTarget.count({ where: { terimaPenjualan: true } }),
    StokAlertSchedule.count(),
  ]);

  const [
    enabled,
    stokModeMentah,
    daruratEnabled,
    pengadaanEnabled,
    hibahEnabled,
    pemesananEnabled,
    penjualanEnabled,
    rekapEnabled,
    rekapResepEnabled,
  ] = await Promise.all([
      getSettingBool('farmasi.enabled', false),
      getSetting('farmasi.stok_mode', 'mati'),
      getSettingBool('farmasi.darurat_enabled', false),
      getSettingBool('farmasi.pengadaan_enabled', false),
      getSettingBool('farmasi.hibah_enabled', false),
      getSettingBool('farmasi.pemesanan_enabled', false),
      getSettingBool('farmasi.penjualan_enabled', false),
      getSettingBool('farmasi.penjualan_rekap_enabled', false),
      getSettingBool('farmasi.resep_rekap_enabled', false),
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
  /**
   * Tab Resep memuat DUA sakelar yang berdiri sendiri (notifikasi per kejadian
   * dan rekap harian), jadi titiknya menyala bila SALAH SATU menyala -- bentuk
   * yang sama dengan tab Penjualan sejak migrations/041.
   *
   * Membacanya dari `enabled` saja akan membuat RS yang memakai rekap SAJA
   * melihat tabnya bertanda "Mati" sementara ia benar-benar mengirim tiap malam.
   * Itu kebalikan persis dari guna titik ini. Dan di sini kombinasi "rekap saja"
   * justru yang paling mungkin dipilih: ia satu-satunya cara mendapat angka
   * harian tanpa data pasien mengalir ke grup.
   *
   * Keduanya berbagi satu daftar tujuan (`is_active`), jadi peringatan "belum ada
   * tujuan" tetap satu pemeriksaan untuk keduanya.
   */
  const resepAdaYangNyala = enabled || rekapResepEnabled;
  const statusResep: TabStatus = !resepAdaYangNyala
    ? 'neutral'
    : jumlahTujuanAktif === 0
      ? 'warning'
      : 'success';
  const labelResep = !resepAdaYangNyala
    ? 'Mati'
    : jumlahTujuanAktif === 0
      ? 'Menyala, tapi belum ada tujuan yang aktif'
      : enabled && rekapResepEnabled
        ? 'Notifikasi per resep dan rekap harian menyala'
        : enabled
          ? 'Notifikasi per resep menyala'
          : 'Rekap harian menyala';

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

  const statusHibah: TabStatus = !hibahEnabled ? 'neutral' : jumlahTujuanHibah === 0 ? 'warning' : 'success';
  const labelHibah = !hibahEnabled
    ? 'Mati'
    : jumlahTujuanHibah === 0
      ? 'Menyala, tapi belum ada tujuan yang menerimanya'
      : 'Menyala';

  const statusPemesanan: TabStatus = !pemesananEnabled
    ? 'neutral'
    : jumlahTujuanPemesanan === 0
      ? 'warning'
      : 'success';
  const labelPemesanan = !pemesananEnabled
    ? 'Mati'
    : jumlahTujuanPemesanan === 0
      ? 'Menyala, tapi belum ada tujuan yang menerimanya'
      : 'Menyala';

  /**
   * Tab Penjualan memuat DUA sakelar yang berdiri sendiri (nota per transaksi
   * dan rekap harian), jadi titiknya menyala bila SALAH SATU menyala.
   *
   * Membacanya dari `penjualanEnabled` saja -- bentuk yang benar untuk ketujuh
   * tab lain yang cuma punya satu sakelar -- akan membuat RS yang memakai rekap
   * SAJA melihat tabnya bertanda "Mati" sementara ia benar-benar mengirim tiap
   * malam. Itu kebalikan persis dari guna titik ini: ia ada untuk menampakkan
   * keadaan yang tidak terlihat tanpa membuka tabnya.
   *
   * Keduanya berbagi satu daftar tujuan (`terima_penjualan`), jadi peringatan
   * "belum ada tujuan" tetap satu pemeriksaan untuk keduanya.
   */
  const penjualanAdaYangNyala = penjualanEnabled || rekapEnabled;
  const statusPenjualan: TabStatus = !penjualanAdaYangNyala
    ? 'neutral'
    : jumlahTujuanPenjualan === 0
      ? 'warning'
      : 'success';
  const labelPenjualan = !penjualanAdaYangNyala
    ? 'Mati'
    : jumlahTujuanPenjualan === 0
      ? 'Menyala, tapi belum ada tujuan yang menerimanya'
      : penjualanEnabled && rekapEnabled
        ? 'Nota per transaksi dan rekap harian menyala'
        : penjualanEnabled
          ? 'Nota per transaksi menyala'
          : 'Rekap harian menyala';

  return (
    <div>
      <PageHeader
        title="Farmasi"
        description="Pemberitahuan ke grup atau petugas apotek, balasan stok dan harga obat, dan peringatan persediaan menipis."
        help={
          <HelpPanel title="Tentang tab ini">
            <BantuanFarmasi tab={tab} />
          </HelpPanel>
        }
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
          {
            key: 'pemesanan',
            href: '/farmasi?tab=pemesanan',
            label: 'Pemesanan',
            status: statusPemesanan,
            statusLabel: labelPemesanan,
          },
          {
            key: 'hibah',
            href: '/farmasi?tab=hibah',
            label: 'Hibah',
            status: statusHibah,
            statusLabel: labelHibah,
          },
          {
            key: 'penjualan',
            href: '/farmasi?tab=penjualan',
            label: 'Penjualan',
            status: statusPenjualan,
            statusLabel: labelPenjualan,
          },
        ]}
      />

      {tab === 'tujuan' && <TabTujuan pageParam={pageParam} jumlahTujuan={jumlahTujuan} />}
      {tab === 'resep' && (
        <TabResep enabled={enabled} rekapEnabled={rekapResepEnabled} adaTujuanAktif={jumlahTujuanAktif > 0} />
      )}
      {tab === 'stok' && <TabStok mode={stokMode} />}
      {tab === 'darurat' && (
        <TabDarurat enabled={daruratEnabled} adaTujuan={jumlahTujuanDarurat > 0} adaJadwal={jumlahJadwal > 0} />
      )}
      {tab === 'pengadaan' && (
        <TabPengadaan enabled={pengadaanEnabled} adaTujuan={jumlahTujuanPengadaan > 0} />
      )}
      {tab === 'hibah' && <TabHibah enabled={hibahEnabled} adaTujuan={jumlahTujuanHibah > 0} />}
      {tab === 'pemesanan' && (
        <TabPemesanan enabled={pemesananEnabled} adaTujuan={jumlahTujuanPemesanan > 0} />
      )}
      {tab === 'penjualan' && (
        <TabPenjualan enabled={penjualanEnabled} adaTujuan={jumlahTujuanPenjualan > 0} />
      )}

      {/* Keterangan yang dulu duduk di sini -- daftar tolak tidak berlaku, jam
          tenang dilewati -- pindah ke laci bantuan (`bantuan.tsx`), dan muncul
          di SETIAP tab karena memang berlaku untuk seluruh halaman. Ia tingkat
          orientasi: dibaca sekali saat memahami halaman ini, bukan pagar yang
          harus terbaca sebelum sebuah sakelar ditekan. */}
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
    terimaHibah: t.terimaHibah,
    terimaPemesanan: t.terimaPemesanan,
    terimaPenjualan: t.terimaPenjualan,
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

async function TabResep({
  enabled,
  rekapEnabled,
  adaTujuanAktif,
}: {
  enabled: boolean;
  rekapEnabled: boolean;
  adaTujuanAktif: boolean;
}) {
  const [
    validasiEnabled,
    penyerahanEnabled,
    tValidasi,
    tPenyerahan,
    tGeneric,
    tRekap,
    maxPerCycle,
    rekapJam,
    rekapOffset,
    rekapTemplate,
    rekapTemplateKosong,
  ] = await Promise.all([
    getSettingBool('farmasi.validasi_enabled', true),
    getSettingBool('farmasi.penyerahan_enabled', true),
    getSetting('farmasi.template_validasi', ''),
    getSetting('farmasi.template_penyerahan', ''),
    getSetting('farmasi.template_generic', ''),
    getSetting('farmasi.template_rekap', ''),
    getSettingNumber('farmasi.max_per_cycle', 20),
    getSetting('farmasi.resep_rekap_jam', '22:00'),
    getSettingNumber('farmasi.resep_rekap_offset_hari', 0),
    getSetting('farmasi.template_resep_rekap', ''),
    getSetting('farmasi.template_resep_rekap_kosong', ''),
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

  const nilaiRekap: NilaiRekapResep = {
    jam: rekapJam ?? '22:00',
    offset: rekapOffset,
    template: rekapTemplate ?? '',
    templateKosong: rekapTemplateKosong ?? '',
  };

  return (
    <section>
      {/* Ditempatkan SEBELUM sakelar, bukan sesudahnya, dan sengaja TIDAK
          dilipat: ini satu-satunya fitur di sistem ini yang mengirim data
          pasien ke penerima yang keanggotaannya diatur di luar sistem. Yang
          perlu dibaca sebelum menyalakan, bukan setelah terlanjur. */}
      <Callout
        variant="privasi"
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

      <PesanForm nilai={nilaiPesan} />

      {/* ------------------------------------------------------------------ */}
      {/* Bagian kedua: REKAP HARIAN (migrations/042)                         */}
      {/*                                                                     */}
      {/* Sakelarnya berdiri sendiri dari yang di atas -- lihat komentar di   */}
      {/* RekapResepSwitch. Ditaruh SESUDAH notifikasi per kejadian karena    */}
      {/* itulah urutan orang memikirkannya ("saya sudah tahu tiap resep,     */}
      {/* sekarang saya mau angka hariannya"), bukan urutan pentingnya.       */}
      {/* ------------------------------------------------------------------ */}
      <h2 className="mb-3 mt-10 border-t border-border pt-6 text-title">Rekap harian</h2>

      <RekapResepSwitch
        enabled={rekapEnabled}
        adaTujuan={adaTujuanAktif}
        notifEnabled={enabled}
        jam={nilaiRekap.jam}
        offset={nilaiRekap.offset}
      />
      <RekapResepForm nilai={nilaiRekap} adaTujuan={adaTujuanAktif} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Balasan stok & harga                                                 */
/* ------------------------------------------------------------------------- */

async function TabStok({ mode }: { mode: NilaiStok['mode'] }) {
  const [stokKeywords, stokKeywordsAda, stokMaxHasil, stokHarga, stokRincianUmum, stokTemplate, stokUmum, stokKosong, stokTanpaNama] =
    await Promise.all([
      getSetting('farmasi.stok_keywords', 'stok,harga'),
      getSetting('farmasi.stok_keywords_ketersediaan', ''),
      getSettingNumber('farmasi.stok_max_hasil', 5),
      getSetting('farmasi.stok_harga', 'jualbebas'),
      getSetting('farmasi.stok_rincian_umum', 'ringkas'),
      getSetting('farmasi.stok_template', ''),
      getSetting('farmasi.stok_template_umum', ''),
      getSetting('farmasi.stok_template_kosong', ''),
      getSetting('farmasi.stok_template_tanpa_nama', ''),
    ]);

  const nilaiStok: NilaiStok = {
    mode,
    keywords: stokKeywords ?? '',
    keywordsKetersediaan: stokKeywordsAda ?? '',
    maxHasil: stokMaxHasil,
    harga: stokHarga === 'ralan' ? 'ralan' : 'jualbebas',
    rincianUmum: stokRincianUmum === 'harga' ? 'harga' : 'ringkas',
    template: stokTemplate ?? '',
    templateUmum: stokUmum ?? '',
    templateKosong: stokKosong ?? '',
    templateTanpaNama: stokTanpaNama ?? '',
  };

  return (
    <section>

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
      <PengadaanSwitch enabled={enabled} adaTujuan={adaTujuan} sejak={sejak ?? ''} />

      <PengadaanForm nilai={nilai} adaTujuan={adaTujuan} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Hibah                                                                */
/* ------------------------------------------------------------------------- */

async function TabHibah({ enabled, adaTujuan }: { enabled: boolean; adaTujuan: boolean }) {
  const [template, nilaiIkut, lookback, kuota, sejak] = await Promise.all([
    getSetting('farmasi.template_hibah', ''),
    getSettingBool('farmasi.hibah_nilai', true),
    getSettingNumber('farmasi.hibah_lookback_hari', 7),
    getSettingNumber('farmasi.hibah_max_per_siklus', 5),
    getSetting('farmasi.hibah_sejak', ''),
  ]);

  const nilai: NilaiHibah = { template: template ?? '', nilai: nilaiIkut, lookback, kuota };

  return (
    <section>
      {/* TETAP di halaman dan TIDAK dilipat: ini pagar yang harus dibaca sebelum
          sakelarnya ditekan, bukan orientasi. Menyalakan fitur yang tabel
          sumbernya kosong menghasilkan sakelar menyala yang tidak pernah
          mengirim apa pun -- gagal DIAM, dan staf menyimpulkan sistemnya rusak.
          Keterangan pengantar tab ini pindah ke laci bantuan; yang ini tidak. */}
      <Callout
        variant="warning"
        className="mb-4"
        title="Rumah sakit ini belum pernah mencatat satu pun hibah di Khanza"
      >
        <p>
          Tabel <span className="font-mono">hibah_obat_bhp</span> masih kosong, jadi menyalakan sakelar di bawah tidak
          akan mengirim apa pun sampai ada penerimaan yang benar-benar disimpan lewat menu Hibah Obat &amp; BHP.
          Bentuk pesannya sudah diuji terhadap data hibah sungguhan dari instalasi Khanza lain, tapi{' '}
          <span className="font-medium text-foreground">belum pernah berjalan atas satu baris pun milik RS ini</span>.
        </p>
        <p className="mt-2">
          Tombol pratinjau di bawah membedakan keduanya: ia akan mengatakan &ldquo;belum pernah ada&rdquo; selama
          tabelnya kosong, dan menampilkan notanya begitu hibah pertama tercatat. Pakai itu untuk memastikan barisnya
          memang terbaca sebelum menyalakan sakelarnya.
        </p>
      </Callout>

      <HibahSwitch enabled={enabled} adaTujuan={adaTujuan} sejak={sejak ?? ''} />

      <HibahForm nilai={nilai} adaTujuan={adaTujuan} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Surat pemesanan                                                      */
/* ------------------------------------------------------------------------- */

async function TabPemesanan({ enabled, adaTujuan }: { enabled: boolean; adaTujuan: boolean }) {
  const [template, hargaIkut, lookback, kuota, sejak] = await Promise.all([
    getSetting('farmasi.template_pemesanan', ''),
    getSettingBool('farmasi.pemesanan_harga', true),
    getSettingNumber('farmasi.pemesanan_lookback_hari', 7),
    getSettingNumber('farmasi.pemesanan_max_per_siklus', 5),
    getSetting('farmasi.pemesanan_sejak', ''),
  ]);

  const nilai: NilaiPemesanan = { template: template ?? '', harga: hargaIkut, lookback, kuota };

  return (
    <section>
      {/* Perbedaan yang paling gampang keliru dipahami di halaman ini, jadi ia
          TIDAK dilipat: dua tab bersebelahan yang sama-sama menyebut "pemasok"
          dan "harga" akan terbaca sebagai fitur yang sama, lalu salah satunya
          dinyalakan dengan harapan yang keliru -- atau keduanya dinyalakan ke
          grup yang sama, yang berarti dua pesan untuk satu barang. */}
      <Callout variant="warning" className="mb-4" title="Ini ujung yang lain dari Pengadaan, bukan penggantinya">
        <p>
          <span className="font-medium text-foreground">Pemesanan</span> berbunyi saat pesanan{' '}
          <span className="font-medium text-foreground">dikirim ke pemasok</span> — barangnya belum ada.{' '}
          <span className="font-medium text-foreground">Pengadaan</span> berbunyi saat barangnya{' '}
          <span className="font-medium text-foreground">sudah datang</span> dan dicatat sebagai pembelian. Keduanya dua
          ujung dari satu alur yang sama, dan Khanza sendiri yang menyambungnya: layar pembelian mengisi datanya dari
          surat pemesanan.
        </p>
        <p className="mt-2">
          Karena itu tab ini <span className="font-medium text-foreground">tidak</span> memberitakan kedatangan barang
          — kalau ia juga melakukannya, gudang menerima dua pesan untuk satu kejadian. Kalau yang dibutuhkan cuma
          &ldquo;apa yang sudah masuk gudang&rdquo;, tab Pengadaan sudah cukup dan tab ini tidak perlu dinyalakan.
        </p>
      </Callout>

      {/* TETAP di halaman dan TIDAK dilipat, alasan sama dengan padanannya di
          tab Hibah: menyalakan fitur yang menu sumbernya praktis tak dipakai
          menghasilkan sakelar menyala yang tidak pernah mengirim apa pun. */}
      <Callout
        variant="warning"
        className="mb-4"
        title="Menu ini hampir tidak pernah dipakai di rumah sakit ini — periksa dulu sebelum menyalakan"
      >
        <p>
          Tabel <span className="font-mono">surat_pemesanan_medis</span> berisi{' '}
          <span className="font-medium text-foreground">satu</span> pesanan, bertanggal Maret 2024. Jadi bentuk
          pesannya sudah terbukti atas data sungguhan milik RS ini — tapi satu pesanan dalam lebih dari dua tahun
          berarti menu Surat Pemesanan Obat &amp; BHP di Khanza praktis belum dipakai.
        </p>
        <p className="mt-2">
          Akibatnya menyalakan sakelar di bawah{' '}
          <span className="font-medium text-foreground">tidak akan mengirim apa pun</span> sampai ada pesanan{' '}
          <span className="font-medium text-foreground">baru</span> disimpan — pesanan 2024 itu jatuh di bawah lantai
          aktivasi. Kalau bagian pengadaan memang belum memakai menunya, fitur ini tidak ada gunanya dinyalakan
          sekarang.
        </p>
        <p className="mt-2">
          Tombol pratinjau di bawah menampilkan pesanan terakhir yang tercatat. Pakai itu untuk memastikan barisnya
          memang terbaca sebelum menyalakan sakelarnya.
        </p>
      </Callout>

      <PemesananSwitch enabled={enabled} adaTujuan={adaTujuan} sejak={sejak ?? ''} />

      <PemesananForm nilai={nilai} adaTujuan={adaTujuan} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Tab: Penjualan                                                            */
/* ------------------------------------------------------------------------- */

async function TabPenjualan({ enabled, adaTujuan }: { enabled: boolean; adaTujuan: boolean }) {
  const [
    template,
    templateHapus,
    harga,
    kabarHapus,
    lookback,
    kuota,
    sejak,
    rekapEnabled,
    rekapJam,
    rekapOffset,
    rekapTemplate,
    rekapTemplateKosong,
  ] = await Promise.all([
    getSetting('farmasi.template_penjualan', ''),
    getSetting('farmasi.template_penjualan_hapus', ''),
    getSettingBool('farmasi.penjualan_harga', true),
    getSettingBool('farmasi.penjualan_hapus_kabar', true),
    getSettingNumber('farmasi.penjualan_lookback_hari', 7),
    getSettingNumber('farmasi.penjualan_max_per_siklus', 10),
    getSetting('farmasi.penjualan_sejak', ''),
    getSettingBool('farmasi.penjualan_rekap_enabled', false),
    getSetting('farmasi.penjualan_rekap_jam', '21:00'),
    getSettingNumber('farmasi.penjualan_rekap_offset_hari', 0),
    getSetting('farmasi.template_penjualan_rekap', ''),
    getSetting('farmasi.template_penjualan_rekap_kosong', ''),
  ]);

  const nilai: NilaiPenjualan = {
    template: template ?? '',
    templateHapus: templateHapus ?? '',
    harga,
    kabarHapus,
    lookback,
    kuota,
  };

  const nilaiRekap: NilaiRekap = {
    jam: rekapJam ?? '21:00',
    offset: rekapOffset,
    template: rekapTemplate ?? '',
    templateKosong: rekapTemplateKosong ?? '',
  };

  return (
    <section>
      {/* TIDAK dilipat, dan ini satu-satunya peringatan privasi di halaman ini
          yang berbunyi berbeda dari ketiga tab nota barang lain. Di sana
          kalimatnya "tidak ada kolom pasiennya"; di sini kolomnya ADA dan yang
          menahannya adalah keputusan kode. Menyamakan bunyinya akan menyembunyikan
          justru perbedaan yang paling perlu diketahui pembacanya. */}
      <Callout variant="privasi" className="mb-4" title="Tabel penjualan PUNYA kolom pasien — dan kolom itu sengaja tidak dibaca">
        <p>
          Berbeda dari Pengadaan, Pemesanan, dan Hibah, tabel{' '}
          <span className="font-mono">penjualan</span> punya <span className="font-mono">no_rkm_medis</span> dan{' '}
          <span className="font-mono">nm_pasien</span>, sementara <span className="font-mono">detailjual</span> punya
          nama obatnya. Digabung, keduanya jadi &ldquo;obat apa yang diterima siapa&rdquo; &mdash; persis yang tidak
          boleh beredar di grup.
        </p>
        <p className="mt-2">
          Karena itu keempat kolom itu (ditambah catatan kasir dan nama pembayar){' '}
          <span className="font-medium text-foreground">tidak pernah dibaca sama sekali</span> dari Khanza, dan
          variabelnya memang tidak tersedia untuk ditambahkan ke isi pesan. Nota yang dikirim menyebut{' '}
          <span className="font-medium text-foreground">barang dan rupiah</span>, tidak pernah seorang pembeli pun.
        </p>
        <p className="mt-2 text-muted-foreground">
          Terukur di rumah sakit ini: dari 16.787 nota, 16.779 memakai penanda{' '}
          <span className="font-mono">&lsquo;000&rsquo;</span> pada nomor rekam medis &mdash; jadi ini memang penjualan
          bebas di loket. Tapi delapan baris membawa nomor sungguhan, dan itu cukup untuk membuat penahanannya
          dikerjakan di tingkat query alih-alih diserahkan pada kebiasaan data.
        </p>
      </Callout>

      <PenjualanSwitch enabled={enabled} adaTujuan={adaTujuan} sejak={sejak ?? ''} />

      <PenjualanForm nilai={nilai} adaTujuan={adaTujuan} />

      {/* --------------------------------------------------------------- */}
      {/* Rekap harian -- kelas pemicu BERBEDA, jadi dipisah garis dan     */}
      {/* diberi judulnya sendiri. Ditaruh di tab yang SAMA karena         */}
      {/* keduanya tentang penjualan dan berbagi daftar tujuan; tab        */}
      {/* kesembilan akan membuat orang mencari rekap di tempat yang tidak */}
      {/* menyebut penjualan sama sekali.                                  */}
      {/* --------------------------------------------------------------- */}
      <hr className="my-8 border-border" />

      <h3 className="mb-3 text-title">Rekap harian</h3>

      <RekapSwitch
        enabled={rekapEnabled}
        adaTujuan={adaTujuan}
        notaEnabled={enabled}
        jam={nilaiRekap.jam}
        offset={nilaiRekap.offset}
      />

      <RekapForm nilai={nilaiRekap} adaTujuan={adaTujuan} />
    </section>
  );
}
