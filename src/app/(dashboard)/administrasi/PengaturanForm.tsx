'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button, Card, cardClassName, Callout, MessageEditor, Textarea } from '@/components/ui';
import {
  toggleAdministrasiAction,
  toggleDiagnosaAction,
  simpanTeksAction,
  type HasilForm,
} from './actions';

const VARIABEL = ['nama_pasien', 'no_rm', 'nama_rs', 'alamat_rs', 'kontak_rs'] as const;

/**
 * Sakelar utama.
 *
 * Peringatannya SENGAJA tidak dilipat ke dalam `<details>` seperti keterangan
 * panjang lain di proyek ini: ia harus dibaca SEBELUM sakelarnya dinyalakan,
 * dan melipatnya menukar halaman yang lebih pendek dengan keputusan yang
 * diambil tanpa keterangan. Aturan yang sama sudah ditetapkan pada peringatan
 * "pesan ini berisi data pasien" di /farmasi.
 */
export function MasterSwitch({ aktif }: { aktif: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pesan, setPesan] = useState<HasilForm | null>(null);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-medium">Pengiriman dokumen ke pasien</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saat menyala, staf bisa mengirim surat keterangan sakit dan sehat sebagai berkas PDF lewat WhatsApp resmi
            rumah sakit. Surat tetap dibuat di SIMRS Khanza — halaman ini hanya mengirimkannya.
          </p>
        </div>
        <Button
          variant={aktif ? 'secondary' : 'primary'}
          disabled={pending}
          onClick={() =>
            startTransition(async () => setPesan(await toggleAdministrasiAction(!aktif)))
          }
        >
          {pending ? 'Menyimpan...' : aktif ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>

      {pesan?.sukses && <p className="mt-3 text-sm text-success">{pesan.sukses}</p>}
      {pesan?.error && <p className="mt-3 text-sm text-destructive">{pesan.error}</p>}

      <Callout variant="warning" className="mt-4" title="Yang beredar bukan lagi kabar, melainkan surat">
        <p>
          Sepuluh pemicu lain mengirim pemberitahuan singkat. Yang ini mengirim{' '}
          <strong>dokumen resmi rumah sakit</strong> berisi nama, umur, alamat, dan nomor rekam medis pasien — berkas
          yang setelah diterima bisa diteruskan ke siapa pun tanpa sepengetahuan rumah sakit.
        </p>
        <p className="mt-2">
          Dua hal yang perlu diputuskan lebih dulu, dan keduanya bukan urusan teknis: apakah surat keterangan sakit yang
          dikirim lewat WhatsApp diterima sebagai sah oleh tempat kerja pasien, dan siapa yang bertanggung jawab bila
          berkas itu sampai ke nomor yang keliru. Nomor tujuan berasal dari <code>pasien.no_tlp</code> di Khanza, yang
          di rumah sakit ini <strong>sekitar 40% di antaranya belum terpakai</strong>.
        </p>
      </Callout>

    </Card>
  );
}

/**
 * Sakelar diagnosa, DIPISAH dari sakelar utama.
 *
 * Bukan kerapian: sakelar utama menjawab "boleh mengirim surat?", yang ini
 * menjawab "apa yang tercetak di dalamnya?". Rumah sakit yang mau mengirim
 * surat tapi tidak mau diagnosanya ikut beredar adalah pemakaian yang sangat
 * wajar, dan pilihan yang digabung adalah pilihan yang hilang -- pelajaran
 * yang sudah dibayar tiga kali pada `farmasi_target` (`is_active`,
 * `boleh_tanya`, `terima_darurat_stok`).
 */
export function DiagnosaSwitch({ aktif }: { aktif: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pesan, setPesan] = useState<HasilForm | null>(null);

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-medium">Cetak diagnosa di surat keterangan sakit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saat ini <strong>{aktif ? 'ikut tercetak' : 'tidak tercetak'}</strong>.
          </p>
        </div>
        <Button
          variant={aktif ? 'secondary' : 'primary'}
          disabled={pending}
          onClick={() => startTransition(async () => setPesan(await toggleDiagnosaAction(!aktif)))}
        >
          {pending ? 'Menyimpan...' : aktif ? 'Jangan cetak' : 'Cetak diagnosa'}
        </Button>
      </div>

      {pesan?.sukses && <p className="mt-3 text-sm text-success">{pesan.sukses}</p>}
      {pesan?.error && <p className="mt-3 text-sm text-destructive">{pesan.error}</p>}

      <Callout className="mt-4" title="Kenapa ini mati sejak awal" collapsible>
        <p>
          Khanza punya dua bentuk surat sakit: <code>rptSuratSakit.jasper</code> tanpa diagnosa, dan{' '}
          <code>rptSuratSakit5.jasper</code> yang mencetak kode ICD beserta nama penyakitnya, plus kalimat izin
          menyampaikan diagnosa kepada pihak yang berkepentingan.
        </p>
        <p className="mt-2">
          Selama mati, kolom diagnosanya <strong>tidak dibaca sama sekali</strong> dari Khanza — jadi ia bukan sekadar
          tidak dicetak, melainkan tidak pernah masuk ke sistem ini. Menyalakannya berarti diagnosa pasien ikut beredar
          sebagai berkas WhatsApp, dan itu keputusan rumah sakit, bukan bawaan sistem.
        </p>
      </Callout>
    </Card>
  );
}

export function TeksForm({
  pesanSakit,
  pesanSehat,
  catatanKaki,
  footerKode,
}: {
  pesanSakit: string;
  pesanSehat: string;
  catatanKaki: string;
  footerKode: string | null;
}) {
  const [state, action, pending] = useActionState(simpanTeksAction, {} as HasilForm);

  return (
    // `cardClassName` string, bukan komponen <Card>: elemennya <form>, dan
    // membungkusnya dengan <div> hanya demi gaya akan memisahkan tombol Simpan
    // dari form-nya.
    <form action={action} className={`${cardClassName} mt-6`}>
        <h2 className="font-medium">Teks pengantar dan catatan kaki</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Pesan pengantar adalah keterangan yang menyertai berkas di WhatsApp. Karena ada lampiran, WhatsApp
          membatasinya <strong>1.024 karakter</strong> — jauh lebih pendek daripada pesan biasa.
        </p>

        <div className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium">Pesan pengantar — surat keterangan sakit</label>
            <MessageEditor
              name="pesan_sakit"
              defaultValue={pesanSakit}
              variables={VARIABEL}
              rows={4}
              footerNote={footerKode ?? undefined}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Pesan pengantar — surat keterangan sehat</label>
            <MessageEditor
              name="pesan_sehat"
              defaultValue={pesanSehat}
              variables={VARIABEL}
              rows={4}
              footerNote={footerKode ?? undefined}
            />
          </div>

          <div>
            <label htmlFor="catatan_kaki" className="mb-1 block text-sm font-medium">
              Catatan kaki di dalam surat
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Dicetak kecil di kaki halaman PDF. Padanan blok &quot;ditandatangani secara elektronik&quot; milik Khanza.
              Boleh memakai <code>{'{nama_rs}'}</code> dan <code>{'{kontak_rs}'}</code>. Dikosongkan pun tetap ada
              bentuk bawaannya — sebuah berkas yang beredar tanpa menyebut asalnya tidak bisa dibedakan dari berkas yang
              disunting siapa pun.
            </p>
            <Textarea id="catatan_kaki" name="catatan_kaki" defaultValue={catatanKaki} rows={3} />
          </div>
        </div>

        {state.error && <p className="mt-3 text-sm text-destructive">{state.error}</p>}
        {state.sukses && <p className="mt-3 text-sm text-success">{state.sukses}</p>}

        <div className="mt-4">
          <Button type="submit" disabled={pending}>
            {pending ? 'Menyimpan...' : 'Simpan teks'}
          </Button>
        </div>
    </form>
  );
}
