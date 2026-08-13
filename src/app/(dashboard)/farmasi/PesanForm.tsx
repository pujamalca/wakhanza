'use client';

import { useActionState } from 'react';
import { FARMASI_TEMPLATE_VARIABLES } from '@/core/template';
import { Button, Input, MessageEditor, Card } from '@/components/ui';
import { simpanPesanAction, type HasilForm } from './actions';

export interface NilaiPesan {
  validasiEnabled: boolean;
  penyerahanEnabled: boolean;
  templateValidasi: string;
  templatePenyerahan: string;
  templateGeneric: string;
  templateRekap: string;
  maxPerCycle: number;
}

/**
 * Variabel yang boleh dipakai di pesan REKAP sengaja dipersempit dari daftar
 * penuh: sebuah rekap merangkum banyak resep sekaligus, jadi {no_resep} dan
 * {nama_pasien} di sana akan terisi dari satu baris yang kebetulan terbaca
 * pertama -- angka yang terlihat pasti padahal isinya kebetulan.
 */
const VARS_REKAP = ['jumlah_resep', 'tanggal', 'jam', 'nama_rs'] as const;

export function PesanForm({ nilai }: { nilai: NilaiPesan }) {
  const [state, formAction, isPending] = useActionState(simpanPesanAction, {} as HasilForm);

  return (
    <form action={formAction} className="space-y-4">
      {/* Berdampingan, bukan bertumpuk: keempatnya kotak penyusun pesan yang
          tingginya hampir sama, dan menumpuknya membuat kotak keempat berada
          dua layar di bawah yang pertama -- padahal yang perlu dibandingkan
          justru isinya satu sama lain (pesan biasa vs pesan poli sensitif). */}
      <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="farmasi.validasi_enabled"
              defaultChecked={nilai.validasiEnabled}
              className="accent-primary"
            />
            Kirim saat resep <span className="font-semibold">divalidasi</span>
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            Dibaca dari kolom <span className="font-mono">tgl_perawatan</span> +{' '}
            <span className="font-mono">jam</span> di <span className="font-mono">resep_obat</span> — stempel saat apotek
            memproses resep, rata-rata 5 menit setelah dokter menulisnya.
          </p>
        </div>
        <div className="mt-3">
          <MessageEditor
            name="farmasi.template_validasi"
            defaultValue={nilai.templateValidasi}
            variables={FARMASI_TEMPLATE_VARIABLES}
            rows={5}
          />
        </div>
      </Card>

      <Card>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="farmasi.penyerahan_enabled"
              defaultChecked={nilai.penyerahanEnabled}
              className="accent-primary"
            />
            Kirim saat obat <span className="font-semibold">diserahkan</span>
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            Dibaca dari <span className="font-mono">tgl_penyerahan</span> +{' '}
            <span className="font-mono">jam_penyerahan</span>. Kejadian yang sama juga memicu pesan{' '}
            <span className="font-medium">&ldquo;Obat siap&rdquo;</span> ke pasien — keduanya berdiri sendiri dan bisa
            dimatikan terpisah.
          </p>
        </div>
        <div className="mt-3">
          <MessageEditor
            name="farmasi.template_penyerahan"
            defaultValue={nilai.templatePenyerahan}
            variables={FARMASI_TEMPLATE_VARIABLES}
            rows={5}
          />
        </div>
      </Card>

      <Card>
        <h3 className="text-title-sm">Pesan untuk poli sensitif</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Dipakai menggantikan pesan di atas bila resepnya berasal dari poli yang ditandai sensitif di halaman
          Pengaturan. Sengaja <span className="font-medium text-foreground">tetap dikirim</span>, bukan didiamkan —
          apotek harus tetap tahu ada pekerjaan masuk — tapi tidak menyebut pasien maupun poli, karena isinya terbaca
          semua anggota grup.
        </p>
        <div className="mt-3">
          <MessageEditor
            name="farmasi.template_generic"
            defaultValue={nilai.templateGeneric}
            variables={FARMASI_TEMPLATE_VARIABLES}
            rows={4}
          />
        </div>
      </Card>

      <Card>
        <h3 className="text-title-sm">Pesan rekap saat sedang ramai</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Bila satu putaran pemeriksaan menemukan lebih banyak resep dari ambang di bawah, yang dikirim adalah{' '}
          <span className="font-medium text-foreground">satu pesan rekap</span>, bukan sekian puluh pesan satuan.
          Mengirimnya satu per satu adalah pola beruntun yang memicu deteksi spam WhatsApp — dan yang diblokir adalah
          satu-satunya nomor rumah sakit, sehingga notifikasi pasien ikut mati bersamanya.
        </p>
        <label className="mt-3 block max-w-48 space-y-1">
          <span className="block text-xs font-medium">Ambang rekap (resep per putaran)</span>
          <Input
            name="farmasi.max_per_cycle"
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
            name="farmasi.template_rekap"
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
          {isPending ? 'Menyimpan...' : 'Simpan pengaturan pesan'}
        </Button>
      </div>
    </form>
  );
}
