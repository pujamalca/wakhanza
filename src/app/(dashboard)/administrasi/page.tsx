import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSetting, getSettingBool, getSettingJson, getSettingNumber } from '@/models';
import {
  cariSuratSakit,
  cariKunjunganSehat,
  hitungSuratSakit,
  hitungKunjunganSehat,
} from '@/khanza/suratPasien';
import { fetchPaymentOptions } from '@/khanza/pasienSegment';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN, type Paginasi } from '@/core/pagination';
import { normalizePhone, type PhoneRejectReason } from '@/core/phone';
import { formatTanggalSurat, isianSurat } from '@/core/suratDoc';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import {
  SETTING_PESAN_SAKIT,
  SETTING_PESAN_SEHAT,
  SETTING_CATATAN_KAKI,
  SETTING_DIAGNOSA,
  SETTING_AKTIF,
  SETTING_AUTO,
  SETTING_AUTO_SEJAK,
  SETTING_AUTO_LOOKBACK,
  SETTING_AUTO_KUOTA,
  AUTO_LOOKBACK_BAWAAN,
  AUTO_KUOTA_BAWAAN,
  PESAN_BAWAAN,
} from '@/lib/surat';
import {
  dokumenAktif,
  rincianObatAktif,
  contohPermintaanDokumen,
  bacaCaraBayarDokumen,
  SETTING_PESAN as SETTING_PESAN_DOKUMEN,
  SETTING_CATATAN_KAKI as SETTING_CATATAN_KAKI_DOKUMEN,
  PESAN_BAWAAN as PESAN_BAWAAN_DOKUMEN,
} from '@/lib/dokumen';
import { Template, AdministrasiTarget, WaGroup, WaSession } from '@/models';
import {
  bacaTanggalKirim,
  bulanJatuhTempo,
  bulanRekap,
  bulanSebelum,
  bulanSesudah,
  labelBulan,
  TANGGAL_KIRIM_BAWAAN,
  JAM_REKAP_BULANAN_BAWAAN,
} from '@/core/rekapBulan';
import { bacaJamRekap, tulisJamRekap } from '@/core/rekapJadwal';
import { daftarTindakanTerpakai, namaTindakanByKode } from '@/khanza/administrasiBulanan';
import { bacaTindakanKecuali } from '@/worker/administrasiBulananRunner';
import { sanitizeValue } from '@/core/template';
import { Callout, HelpPanel, PageHeader, Pagination, Section, Tabs, type TabStatus } from '@/components/ui';
import { BantuanAdministrasi } from './bantuan';
import { SuratTable, type BarisSurat } from './SuratTable';
import { MasterSwitch, AutoSwitch, DiagnosaSwitch, TeksForm } from './PengaturanForm';
import { DokumenSwitch, RincianObatSwitch, TeksDokumenForm } from './DokumenForm';
import { RentangTanggal } from './RentangTanggal';
import { BulananSwitch } from './BulananSwitch';
import { BulananTargetTable } from './BulananTargetTable';
import { BulananForm } from './BulananForm';

/**
 * Halaman ADMINISTRASI -- mengirim DOKUMEN, bukan kabar.
 *
 * Berbentuk tab lewat `?tab=`, bukan state klien, dengan alasan yang sama
 * seperti /farmasi dan /bpjs: bagian yang tidak dibuka tidak di-query sama
 * sekali. Di sini itu lebih berarti daripada di kedua halaman itu -- tab
 * Pengaturan tidak menyentuh `sik` sedikit pun, sementara kedua tab lainnya
 * membaca tabel kunjungan lewat kolam yang sengaja dibatasi `pool.max: 2`
 * supaya tidak berebut dengan SIMRS yang sedang melayani pasien.
 *
 * Rentang tanggalnya WAJIB terisi dan selalu terlihat, berbeda dari /broadcast
 * yang membolehkannya kosong. Sebabnya bukan selera melainkan bentuk kuncinya:
 * `no_surat` dan `no_rawat` adalah SATU-SATUNYA pemangkas berindeks yang
 * dipunyai kedua query ini (§4.4), jadi "semua waktu" berarti memindai seluruh
 * tabel kunjungan. Di /broadcast ada bentuk query kedua yang berangkat dari
 * `pasien`; di sini tidak ada padanannya, karena yang dicari adalah SURAT dan
 * KUNJUNGAN, bukan pasien.
 */

const TAB = ['sakit', 'sehat', 'hasil', 'bulanan', 'pengaturan'] as const;
type TabKey = (typeof TAB)[number];

/**
 * Pemicu yang lampirannya diatur di tab "Hasil & tagihan".
 *
 * `template.is_active` mereka dibaca di sini SEMATA untuk memperingatkan, bukan
 * untuk diubah: sakelar pemicunya tetap milik halaman /template, dan menaruh
 * tombolnya di dua tempat berarti dua tempat yang harus sepakat tentang satu
 * baris database.
 */
const PEMICU_DOKUMEN = { lab: 'LAB_RESULT', radiologi: 'RAD_RESULT', nota: 'BILLING_READY' } as const;

function bacaTab(param: string | undefined): TabKey {
  return TAB.includes(param as TabKey) ? (param as TabKey) : 'sakit';
}

/** Bawaan rentang: cukup lebar untuk menjangkau surat minggu lalu, cukup sempit untuk tetap murah. */
const HARI_BAWAAN: Record<'sakit' | 'sehat', number> = { sakit: 30, sehat: 7 };

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bacaTanggal(nilai: string | undefined, mundurHari: number): string {
  if (nilai && /^\d{4}-\d{2}-\d{2}$/.test(nilai)) return nilai;
  const d = new Date();
  d.setDate(d.getDate() - mundurHari);
  return iso(d);
}

const ALASAN_NOMOR: Record<PhoneRejectReason, string> = {
  empty: 'Kosong',
  too_short: 'Terlalu pendek',
  not_mobile: 'Bukan ponsel',
  unparseable: 'Tidak terbaca',
};

export default async function AdministrasiPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; dari?: string; sampai?: string; page?: string }>;
}) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat URL
  // harus tetap ditolak di server (pola sama seperti /audit, /farmasi, /bpjs).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { tab: tabParam, dari: dariParam, sampai: sampaiParam, page: pageParam } = await searchParams;
  const tab = bacaTab(tabParam);

  const [aktif, diagnosaAktif, autoAktif, bulananAktif, poliSensitif] = await Promise.all([
    getSettingBool(SETTING_AKTIF, false),
    getSettingBool(SETTING_DIAGNOSA, false),
    getSettingBool(SETTING_AUTO, false),
    /**
     * Dibaca di LUAR cabang tabnya, supaya titik status tab Rekap bulanan benar
     * tanpa menuntut seseorang membukanya dulu. Satu baris `app_setting`, jadi
     * biayanya nol -- dan keadaan "menyala tapi tanpa tujuan" adalah persis yang
     * paling perlu terlihat dari luar.
     */
    getSettingBool('administrasi.bulanan_enabled', false),
    getSettingJson<string[]>('privacy.sensitive_poli_codes', []),
  ]);
  const sensitif = new Set(poliSensitif);

  let baris: BarisSurat[] = [];
  let dari = '';
  let sampai = '';
  let p: Paginasi | null = null;

  if (tab === 'sakit' || tab === 'sehat') {
    dari = bacaTanggal(dariParam, HARI_BAWAAN[tab]);
    sampai = bacaTanggal(sampaiParam, 0);

    /**
     * Urutannya mengikat: baca `?page` -> COUNT -> jepit -> ambil barisnya.
     *
     * Sebelum ini keduanya memakai `LIMIT 200` mati tanpa satu pun kendali dan
     * tanpa keterangan apa pun di layar. Itu menggigit HARI INI, bukan suatu
     * saat nanti: pada rentang BAWAAN tab Surat sehat (7 hari) rumah sakit ini
     * menghasilkan 197 kunjungan -- tiga baris di bawah tutupnya. Satu minggu
     * agak ramai membuat sisanya lenyap tanpa galat, dan yang terlihat di layar
     * persis sama dengan "memang cuma segitu". Pada 30 hari: 727 baris, 73%
     * di antaranya tidak pernah bisa dilihat.
     *
     * COUNT-nya dibayar sekali per pembukaan tab dan terukur murah (`range` +
     * `Using index`; tiga kali jalan berturut-turut totalnya 1 ms), jadi kolam
     * `sik` ber-`pool.max: 2` tidak dirugikan.
     */
    const diminta = bacaHalaman(pageParam);
    const jumlah = tab === 'sakit' ? await hitungSuratSakit(dari, sampai) : await hitungKunjunganSehat(dari, sampai);
    p = hitungPaginasi(diminta, jumlah, UKURAN_HALAMAN.riwayat);

    if (tab === 'sakit') {
      const rows = await cariSuratSakit(dari, sampai, p.limit, p.offset);
      baris = rows.map((r) => {
        const n = normalizePhone(r.no_tlp);
        return {
          kunci: r.no_surat,
          namaPasien: isianSurat(r.nm_pasien) || '(nama kosong)',
          noRm: r.no_rkm_medis,
          tanggal: formatTanggalSurat(r.tgl_registrasi),
          keterangan: [
            isianSurat(r.lamasakit) && `${isianSurat(r.lamasakit)} hari`,
            formatTanggalSurat(r.tanggalawal) && `mulai ${formatTanggalSurat(r.tanggalawal)}`,
          ]
            .filter(Boolean)
            .join(', '),
          masalahNomor: n.ok ? '' : ALASAN_NOMOR[n.reason],
          poliSensitif: !!r.kd_poli && sensitif.has(r.kd_poli),
        };
      });
    } else {
      const rows = await cariKunjunganSehat(dari, sampai, p.limit, p.offset);
      baris = rows.map((r) => {
        const n = normalizePhone(r.no_tlp);
        return {
          kunci: r.no_rawat,
          namaPasien: isianSurat(r.nm_pasien) || '(nama kosong)',
          noRm: r.no_rkm_medis,
          tanggal: formatTanggalSurat(r.tgl_registrasi),
          keterangan: isianSurat(r.kesimpulan) ? `Tercatat: ${isianSurat(r.kesimpulan)}` : 'Belum ada catatan pemeriksaan',
          masalahNomor: n.ok ? '' : ALASAN_NOMOR[n.reason],
          poliSensitif: !!r.kd_poli && sensitif.has(r.kd_poli),
        };
      });
    }
  }

  const adaNomorTerpakai = baris.some((b) => !b.masalahNomor);

  /**
   * Tab "Hasil & tagihan" -- dibaca HANYA saat tabnya dibuka.
   *
   * `contohPermintaanDokumen()` menyentuh `sik` (satu `LIMIT 1` per jenis), dan
   * kolamnya sengaja dibatasi `pool.max: 2` supaya tidak berebut dengan SIMRS
   * yang sedang melayani pasien. Alasan yang sama membuat seluruh halaman ini
   * bertab lewat URL alih-alih state klien.
   */
  const dok =
    tab === 'hasil'
      ? await (async () => {
          const jenis = ['lab', 'radiologi', 'nota'] as const;
          const [aktifPerJenis, contohPerJenis, rincianObat, pemicu, teks, opsiCaraBayar, caraBayarPerJenis] =
            await Promise.all([
            Promise.all(jenis.map((j) => dokumenAktif(j))),
            Promise.all(jenis.map((j) => contohPermintaanDokumen(j))),
            rincianObatAktif(),
            Template.findAll({ where: { triggerCode: Object.values(PEMICU_DOKUMEN) }, attributes: ['triggerCode', 'isActive'] }),
            Promise.all([
              getSetting(SETTING_PESAN_DOKUMEN.lab),
              getSetting(SETTING_PESAN_DOKUMEN.radiologi),
              getSetting(SETTING_PESAN_DOKUMEN.nota),
              getSetting(SETTING_CATATAN_KAKI_DOKUMEN),
            ]),
            /**
             * Daftar penjamin untuk pemilihnya -- SELURUHNYA, termasuk yang
             * `penjab.status = 0`.
             *
             * Menyaringnya ke yang aktif saja terlihat lebih rapi dan salah:
             * penyaring ini dicocokkan terhadap kunjungan yang SUDAH terjadi,
             * jadi asuransi yang dinonaktifkan bulan lalu tetap penjamin
             * kunjungan bulan lalu. Menghilangkannya dari pilihan berarti
             * pasiennya tidak akan pernah bisa dimasukkan ke daftar. Alasan yang
             * sama sudah ditulis di `core/penjamin.ts`.
             *
             * Terukur di sini: 25 baris, hanya DUA yang aktif -- jadi menyaring
             * per status akan menyembunyikan belasan baris "Asuransi ...".
             */
            fetchPaymentOptions(),
            Promise.all(jenis.map((j) => bacaCaraBayarDokumen(j))),
          ]);
          const pemicuAktif = new Set(pemicu.filter((t) => t.isActive).map((t) => t.triggerCode));
          return {
            aktif: Object.fromEntries(jenis.map((j, i) => [j, aktifPerJenis[i]!])) as Record<
              (typeof jenis)[number],
              boolean
            >,
            adaContoh: Object.fromEntries(jenis.map((j, i) => [j, contohPerJenis[i] !== null])) as Record<
              (typeof jenis)[number],
              boolean
            >,
            rincianObat,
            pemicuAktif,
            opsiCaraBayar,
            caraBayar: Object.fromEntries(jenis.map((j, i) => [j, caraBayarPerJenis[i]!])) as Record<
              (typeof jenis)[number],
              string[]
            >,
            pesanLab: teks[0] ?? PESAN_BAWAAN_DOKUMEN.lab,
            pesanRad: teks[1] ?? PESAN_BAWAAN_DOKUMEN.radiologi,
            pesanNota: teks[2] ?? PESAN_BAWAAN_DOKUMEN.nota,
            catatanKakiDokumen: teks[3] ?? '',
          };
        })()
      : null;

  /**
   * Tab REKAP BULANAN (migrations/047) -- dibaca HANYA saat tabnya dibuka,
   * dengan alasan yang sama seperti tab Hasil di atas.
   *
   * Bedanya: tidak satu pun query di sini menyentuh `sik`. Yang dibaca cuma
   * `app_setting`, `administrasi_target`, `wa_group`, dan `wa_session` -- semuanya
   * di database `wakhanza`. Pembacaan `sik` baru terjadi saat staf menekan
   * Pratinjau atau Kirim rekap uji, dan saat rekapnya benar-benar jatuh tempo.
   *
   * Sakelarnya TETAP dibaca di luar cabang ini (`bulananAktif` di atas), supaya
   * titik status tabnya benar tanpa menuntut seseorang membuka tabnya dulu --
   * pola yang sama dengan `jumlahDokumenAktif`.
   */
  const bln =
    tab === 'bulanan'
      ? await (async () => {
          const [tanggalRaw, jamRaw, penanda, template, templateKosong, targets, grup, sesi] = await Promise.all([
            getSetting('administrasi.bulanan_tanggal', String(TANGGAL_KIRIM_BAWAAN)),
            getSetting('administrasi.bulanan_jam', '08:00'),
            getSetting('administrasi.bulanan_last_run', ''),
            getSetting('administrasi.template_bulanan', ''),
            getSetting('administrasi.template_bulanan_kosong', ''),
            AdministrasiTarget.findAll({ order: [['id', 'ASC']] }),
            WaGroup.findAll({ order: [['nama', 'ASC']] }),
            WaSession.findByPk(1),
          ]);

          const tanggal = bacaTanggalKirim(tanggalRaw) ?? TANGGAL_KIRIM_BAWAAN;
          const jam = tulisJamRekap(bacaJamRekap(jamRaw) ?? JAM_REKAP_BULANAN_BAWAAN);

          /**
           * Bahan kotak centang "kecualikan tindakan".
           *
           * Ini SATU-SATUNYA pembacaan `sik` di cabang tab ini, dan ia terjadi
           * hanya saat tab Rekap bulanan dibuka -- tabnya berbasis URL, jadi
           * halaman yang tidak membukanya tidak menyentuh kolam `sik` yang sengaja
           * dibatasi `pool.max: 2`. Terukur 2-3 ms.
           *
           * TIGA bulan, termasuk bulan berjalan. Satu bulan terlalu sempit --
           * tindakan yang dikerjakan sekali di bulan lalu tidak akan muncul untuk
           * dicentang -- sementara setahun mulai mengumpulkan jenis yang sudah
           * ditinggalkan. Terukur, tiga bulan menghasilkan sekitar dua puluh
           * pilihan.
           *
           * Kode yang SUDAH dicentang tapi tidak muncul di jendela itu DITAMBAHKAN
           * berikut namanya, bukan dibiarkan hilang: kotak centang yang tidak
           * dirender tidak ikut terkirim saat form disimpan, sehingga
           * pengecualiannya akan batal sendiri tanpa satu pun galat pada bulan
           * pertama tindakan itu tidak dikerjakan. Ditambahkan sebagai PILIHAN dan
           * bukan input tersembunyi supaya ia tetap bisa dilepas -- pelajaran
           * `pilihanTersembunyi()` di /broadcast.
           */
          /**
           * Bulan BERJALAN, dirakit dari dua fungsi yang sudah diuji alih-alih
           * dari `Date` langsung: `bulanRekap()` sengaja menyetel tanggal ke 1
           * sebelum mengurangi bulan, karena `setMonth()` pada tanggal 31 meluber
           * ke bulan berikutnya. Menghitungnya sendiri di sini berarti membayar
           * pelajaran itu untuk kedua kalinya.
           */
          const ymKini = bulanSesudah(bulanRekap(new Date()));
          const [tindakanDipakai, kecuali] = await Promise.all([
            daftarTindakanTerpakai(bulanSebelum(ymKini, 2), ymKini),
            bacaTindakanKecuali(),
          ]);
          const terlihat = new Set(tindakanDipakai.map((t) => String(t.kd_jenis_prw ?? '').trim()));
          const tertinggal = kecuali.filter((k) => !terlihat.has(k));
          const tambahan = tertinggal.length > 0 ? await namaTindakanByKode(tertinggal) : [];

          /**
           * `isianSurat()` lalu `sanitizeValue()`, urutan dan alasan yang sama
           * persis dengan `gabungAdmBulanan()`: `nm_perawatan` input bebas petugas
           * Khanza, dan penanda `'-'` miliknya lolos apa adanya lewat sanitizer.
           * Dikerjakan di sini juga karena daftar ini TIDAK melewati perakit teks
           * rekapnya sama sekali.
           */
          const opsiTindakan = [...tindakanDipakai, ...tambahan].map((t) => {
            const kode = String(t.kd_jenis_prw ?? '').trim();
            const nama = sanitizeValue(isianSurat(t.nm_perawatan));
            const jml = Number(t.jml) || 0;
            return {
              kode,
              nama: nama
                ? `${nama}${jml > 0 ? ` (${jml}×)` : ' — tidak dikerjakan 3 bulan terakhir'}`
                : `(kode ${kode || 'kosong'})`,
            };
          });

          /**
           * Bulan mana yang LANGSUNG berangkat begitu sakelarnya dinyalakan.
           *
           * Dihitung lewat `bulanJatuhTempo()` yang SAMA dipakai worker, bukan
           * ditebak dari tanggal hari ini. Rekap terlewat memang sengaja dikejar,
           * jadi menyalakan sakelar pada tanggal 14 membuat rekapnya berangkat
           * pada siklus berikutnya -- perilaku yang benar dan tak terduga, dan
           * kejutan tetap kejutan walau benar.
           */
          const jatuh = bulanJatuhTempo(new Date(), tanggal, bacaJamRekap(jam) ?? JAM_REKAP_BULANAN_BAWAAN, penanda);

          return {
            nilai: {
              tanggal,
              jam,
              template: template ?? '',
              templateKosong: templateKosong ?? '',
              opsiTindakan,
              tindakanKecuali: kecuali,
            },
            terakhir: penanda?.trim() ? labelBulan(penanda.trim()) : '',
            langsungBerangkat: jatuh ? labelBulan(jatuh) : '',
            targets: targets.map((t) => ({
              id: t.id,
              jenis: t.jenis,
              chatId: t.chatId,
              label: t.label,
              isActive: t.isActive,
              terimaBulanan: t.terimaBulanan,
            })),
            grup: grup.map((g) => ({ chatId: g.chatId, nama: g.nama })),
            waSiap: sesi?.status === 'ready',
            adaTujuan: targets.some((t) => t.isActive && t.terimaBulanan),
          };
        })()
      : null;

  /**
   * Titik status di tab: tiga keadaan, bukan dua. Yang ketiga -- menyala tapi
   * tidak satu pun baris bisa dikirimi -- bergejala sama persis dengan yang
   * benar (halaman tampak wajar, nol pesan keluar), dan itu yang paling mahal.
   */
  const statusKirim: TabStatus = !aktif ? 'neutral' : adaNomorTerpakai ? 'success' : 'warning';
  const labelKirim = !aktif ? 'pengiriman dimatikan' : adaNomorTerpakai ? 'siap mengirim' : 'tidak ada nomor terpakai';

  const href = (t: TabKey) =>
    t === 'pengaturan' || t === 'hasil' || t === 'bulanan'
      ? `/administrasi?tab=${t}`
      : `/administrasi?tab=${t}&dari=${dari}&sampai=${sampai}`;

  /**
   * Titik status tab Hasil, dan ia punya keadaan KETIGA yang tidak dipunyai tab
   * lain: menyala sementara pemicunya mati. Halaman tampak wajar dan nol berkas
   * keluar -- gejala yang sama persis dengan yang benar, dan itu yang paling
   * mahal. Dihitung tanpa membuka tabnya supaya keadaan itu tidak menuntut
   * seseorang mengklik dulu untuk mengetahuinya.
   */
  const jumlahDokumenAktif = dok ? Object.values(dok.aktif).filter(Boolean).length : 0;
  const adaDokumenTanpaPemicu = dok
    ? (['lab', 'radiologi', 'nota'] as const).some((j) => dok.aktif[j] && !dok.pemicuAktif.has(PEMICU_DOKUMEN[j]))
    : false;

  return (
    <div>
      <PageHeader
        title="Administrasi"
        description="Mengirim surat keterangan sakit dan sehat ke pasien sebagai berkas PDF lewat WhatsApp."
        help={
          <HelpPanel title="Tentang tab ini">
            <BantuanAdministrasi tab={tab} />
          </HelpPanel>
        }
      />

      <Tabs
        label="Bagian halaman Administrasi"
        active={tab}
        items={[
          {
            key: 'sakit',
            href: href('sakit'),
            label: 'Surat sakit',
            status: tab === 'sakit' ? statusKirim : undefined,
            statusLabel: tab === 'sakit' ? labelKirim : undefined,
          },
          {
            key: 'sehat',
            href: href('sehat'),
            label: 'Surat sehat',
            status: tab === 'sehat' ? statusKirim : undefined,
            statusLabel: tab === 'sehat' ? labelKirim : undefined,
          },
          {
            key: 'hasil',
            href: href('hasil'),
            label: 'Hasil & tagihan',
            status: !dok
              ? undefined
              : adaDokumenTanpaPemicu
                ? 'warning'
                : jumlahDokumenAktif > 0
                  ? 'success'
                  : 'neutral',
            statusLabel: !dok
              ? undefined
              : adaDokumenTanpaPemicu
                ? 'menyala tapi pemicunya mati'
                : jumlahDokumenAktif > 0
                  ? `${jumlahDokumenAktif} jenis dilampirkan`
                  : 'tidak ada lampiran',
          },
          {
            key: 'bulanan',
            href: href('bulanan'),
            label: 'Rekap bulanan',
            /**
             * Keadaan KETIGA yang tidak dipunyai tab lain: menyala tapi belum ada
             * tujuan yang mencentang. Halaman tampak wajar dan nol pesan keluar --
             * gejala yang sama persis dengan yang benar, dan itu yang paling
             * mahal. Dihitung tanpa membuka tabnya, sehingga keadaan itu tidak
             * menuntut seseorang mengklik dulu untuk mengetahuinya.
             */
            status: !bulananAktif ? 'neutral' : bln && !bln.adaTujuan ? 'warning' : 'success',
            statusLabel: !bulananAktif
              ? 'rekap bulanan dimatikan'
              : bln && !bln.adaTujuan
                ? 'menyala tapi belum ada tujuan'
                : 'rekap bulanan menyala',
          },
          {
            key: 'pengaturan',
            href: href('pengaturan'),
            label: 'Pengaturan',
            status: aktif ? 'success' : 'neutral',
            // Kirim otomatis disebut di titik statusnya, bukan cuma di dalam
            // tabnya: ia mengirim berkas tanpa ada yang menekan apa pun, jadi
            // "sedang menyala" tidak boleh menuntut seseorang membuka tab dulu
            // untuk mengetahuinya.
            statusLabel: !aktif
              ? 'pengiriman dimatikan'
              : autoAktif
                ? 'pengiriman + kirim otomatis menyala'
                : 'pengiriman menyala (manual saja)',
          },
        ]}
      />

      {/*
        Cabangnya `tab === 'bulanan'` saja, bukan `&& bln`, supaya TypeScript
        mempersempit `tab` untuk cabang-cabang di bawahnya. Bentuk `&& bln`
        membiarkan 'bulanan' tetap mungkin di cabang terakhir, dan komponen di
        sana (RentangTanggal, BantuanAdministrasi) memang tidak mengenalnya.
      */}
      {tab === 'bulanan' ? (
        bln && (
          <>
          {/**
           * Pagar yang WAJIB terbentang, bukan dilipat: ia menjawab pertanyaan
           * yang paling mungkin menahan orang menyalakan fitur di halaman INI --
           * "apakah ini ikut mengirim berkas pasien?" -- dan jawabannya tidak.
           * Melipatnya menukar halaman yang lebih pendek dengan keputusan yang
           * ditunda karena keberatan yang sebenarnya tidak berlaku.
           */}
          <Callout variant="privasi" className="mb-4" title="Rekap ini tidak mengirim satu pun data pasien">
            <p>
              Berbeda dari keempat tab lain di halaman ini, yang mengirim{' '}
              <strong>berkas PDF berisi nama, umur, dan alamat pasien</strong> ke nomor pasiennya. Yang ini mengirim{' '}
              <strong>satu pesan berisi angka</strong> ke grup staf: jumlah kunjungan, pecahan cara bayar, dan seberapa
              lengkap berkasnya terisi.
            </p>
            <p className="mt-2">
              Ditegakkan di tingkat query, bukan kebiasaan: nama pasien, nomor rekam medis, kode poli, diagnosa, dan
              seluruh isi asesmen/SOAPIE/resume <strong>tidak pernah diambil dari Khanza</strong> sama sekali.
              Kelengkapan berkas dibaca lewat ada-tidaknya barisnya &mdash; jadi sistem tahu SOAPIE sudah diisi tanpa
              pernah tahu apa isinya.
            </p>
            <p className="mt-2">
              Satu-satunya nama yang ikut adalah <strong>nama penjamin</strong> (UMUM, BPJS Kesehatan), dan selalu
              sebagai label pada baris jumlah.
            </p>
          </Callout>

          <BulananSwitch
            enabled={bulananAktif}
            adaTujuan={bln.adaTujuan}
            tanggal={bln.nilai.tanggal}
            jam={bln.nilai.jam}
            terakhir={bln.terakhir}
            langsungBerangkat={bln.langsungBerangkat}
          />

          <Section title="Tujuan pengiriman" jarak="normal">
            <BulananTargetTable targets={bln.targets} grup={bln.grup} waSiap={bln.waSiap} />
          </Section>

            <Section title="Jadwal dan isi pesan" jarak="normal">
              <BulananForm nilai={bln.nilai} adaTujuan={bln.adaTujuan} />
            </Section>
          </>
        )
      ) : tab === 'hasil' && dok ? (
        <>
          {/**
           * Peringatan pembuka SENGAJA tidak dilipat. Ia menjelaskan apa yang
           * BERUBAH secara mendasar begitu salah satu sakelar di bawah menyala,
           * dan itu bukan keterangan yang boleh ditemukan belakangan.
           */}
          <Callout variant="privasi" className="mb-4" title="Yang dikirim di sini adalah ISI pemeriksaan, bukan kabar tentangnya">
            <p>
              Ketiga pemberitahuan ini sudah berjalan sejak lama dan isinya sengaja tidak menyebut apa-apa: &ldquo;hasil
              pemeriksaan Anda sudah tersedia&rdquo;, &ldquo;tagihan Anda telah terbit&rdquo;. Menyalakan sakelar di
              bawah membuat <strong>berkas PDF berisi isinya</strong> ikut terkirim ke nomor WhatsApp pasien.
            </p>
            <p className="mt-2">
              Yang membuatnya bisa dipertanggungjawabkan hanya satu hal: <strong>penerimanya pasien itu sendiri</strong>,
              yang memang berhak atas hasilnya. Karena itu berkas <strong>tidak pernah</strong> ikut ke grup WhatsApp,
              apa pun setelan tujuan tambahan di halaman Template — grup tetap menerima teks pemberitahuannya saja.
            </p>
            <p className="mt-2">
              Yang perlu diputuskan rumah sakit, dan tidak bisa dijawab kode: nomor tujuan berasal dari{' '}
              <code>pasien.no_tlp</code> di Khanza, yang di rumah sakit ini{' '}
              <strong>sekitar 40% di antaranya belum terpakai</strong>. Berkas yang sudah diterima juga bisa diteruskan
              ke siapa pun tanpa sepengetahuan rumah sakit.
            </p>
          </Callout>

          <DokumenSwitch
            jenis="lab"
            aktif={dok.aktif.lab}
            pemicuAktif={dok.pemicuAktif.has(PEMICU_DOKUMEN.lab)}
            adaContoh={dok.adaContoh.lab}
            opsiCaraBayar={dok.opsiCaraBayar}
            caraBayarTerpilih={dok.caraBayar.lab}
          />
          <DokumenSwitch
            jenis="radiologi"
            aktif={dok.aktif.radiologi}
            pemicuAktif={dok.pemicuAktif.has(PEMICU_DOKUMEN.radiologi)}
            adaContoh={dok.adaContoh.radiologi}
            opsiCaraBayar={dok.opsiCaraBayar}
            caraBayarTerpilih={dok.caraBayar.radiologi}
          />
          <DokumenSwitch
            jenis="nota"
            aktif={dok.aktif.nota}
            pemicuAktif={dok.pemicuAktif.has(PEMICU_DOKUMEN.nota)}
            adaContoh={dok.adaContoh.nota}
            opsiCaraBayar={dok.opsiCaraBayar}
            caraBayarTerpilih={dok.caraBayar.nota}
          />
          <RincianObatSwitch aktif={dok.rincianObat} notaAktif={dok.aktif.nota} />

          <TeksDokumenForm
            pesanLab={dok.pesanLab}
            pesanRad={dok.pesanRad}
            pesanNota={dok.pesanNota}
            catatanKaki={dok.catatanKakiDokumen}
          />
        </>
      ) : tab === 'pengaturan' || tab === 'hasil' ? (
        <>
          <MasterSwitch aktif={aktif} />
          <AutoSwitch
            aktif={autoAktif}
            induk={aktif}
            sejak={(await getSetting(SETTING_AUTO_SEJAK)) ?? ''}
            lookback={await getSettingNumber(SETTING_AUTO_LOOKBACK, AUTO_LOOKBACK_BAWAAN)}
            kuota={await getSettingNumber(SETTING_AUTO_KUOTA, AUTO_KUOTA_BAWAAN)}
          />
          <DiagnosaSwitch aktif={diagnosaAktif} />
          <TeksForm
            pesanSakit={(await getSetting(SETTING_PESAN_SAKIT)) ?? PESAN_BAWAAN.sakit}
            pesanSehat={(await getSetting(SETTING_PESAN_SEHAT)) ?? PESAN_BAWAAN.sehat}
            catatanKaki={(await getSetting(SETTING_CATATAN_KAKI)) ?? ''}
            footerKode={await previewUniqueCodeFooter('preview|administrasi')}
          />
        </>
      ) : (
        <>
          {!aktif && (
            <Callout variant="warning" className="mb-4" title="Pengiriman dokumen masih dimatikan">
              Tombol Kirim tidak aktif. Pratinjau tetap bisa dibuka untuk memeriksa bentuk suratnya. Nyalakan di tab{' '}
              <a href="/administrasi?tab=pengaturan" className="underline">
                Pengaturan
              </a>
              .
            </Callout>
          )}

          {tab === 'sakit' ? null : (
            <Callout variant="warning" className="mb-4" title="Surat sehat TIDAK punya catatan di Khanza — baca ini dulu">
              <p>
                Berbeda dari surat sakit. Khanza mencetak surat keterangan sehat langsung dari layar registrasi, jadi
                tidak ada baris tersimpan yang menyatakan seorang dokter menyimpulkan &quot;sehat&quot;. Daftar di bawah
                adalah <strong>kunjungan</strong>, dan mengirim dari sini berarti <strong>menerbitkan</strong> surat —
                bukan mengantarkan ulang surat yang sudah ada.
              </p>
              <p className="mt-2">
                Kirim hanya untuk pasien yang memang sudah diperiksa dan dinyatakan sehat oleh dokter. Bila kunjungannya
                punya catatan pemeriksaan di Khanza, kesimpulannya diambil dari sana dan ditampilkan di kolom
                Keterangan.
              </p>
            </Callout>
          )}

          {/* `p.jumlah`, BUKAN `baris.length` -- sejak ada paginasi yang kedua
              selalu paling banyak satu halaman, dan "50 surat ditemukan" pada
              rentang berisi 727 adalah angka yang salah tanpa terlihat salah. */}
          <RentangTanggal tab={tab} dari={dari} sampai={sampai} jumlah={p?.jumlah ?? 0} />
          <SuratTable jenis={tab} rows={baris} aktif={aktif} />

          {p && (
            <Pagination
              page={p.halaman}
              totalPages={p.totalHalaman}
              count={p.jumlah}
              hrefFor={(n) => hrefHalaman('/administrasi', { tab, dari, sampai }, n)}
              unit={tab === 'sakit' ? 'surat' : 'kunjungan'}
            />
          )}
        </>
      )}
    </div>
  );
}
