'use client';

import { useActionState } from 'react';
import { BPJS_BATAL_TEMPLATE_VARIABLES } from '@/core/template';
import { Button, Input, MessageEditor, Card } from '@/components/ui';
import { simpanBatalAction, type HasilForm } from './actions';

export interface NilaiBatal {
  template: string;
  templateGeneric: string;
  templateRekap: string;
  maxPerCycle: number;
}

/**
 * Variabel untuk pesan REKAP sengaja dipersempit -- alasan yang sama seperti di
 * /farmasi: sebuah rekap merangkum banyak pembatalan sekaligus, jadi
 * {nama_pasien} di sana akan terisi dari satu baris yang kebetulan terbaca,
 * yaitu angka yang terlihat pasti padahal isinya kebetulan.
 */
const VARS_REKAP = ['jumlah_batal', 'tanggal_batal', 'nama_rs'] as const;

export function BatalForm({ nilai }: { nilai: NilaiBatal }) {
  const [state, formAction, isPending] = useActionState(simpanBatalAction, {} as HasilForm);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-medium">Isi pemberitahuan</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{'{tanggal}'}</span> dan <span className="font-mono">{'{jam}'}</span> adalah
            jadwal yang <span className="font-medium text-foreground">dibatalkan</span> — slot yang jadi kosong.{' '}
            <span className="font-mono">{'{tanggal_batal}'}</span> adalah kapan pasien membatalkannya.
          </p>
          <div className="mt-3">
            <MessageEditor
              name="bpjs.template_batal"
              defaultValue={nilai.template}
              variables={BPJS_BATAL_TEMPLATE_VARIABLES}
              rows={7}
            />
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-medium">Pesan untuk poli sensitif</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Menggantikan pesan di samping bila bookingnya menuju poli yang ditandai sensitif di halaman Pengaturan.
            Sengaja <span className="font-medium text-foreground">tetap dikirim</span>, bukan didiamkan — kalau
            didiamkan, slot pasien poli sensitif diam-diam tidak pernah ditawarkan ke siapa pun, dan yang dirugikan
            justru pasien yang perlindungannya paling dijaga.
          </p>
          <div className="mt-3">
            <MessageEditor
              name="bpjs.template_batal_generic"
              defaultValue={nilai.templateGeneric}
              variables={BPJS_BATAL_TEMPLATE_VARIABLES}
              rows={5}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="text-sm font-medium">Pesan rekap saat pembatalan menumpuk</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bila satu putaran menemukan lebih banyak pembatalan dari ambang di bawah, yang dikirim adalah{' '}
            <span className="font-medium text-foreground">satu pesan rekap</span>. Keadaan itu nyata: seorang dokter
            berhalangan, admin membatalkan seluruh jadwalnya, dan puluhan baris muncul sekaligus. Mengirimnya satu per
            satu adalah pola beruntun yang memicu deteksi spam WhatsApp — dan yang diblokir adalah satu-satunya nomor
            rumah sakit, sehingga notifikasi pasien ikut mati bersamanya.
          </p>
          <label className="mt-3 block max-w-48 space-y-1">
            <span className="block text-xs font-medium">Ambang rekap (pembatalan per putaran)</span>
            <Input
              name="bpjs.batal_max_per_cycle"
              type="number"
              min={1}
              max={200}
              defaultValue={nilai.maxPerCycle}
              fieldSize="sm"
              className="w-full"
            />
          </label>
          <div className="mt-3">
            <MessageEditor
              name="bpjs.template_batal_rekap"
              defaultValue={nilai.templateRekap}
              variables={VARS_REKAP}
              rows={4}
            />
          </div>
        </Card>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.sukses && <p className="text-sm text-success">{state.sukses}</p>}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Menyimpan...' : 'Simpan pengaturan pembatalan'}
        </Button>
      </div>
    </form>
  );
}
