import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ErmTarget, WaGroup, WaSession, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { daftarPenilaianAwal, type StatusPenilaian } from '@/khanza/penilaianAwal';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { Card, HelpPanel, PageHeader, Section, Callout } from '@/components/ui';
import { BantuanPenilaian } from './bantuan';
import { MasterSwitch, PenilaianSwitch } from './Switches';
import { PasienTable } from './PasienTable';
import { JadwalForm, type NilaiJadwal } from './JadwalForm';
import { TargetTable, type TargetRow, type GrupRow } from './TargetTable';

/**
 * PENILAIAN UMUM -- submenu pertama di bawah menu ERM.
 *
 * ==========================================================================
 * Kenapa SUBMENU, bukan tab
 * ==========================================================================
 *
 * Khanza punya 31 tabel `penilaian_awal_keperawatan_*`. Yang dipakai rumah sakit
 * ini baru satu, tapi menu ini memang direncanakan tumbuh -- dan tab tidak bisa
 * menampungnya: tab hidup DI DALAM satu halaman, jadi seluruh isinya satu rute
 * dan jumlahnya dibatasi lebar layar. `/farmasi` sudah menabrak batas itu pada
 * delapan tab.
 *
 * Sebagai submenu, tiap penilaian berdiri sebagai rutenya sendiri: yang tidak
 * dibuka tidak di-query sama sekali, dan yang kesepuluh tidak perlu muat di satu
 * baris.
 *
 * ==========================================================================
 * Urutan bagian: PEKERJAAN dulu, pengaturan belakangan
 * ==========================================================================
 *
 * Tabelnya di ATAS, sakelar dan jadwal di bawahnya. Itu urutan MEMAKAI, bukan
 * urutan membangun -- pelajaran yang sama sudah dibayar saat tab Darurat
 * `/farmasi` dibalik. Tabel dibuka setiap hari; jadwal disetel sekali lalu tidak
 * disentuh lagi berbulan-bulan.
 *
 * Halaman ini juga berguna PENUH tanpa satu sakelar pun menyala -- tabelnya
 * menjawab pertanyaannya sendiri. Rekap terjadwal cuma menghilangkan keharusan
 * ada orang yang ingat membukanya.
 */

const RUTE = '/erm/penilaian-umum';

const STATUS: StatusPenilaian[] = ['belum', 'sebagian', 'lengkap'];

function bacaStatus(p: string | undefined): StatusPenilaian | null {
  return STATUS.includes(p as StatusPenilaian) ? (p as StatusPenilaian) : null;
}

/** `YYYY-MM-DD` hari ini menurut jam LOKAL, bukan toISOString (yang UTC). */
function hariIni(mundur = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - mundur);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function PenilaianUmumPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; dari?: string; sampai?: string }>;
}) {
  const session = await auth();
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const sp = await searchParams;
  const status = bacaStatus(sp.status);

  /**
   * Rentang bawaan HARI INI SAJA, bukan sebulan.
   *
   * Pertanyaan yang dijawab halaman ini adalah "siapa yang perlu dikerjakan
   * SEKARANG", dan asesmen kemarin sudah lewat waktunya untuk ditindaklanjuti.
   * Rentang lebar juga berarti membaca `sik` lebih banyak pada tiap pembukaan
   * halaman, lewat kolam yang sengaja dibatasi `pool.max: 2`.
   */
  const dari = /^\d{4}-\d{2}-\d{2}$/.test(sp.dari ?? '') ? sp.dari! : hariIni();
  const sampai = /^\d{4}-\d{2}-\d{2}$/.test(sp.sampai ?? '') ? sp.sampai! : hariIni();

  const [
    ermAktif,
    penilaianAktif,
    jam,
    offset,
    maxBaris,
    rincian,
    poli,
    kolomInti,
    body,
    bodyKosong,
    targets,
    grup,
    sesi,
  ] = await Promise.all([
    getSettingBool('erm.enabled', false),
    getSettingBool('erm.penilaian_enabled', false),
    getSetting('erm.penilaian_jam', '13:00,19:30'),
    getSettingNumber('erm.penilaian_offset_hari', 0),
    getSettingNumber('erm.penilaian_max_baris', 40),
    getSetting('erm.penilaian_rincian', 'penuh'),
    getSetting('erm.penilaian_poli', ''),
    getSetting('erm.penilaian_kolom_inti', 'td,nadi,suhu,rr'),
    getSetting('erm.template_penilaian', ''),
    getSetting('erm.template_penilaian_kosong', ''),
    ErmTarget.findAll({ order: [['id', 'ASC']] }),
    WaGroup.findAll({ order: [['nama', 'ASC']], limit: 50 }),
    WaSession.findByPk(1),
  ]);

  const daftarKolom = (kolomInti ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const daftarPoli = (poli ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  /**
   * Dibaca dengan pengaturan yang SAMA dipakai worker.
   *
   * Halaman yang memakai kolom inti berbeda dari worker akan menampilkan angka
   * yang tidak pernah cocok dengan pesan yang tiba di grup, dan tidak ada satu
   * pun galat yang memberitahukannya. Karena itu keduanya berangkat dari
   * `erm.penilaian_kolom_inti` yang sama, lewat `normalkanKolomInti()` yang sama.
   */
  const semua = await daftarPenilaianAwal({
    dari,
    sampai,
    ...(daftarKolom.length > 0 ? { kolomInti: daftarKolom as never } : {}),
    ...(daftarPoli.length > 0 ? { kdPoli: daftarPoli } : {}),
  });

  const jumlah = {
    total: semua.length,
    belum: semua.filter((b) => b.status === 'belum').length,
    sebagian: semua.filter((b) => b.status === 'sebagian').length,
    lengkap: semua.filter((b) => b.status === 'lengkap').length,
  };

  const tersaring = status ? semua.filter((b) => b.status === status) : semua;
  const diminta = bacaHalaman(sp.page);
  const pag = hitungPaginasi(diminta, tersaring.length, UKURAN_HALAMAN.riwayat);
  const baris = tersaring.slice(pag.offset, pag.offset + UKURAN_HALAMAN.riwayat);

  const dasar = { status: sp.status, dari, sampai };
  const hrefStatus = (s: StatusPenilaian | null) =>
    hrefHalaman(RUTE, { ...dasar, status: s ?? undefined }, 1);

  const nilaiJadwal: NilaiJadwal = {
    jam: jam ?? '13:00,19:30',
    offset,
    maxBaris,
    rincian: rincian === 'ringkas' ? 'ringkas' : 'penuh',
    poli: poli ?? '',
    kolomInti: daftarKolom,
    body: body ?? '',
    bodyKosong: bodyKosong ?? '',
  };

  const barisTarget: TargetRow[] = targets.map((t) => ({
    id: t.id,
    jenis: t.jenis,
    chatId: t.chatId,
    label: t.label,
    isActive: t.isActive,
    terimaPenilaianUmum: t.terimaPenilaianUmum,
  }));
  const barisGrup: GrupRow[] = grup.map((g) => ({
    chatId: g.chatId,
    nama: g.nama,
    jumlahPeserta: g.jumlahPeserta ?? null,
  }));

  // Dihitung dari SELURUH tabel, bukan dari halaman yang sedang tampil --
  // pelajaran `adaTargetAktif` di /farmasi, yang dulu memeriksa satu halaman
  // paginasi lalu memperingatkan "belum ada tujuan aktif" padahal ada.
  const adaTujuan = barisTarget.some((t) => t.isActive && t.terimaPenilaianUmum);

  return (
    <>
      <PageHeader
        title="Penilaian umum"
        description="Kelengkapan asesmen awal keperawatan untuk pasien baru rawat jalan."
        help={
          <HelpPanel title="Tentang halaman ini" label="Bantuan">
            <BantuanPenilaian />
          </HelpPanel>
        }
      />

      <Section title="Pasien baru" jarak="rapat">
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <div>
            <label htmlFor="dari" className="mb-1 block text-label">
              Dari
            </label>
            <input
              id="dari"
              name="dari"
              type="date"
              defaultValue={dari}
              className="h-9 rounded-md border bg-background px-3 text-base sm:text-body"
            />
          </div>
          <div>
            <label htmlFor="sampai" className="mb-1 block text-label">
              Sampai
            </label>
            <input
              id="sampai"
              name="sampai"
              type="date"
              defaultValue={sampai}
              className="h-9 rounded-md border bg-background px-3 text-base sm:text-body"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-body font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Terapkan
          </button>
        </form>

        <PasienTable
          baris={baris}
          jumlah={jumlah}
          halaman={pag.halaman}
          totalHalaman={pag.totalHalaman}
          jumlahTampil={tersaring.length}
          hrefHalamanFn={(n) => hrefHalaman(RUTE, dasar, n)}
          hrefStatus={hrefStatus}
          statusAktif={status}
        />
      </Section>

      <Section title="Rekap terjadwal">
        <Card>
          <MasterSwitch aktif={ermAktif} penilaianAktif={penilaianAktif} adaTujuan={adaTujuan} />
          <div className="mt-4 border-t pt-4">
            <PenilaianSwitch aktif={penilaianAktif} ermAktif={ermAktif} />
          </div>
        </Card>
      </Section>

      <Section title="Jadwal & isi pesan">
        <Card>
          <JadwalForm nilai={nilaiJadwal} />
        </Card>
      </Section>

      <Section title="Tujuan pengiriman">
        <Card>
          {barisTarget.length > 0 && !adaTujuan && (
            <Callout variant="warning" title="Tidak ada tujuan yang mencentang “Terima rekap”">
              <p>
                Tujuan yang terdaftar tapi belum tercentang tidak menerima apa pun. Rekapnya akan
                jatuh tempo lalu berhenti tanpa mengirim ke siapa-siapa.
              </p>
            </Callout>
          )}
          <div className={barisTarget.length > 0 && !adaTujuan ? 'mt-3' : ''}>
            {/*
              `dari` diserahkan, bukan hari ini: tombol "Kirim rekap uji"
              mengirim rekap tanggal yang SEDANG dilihat staf di tabel atas.
              Hari tanpa satu pun pasien baru bukan kekecualian (13 Agustus 2026:
              3 pendaftaran, nol berstatus Baru), dan tombol yang cuma bisa
              menguji hari ini akan menolak justru pada hari staf paling ingin
              membuktikan sistemnya hidup.
            */}
            <TargetTable
              targets={barisTarget}
              grup={barisGrup}
              waSiap={sesi?.status === 'ready'}
              tanggal={dari}
            />
          </div>
        </Card>
      </Section>
    </>
  );
}
