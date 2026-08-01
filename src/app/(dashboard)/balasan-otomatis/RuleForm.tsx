'use client';

import { useActionState, useRef } from 'react';
import { AUTOREPLY_TEMPLATE_VARIABLES } from '@/core/template';
import { Card, Input, Textarea, Select, Button, Badge } from '@/components/ui';
import { createRuleAction, updateRuleAction, deleteRuleAction } from './actions';

/**
 * Petunjuk variabel dan cara pencocokan ditampilkan SEKALI di atas daftar,
 * bukan diulang di tiap kartu.
 *
 * Versi pertama menempelkannya di setiap kartu, dan hasilnya baru kelihatan
 * setelah halamannya benar-benar dilihat: dengan lima aturan, dua paragraf
 * yang sama persis muncul sepuluh kali dan memakan lebih banyak tinggi
 * daripada isi aturannya sendiri. Keterangan yang identik di mana-mana
 * berhenti dibaca sekaligus menyembunyikan yang berbeda-beda.
 */
export function RuleHelp() {
  return (
    <div className="mb-3 grid gap-3 rounded-lg border bg-card p-3 text-xs sm:grid-cols-2">
      <div>
        <div className="mb-1 font-medium">Kata kunci</div>
        <p className="text-muted-foreground">
          {/* {' '} eksplisit: spasi biasa sesudah </span> HILANG di keluaran bila
              teks sesudahnya membentang ke baris berikutnya -- JSX memangkas
              spasi di tepi baris. Terlihat hanya dengan membaca HTML yang
              benar-benar dikirim server; halaman /broadcast-terjadwal ternyata
              sudah lama mengidap cacat yang sama di tempat lain. */}
          Dipisah koma. Cocok sebagai <span className="font-medium">kata utuh</span>{' '}
          di mana pun dalam kalimat pasien — &ldquo;obat&rdquo; tidak ikut cocok pada &ldquo;obatan&rdquo;. Huruf besar-kecil,
          tanda baca, dan emoji diabaikan.
        </p>
      </div>
      <div>
        <div className="mb-1 font-medium">Variabel yang bisa dipakai di isi balasan</div>
        <p className="font-mono text-muted-foreground">{AUTOREPLY_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}</p>
        <p className="mt-1 text-muted-foreground">
          <span className="font-mono">{'{jadwal_dokter}'}</span> otomatis dipersempit ke poli yang disebut pasien bila jelas.
        </p>
      </div>
    </div>
  );
}

function ModeDanUrutan({ matchMode, priority, disabled }: { matchMode: string; priority: number; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <label className="flex-1 space-y-1">
        <span className="block text-xs font-medium">Cara cocok</span>
        <Select name="matchMode" defaultValue={matchMode} disabled={disabled} fieldSize="sm" className="w-full">
          <option value="contains">Ada di dalam pesan</option>
          <option value="exact">Persis seluruh pesan</option>
        </Select>
      </label>
      <label className="w-24 space-y-1">
        <span className="block text-xs font-medium" title="Aturan dengan urutan lebih kecil diperiksa lebih dulu">
          Urutan
        </span>
        <Input
          name="priority"
          type="number"
          min={1}
          max={999}
          defaultValue={priority}
          disabled={disabled}
          fieldSize="sm"
          className="w-full"
        />
      </label>
    </div>
  );
}

export function RuleForm({
  id,
  initialLabel,
  initialKeywords,
  initialMatchMode,
  initialBody,
  initialPriority,
  initialActive,
  readOnly,
  usage,
}: {
  id: number;
  initialLabel: string;
  initialKeywords: string;
  initialMatchMode: 'contains' | 'exact';
  initialBody: string;
  initialPriority: number;
  initialActive: boolean;
  readOnly: boolean;
  /** Berapa kali aturan ini benar-benar dipakai dalam jendela ringkasan. */
  usage: string;
}) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => updateRuleAction(id, formData),
    {},
  );

  return (
    <Card>
      <form action={formAction} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {readOnly ? (
            <Badge variant={initialActive ? 'success' : 'neutral'}>{initialActive ? 'Aktif' : 'Nonaktif'}</Badge>
          ) : (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="isActive" defaultChecked={initialActive} className="accent-primary" />
              Aktif
            </label>
          )}
        </div>

        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama aturan</span>
          <Input name="label" defaultValue={initialLabel} disabled={readOnly} className="w-full font-medium" fieldSize="sm" />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium">Kata kunci</span>
          <Input name="keywords" defaultValue={initialKeywords} disabled={readOnly} className="w-full" fieldSize="sm" />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium">Isi balasan</span>
          <Textarea
            name="body"
            defaultValue={initialBody}
            disabled={readOnly}
            rows={5}
            className="w-full font-mono"
            fieldSize="sm"
          />
        </label>

        <ModeDanUrutan matchMode={initialMatchMode} priority={initialPriority} disabled={readOnly} />

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          {/* Di dalam kartu, bukan mengambang di bawahnya: versi pertama
              menaruhnya di luar Card dan terbaca seperti keterangan kartu
              BERIKUTNYA, bukan kartu ini. */}
          <span className="text-xs text-muted-foreground">{usage}</span>
          {!readOnly && (
            <div className="flex gap-1">
              <Button type="submit" variant="primary" size="xs" disabled={isPending}>
                {isPending ? 'Menyimpan...' : 'Simpan'}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => {
                  if (window.confirm(`Hapus aturan "${initialLabel}"? Pesan yang sudah terkirim tidak terpengaruh.`)) {
                    void deleteRuleAction(id);
                  }
                }}
              >
                Hapus
              </Button>
            </div>
          )}
        </div>
      </form>
    </Card>
  );
}

export function NewRuleForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (prev: { error?: string; ok?: boolean }, formData: FormData) => {
      const result = await createRuleAction(prev, formData);
      // Hanya dikosongkan bila benar-benar tersimpan -- teks yang sudah diketik
      // staf tidak boleh hilang karena gagal validasi.
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );

  return (
    <Card className="border-dashed">
      <form ref={formRef} action={formAction} className="space-y-3">
        <h3 className="text-sm font-medium">Aturan baru</h3>
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama aturan</span>
          <Input name="label" placeholder="mis. Jam besuk" className="w-full" fieldSize="sm" />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Kata kunci</span>
          <Input name="keywords" placeholder="jam besuk, besuk, waktu besuk" className="w-full" fieldSize="sm" />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Isi balasan</span>
          <Textarea
            name="body"
            rows={5}
            placeholder="Jam besuk di {nama_rs}: 10.00-12.00 dan 17.00-19.00."
            className="w-full font-mono"
            fieldSize="sm"
          />
        </label>
        <ModeDanUrutan matchMode="contains" priority={100} />
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <div className="border-t pt-2">
          <Button type="submit" variant="secondary" size="xs" disabled={isPending}>
            {isPending ? 'Menyimpan...' : 'Tambah aturan'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
