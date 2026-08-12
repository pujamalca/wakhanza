import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSetting, getSettingBool, getSettingJson, getSettingNumber } from '@/models';
import {
  cariSuratSakit,
  cariKunjunganSehat,
  hitungSuratSakit,
  hitungKunjunganSehat,
} from '@/khanza/suratPasien';
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
  SETTING_PESAN as SETTING_PESAN_DOKUMEN,
  SETTING_CATATAN_KAKI as SETTING_CATATAN_KAKI_DOKUMEN,
  PESAN_BAWAAN as PESAN_BAWAAN_DOKUMEN,
} from '@/lib/dokumen';
import { Template } from '@/models';
import { Callout, PageHeader, Pagination, Tabs, type TabStatus } from '@/components/ui';
import { SuratTable, type BarisSurat } from './SuratTable';
import { MasterSwitch, AutoSwitch, DiagnosaSwitch, TeksForm } from './PengaturanForm';
import { DokumenSwitch, RincianObatSwitch, TeksDokumenForm } from './DokumenForm';
import { RentangTanggal } from './RentangTanggal';

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

const TAB = ['sakit', 'sehat', 'hasil', 'pengaturan'] as const;
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

  const [aktif, diagnosaAktif, autoAktif, poliSensitif] = await Promise.all([
    getSettingBool(SETTING_AKTIF, false),
    getSettingBool(SETTING_DIAGNOSA, false),
    getSettingBool(SETTING_AUTO, false),
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
          const [aktifPerJenis, contohPerJenis, rincianObat, pemicu, teks] = await Promise.all([
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
            pesanLab: teks[0] ?? PESAN_BAWAAN_DOKUMEN.lab,
            pesanRad: teks[1] ?? PESAN_BAWAAN_DOKUMEN.radiologi,
            pesanNota: teks[2] ?? PESAN_BAWAAN_DOKUMEN.nota,
            catatanKakiDokumen: teks[3] ?? '',
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
    t === 'pengaturan' || t === 'hasil'
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

      {tab === 'hasil' && dok ? (
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
          />
          <DokumenSwitch
            jenis="radiologi"
            aktif={dok.aktif.radiologi}
            pemicuAktif={dok.pemicuAktif.has(PEMICU_DOKUMEN.radiologi)}
            adaContoh={dok.adaContoh.radiologi}
          />
          <DokumenSwitch
            jenis="nota"
            aktif={dok.aktif.nota}
            pemicuAktif={dok.pemicuAktif.has(PEMICU_DOKUMEN.nota)}
            adaContoh={dok.adaContoh.nota}
          />
          <RincianObatSwitch aktif={dok.rincianObat} notaAktif={dok.aktif.nota} />

          <Callout className="mb-4" title="Bagaimana lampirannya bekerja, dan apa yang terjadi kalau gagal" collapsible>
            <p>
              Lampiran ini menempel pada tiga pemicu yang sudah ada — tidak ada pemberitahuan baru, dan pasien tetap
              menerima <strong>satu</strong> WhatsApp per kejadian. Selama pemicunya nonaktif di halaman Template, tidak
              ada pesan yang keluar sama sekali dan sakelar di sini tidak melakukan apa-apa.
            </p>
            <p className="mt-2">
              Berkasnya dirender oleh worker saat kejadiannya terdeteksi, dengan batas 5 dokumen per siklus supaya
              peramban pencetak PDF tidak menumpuk di proses yang juga memegang sesi WhatsApp. Bila jatahnya habis atau
              rendernya gagal, <strong>pesannya tetap terkirim tanpa berkas</strong> — teks template biasa, persis
              seperti sebelum fitur ini ada. Pasien tidak pernah kehilangan pemberitahuannya karena lampirannya
              bermasalah; yang hilang cuma lampirannya, dan berkasnya tetap bisa diambil di rumah sakit.
            </p>
            <p className="mt-2">
              Pemeriksaan yang tetap berlaku seperti pemicu lain: daftar tolak, jam tenang, dan penggantian pesan untuk
              poli sensitif. Untuk memeriksa isinya sebelum menyalakan, jalankan{' '}
              <code>npm run dryrun:dokumen</code> di server — ia menghasilkan berkas PDF-nya tanpa mengirim apa pun.
            </p>
          </Callout>

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

          {tab === 'sakit' ? (
            <Callout className="mb-4" title="Surat dibuat di Khanza — di sini hanya dikirimkan" collapsible>
              <p>
                Daftar ini membaca tabel <code>suratsakit</code>: satu baris per surat yang sudah dibuat dokter lewat
                SIMRS Khanza, lengkap dengan nomor surat dan lama istirahatnya. Halaman ini tidak pernah membuat,
                mengubah, atau menghapus surat — Khanza dibaca <strong>read-only</strong>.
              </p>
              <p className="mt-2">
                Rentang tanggal mengikuti tanggal surat <strong>dibuat</strong> (yang tersandi di nomor suratnya), bukan
                tanggal mulai istirahat — keduanya kerap berbeda, misalnya surat yang dibuat Jumat untuk istirahat mulai
                Senin.
              </p>
            </Callout>
          ) : (
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
