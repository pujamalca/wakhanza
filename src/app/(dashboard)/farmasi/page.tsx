import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { FarmasiTarget, StokAlertSchedule, WaGroup, WaSession, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { daftarJenisBarang } from '@/khanza/stokDarurat';
import { PageHeader, Pagination } from '@/components/ui';
import { MasterSwitch } from './MasterSwitch';
import { TargetTable, type TargetRow, type GrupRow } from './TargetTable';
import { PesanForm, type NilaiPesan } from './PesanForm';
import { StokForm, type NilaiStok } from './StokForm';
import { DaruratForm, type JadwalRow, type JenisOption, type NilaiDarurat } from './DaruratForm';
import { DaruratSwitch } from './DaruratSwitch';

export default async function FarmasiPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat URL
  // harus tetap ditolak di server (pola sama seperti /audit dan /broadcast).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { page: pageParam } = await searchParams;
  const p = hitungPaginasi(bacaHalaman(pageParam), await FarmasiTarget.count(), UKURAN_HALAMAN.konfigurasi);

  const [enabled, targets, grup, sesi, validasiEnabled, penyerahanEnabled, tValidasi, tPenyerahan, tGeneric, tRekap, maxPerCycle] =
    await Promise.all([
      getSettingBool('farmasi.enabled', false),
      FarmasiTarget.findAll({ order: [['id', 'ASC']], limit: p.limit, offset: p.offset }),
      // SENGAJA tidak dipaginasi: ini mengisi dropdown pemilih grup di dalam
      // TargetTable, bukan tabelnya. Daftar pilihan yang terpotong akan
      // menyembunyikan grup tanpa satu pun tanda, dan staf menyimpulkan grupnya
      // belum tersinkron.
      WaGroup.findAll({ order: [['nama', 'ASC']] }),
      WaSession.findByPk(1),
      getSettingBool('farmasi.validasi_enabled', true),
      getSettingBool('farmasi.penyerahan_enabled', true),
      getSetting('farmasi.template_validasi', ''),
      getSetting('farmasi.template_penyerahan', ''),
      getSetting('farmasi.template_generic', ''),
      getSetting('farmasi.template_rekap', ''),
      getSettingNumber('farmasi.max_per_cycle', 20),
    ]);

  const [stokMode, stokKeywords, stokMaxHasil, stokHarga, stokTemplate, stokKosong, stokTanpaNama] = await Promise.all([
    getSetting('farmasi.stok_mode', 'mati'),
    getSetting('farmasi.stok_keywords', 'stok,harga'),
    getSettingNumber('farmasi.stok_max_hasil', 5),
    getSetting('farmasi.stok_harga', 'jualbebas'),
    getSetting('farmasi.stok_template', ''),
    getSetting('farmasi.stok_template_kosong', ''),
    getSetting('farmasi.stok_template_tanpa_nama', ''),
  ]);

  const nilaiStok: NilaiStok = {
    mode: stokMode === 'petugas' || stokMode === 'semua' ? stokMode : 'mati',
    keywords: stokKeywords ?? '',
    maxHasil: stokMaxHasil,
    harga: stokHarga === 'ralan' ? 'ralan' : 'jualbebas',
    template: stokTemplate ?? '',
    templateKosong: stokKosong ?? '',
    templateTanpaNama: stokTanpaNama ?? '',
  };

  const [daruratEnabled, tDarurat, tDaruratKosong, pakaiBatch, daruratTanya, daruratFrasa, jadwalRows] =
    await Promise.all([
    getSettingBool('farmasi.darurat_enabled', false),
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
   * Dihitung dari SELURUH tabel, bukan dari `barisTarget` yang cuma satu
   * halaman. Tabel tujuan berpaginasi 25 baris; tujuan yang mencentang "terima
   * darurat stok" bisa berada di halaman kedua, dan peringatan "belum ada
   * tujuan" yang muncul dalam keadaan itu akan membuat staf mencentangnya lagi
   * pada tujuan lain -- lalu grup menerima peringatan dua kali.
   */
  const jumlahTujuanDarurat = await FarmasiTarget.count({ where: { terimaDaruratStok: true } });

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

  const barisTarget: TargetRow[] = targets.map((t) => ({
    id: t.id,
    jenis: t.jenis,
    chatId: t.chatId,
    label: t.label,
    isActive: t.isActive,
    bolehTanya: t.bolehTanya,
    terimaDaruratStok: t.terimaDaruratStok,
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
    <div>
      <PageHeader
        title="Farmasi"
        description="Pemberitahuan otomatis ke grup atau petugas apotek setiap resep divalidasi dan obat diserahkan."
      />

      {/* Ditempatkan SEBELUM sakelar, bukan sesudahnya. Ini satu-satunya fitur
          di sistem ini yang mengirim data pasien ke penerima yang keanggotaannya
          diatur di luar sistem -- yang perlu dibaca sebelum menyalakan, bukan
          setelah terlanjur. */}
      <div className="mb-6 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
        <h2 className="font-medium">Pesan ini berisi data pasien, dan grup bukan sistem tertutup</h2>
        <p className="mt-1 text-muted-foreground">
          Isi bawaannya memuat nama pasien, nomor rekam medis, dan poli. Siapa saja yang ada di dalam grup akan
          membacanya, dan <span className="font-medium text-foreground">anggota grup ditentukan di luar sistem ini</span>{' '}
          — admin grup mana pun bisa menambahkan orang tanpa terlihat di sini. Pakai grup yang khusus dibuat untuk
          apotek, bukan grup umum rumah sakit; tinjau anggotanya secara berkala. Bila hanya perlu penanda kerja,
          kosongkan variabel pasien dari isi pesan di bawah dan sisakan{' '}
          <span className="font-mono text-xs">{'{no_resep}'}</span> saja — nomor itu sudah cukup untuk membukanya di
          SIMRS.
        </p>
      </div>

      <MasterSwitch enabled={enabled} adaTargetAktif={barisTarget.some((t) => t.isActive)} />

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-medium">Tujuan pengiriman</h2>
        <TargetTable targets={barisTarget} grup={barisGrup} waSiap={sesi?.status === 'ready'} />
        <Pagination
          page={p.halaman}
          totalPages={p.totalHalaman}
          count={p.jumlah}
          hrefFor={(n) => hrefHalaman('/farmasi', {}, n)}
          unit="tujuan"
        />
        {barisGrup.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Daftar grup terakhir dimuat {barisGrup[0]?.syncedAt}. Grup yang baru dibuat belum muncul sampai daftarnya
            dimuat ulang.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Kejadian dan isi pesan</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Kedua kejadian di bawah dibaca dari tabel <span className="font-mono">resep_obat</span> milik SIMRS Khanza.
          wakhanza tidak pernah menulis apa pun ke sana.
        </p>
        <PesanForm nilai={nilaiPesan} />
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-medium">Balasan stok &amp; harga obat</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Arah <span className="font-medium">MASUK</span> — menjawab pertanyaan yang dikirim ke nomor rumah sakit
          (&ldquo;stok paracetamol?&rdquo;) dengan data dari <span className="font-mono">databarang</span> dan{' '}
          <span className="font-mono">gudangbarang</span> milik SIMRS Khanza. Bagian ini punya sakelarnya sendiri dan{' '}
          <span className="font-medium">tidak</span> terpengaruh sakelar utama di atas maupun sakelar di Balasan
          otomatis.
        </p>
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Ini katalog apotek, bukan resep siapa pun.</span> Yang dibaca hanya daftar
          barang beserta harga dan stok gudang — tidak ada kolom yang menghubungkan sebuah obat dengan seorang pasien,
          dan pertanyaan dari sebuah nomor tidak pernah dipakai untuk mencari pasien. Yang tetap keputusan apotek:
          apakah <span className="font-medium">persediaan dan daftar harga</span> boleh dijawab otomatis, dan kepada
          siapa.
        </div>
        <StokForm nilai={nilaiStok} />
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-medium">Darurat stok</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Dipicu <span className="font-medium">WAKTU</span> — pada jam yang dijadwalkan, sistem membaca barang yang
          stoknya sudah menyentuh atau turun di bawah{' '}
          <span className="font-mono">stokminimal</span> di Khanza, lalu mengirimkan daftarnya. Sakelarnya sendiri,{' '}
          <span className="font-medium">tidak</span> terpengaruh sakelar utama di atas.
        </p>
        <div className="mb-3 rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Barang tanpa ambang minimal tidak ikut dihitung.</span> Khanza
          membandingkan stok dengan <span className="font-mono">stokminimal</span> apa adanya, sehingga barang yang
          ambangnya belum pernah disetel (stok 0, minimum 0) ikut terhitung darurat — di database ini 141 dari 348.
          Itu bukan keadaan darurat melainkan entri katalog yang belum pernah distok, dan daftar yang dipenuhi
          kebisingan berhenti dibaca dalam seminggu. Yang dilaporkan hanya barang yang ambangnya memang disetel apotek.
        </div>

        <DaruratSwitch enabled={daruratEnabled} adaTujuan={jumlahTujuanDarurat > 0} adaJadwal={barisJadwal.length > 0} />

        <DaruratForm
          nilai={nilaiDarurat}
          jadwal={barisJadwal}
          jenis={jenisBarang}
          adaTujuan={jumlahTujuanDarurat > 0}
        />
      </section>

      <div className="mt-6 space-y-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Permintaan &ldquo;Berhenti Kirim Otomatis&rdquo; dari pasien
          tidak berlaku di sini.</span>{' '}
          Notifikasi ini tidak dikirim ke pasien melainkan ke staf, jadi tidak ada nomor pasien yang bisa dicocokkan ke
          daftar tolak — dan koordinasi kerja internal memang bukan sesuatu yang bisa dihentikan pasien.
        </p>
        <p>
          <span className="font-medium text-foreground">Jam tenang dilewati.</span> Jam tenang melindungi orang yang
          sedang tidur di rumah, bukan shift malam yang justru menunggu pesan ini. Menahannya sampai pagi juga akan
          membuat seluruh resep semalam menumpuk lalu terkirim serentak sebagai puluhan pesan basi sekaligus.
        </p>
      </div>
    </div>
  );
}
