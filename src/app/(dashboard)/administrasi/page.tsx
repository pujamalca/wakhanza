import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSetting, getSettingBool, getSettingJson } from '@/models';
import { cariSuratSakit, cariKunjunganSehat } from '@/khanza/suratPasien';
import { normalizePhone, type PhoneRejectReason } from '@/core/phone';
import { formatTanggalSurat, isianSurat } from '@/core/suratDoc';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import {
  SETTING_PESAN_SAKIT,
  SETTING_PESAN_SEHAT,
  SETTING_CATATAN_KAKI,
  SETTING_DIAGNOSA,
  SETTING_AKTIF,
  PESAN_BAWAAN,
} from '@/lib/surat';
import { Callout, PageHeader, Tabs, type TabStatus } from '@/components/ui';
import { SuratTable, type BarisSurat } from './SuratTable';
import { MasterSwitch, DiagnosaSwitch, TeksForm } from './PengaturanForm';
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

const TAB = ['sakit', 'sehat', 'pengaturan'] as const;
type TabKey = (typeof TAB)[number];

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
  searchParams: Promise<{ tab?: string; dari?: string; sampai?: string }>;
}) {
  const session = await auth();
  // Nav menyembunyikan tautan ini untuk operator, tapi akses langsung lewat URL
  // harus tetap ditolak di server (pola sama seperti /audit, /farmasi, /bpjs).
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { tab: tabParam, dari: dariParam, sampai: sampaiParam } = await searchParams;
  const tab = bacaTab(tabParam);

  const [aktif, diagnosaAktif, poliSensitif] = await Promise.all([
    getSettingBool(SETTING_AKTIF, false),
    getSettingBool(SETTING_DIAGNOSA, false),
    getSettingJson<string[]>('privacy.sensitive_poli_codes', []),
  ]);
  const sensitif = new Set(poliSensitif);

  let baris: BarisSurat[] = [];
  let dari = '';
  let sampai = '';

  if (tab === 'sakit' || tab === 'sehat') {
    dari = bacaTanggal(dariParam, HARI_BAWAAN[tab]);
    sampai = bacaTanggal(sampaiParam, 0);

    if (tab === 'sakit') {
      const rows = await cariSuratSakit(dari, sampai);
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
      const rows = await cariKunjunganSehat(dari, sampai);
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
   * Titik status di tab: tiga keadaan, bukan dua. Yang ketiga -- menyala tapi
   * tidak satu pun baris bisa dikirimi -- bergejala sama persis dengan yang
   * benar (halaman tampak wajar, nol pesan keluar), dan itu yang paling mahal.
   */
  const statusKirim: TabStatus = !aktif ? 'neutral' : adaNomorTerpakai ? 'success' : 'warning';
  const labelKirim = !aktif ? 'pengiriman dimatikan' : adaNomorTerpakai ? 'siap mengirim' : 'tidak ada nomor terpakai';

  const href = (t: TabKey) =>
    t === 'pengaturan' ? '/administrasi?tab=pengaturan' : `/administrasi?tab=${t}&dari=${dari}&sampai=${sampai}`;

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
            key: 'pengaturan',
            href: href('pengaturan'),
            label: 'Pengaturan',
            status: aktif ? 'success' : 'neutral',
            statusLabel: aktif ? 'pengiriman menyala' : 'pengiriman dimatikan',
          },
        ]}
      />

      {tab === 'pengaturan' ? (
        <>
          <MasterSwitch aktif={aktif} />
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

          <RentangTanggal tab={tab} dari={dari} sampai={sampai} jumlah={baris.length} />
          <SuratTable jenis={tab} rows={baris} aktif={aktif} />

          {baris.length >= 200 && (
            <p className="mt-2 text-xs text-warning">
              Menampilkan 200 baris pertama — daftarnya terpotong. Persempit rentang tanggalnya supaya tidak ada yang
              luput.
            </p>
          )}
        </>
      )}
    </div>
  );
}
