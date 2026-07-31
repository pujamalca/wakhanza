'use client';

import { useActionState, useRef } from 'react';
import { BROADCAST_TEMPLATE_VARIABLES } from '@/core/template';
import { createBroadcastTemplateAction, updateBroadcastTemplateAction, deleteBroadcastTemplateAction } from './broadcastActions';
import { Card, Input, Textarea, Button, Badge } from '@/components/ui';

const VARS_HINT = BROADCAST_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

export function BroadcastTemplateForm({
  id,
  initialName,
  initialBody,
  initialActive,
  readOnly,
}: {
  id: number;
  initialName: string;
  initialBody: string;
  initialActive: boolean;
  readOnly: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => updateBroadcastTemplateAction(id, formData),
    {},
  );

  return (
    <Card>
      <form action={formAction} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {readOnly ? (
            <Badge variant={initialActive ? 'success' : 'neutral'}>{initialActive ? 'Aktif' : 'Nonaktif'}</Badge>
          ) : (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="isActive" defaultChecked={initialActive} className="accent-primary" />
              Aktif (muncul di pilihan broadcast)
            </label>
          )}
        </div>
        <Input name="name" defaultValue={initialName} disabled={readOnly} className="w-full font-medium" fieldSize="sm" />
        <Textarea name="body" defaultValue={initialBody} disabled={readOnly} rows={3} className="w-full font-mono" fieldSize="sm" />
        <p className="text-xs text-muted-foreground">Variabel tersedia: {VARS_HINT}</p>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
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
                if (window.confirm(`Hapus template "${initialName}"? Pesan yang sudah terkirim dan jadwal yang berjalan tidak terpengaruh.`)) {
                  void deleteBroadcastTemplateAction(id);
                }
              }}
            >
              Hapus
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

export function NewBroadcastTemplateForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string; ok?: boolean }, formData: FormData) => {
      const result = await createBroadcastTemplateAction(_prev, formData);
      // Dikosongkan hanya bila benar-benar tersimpan -- kalau gagal validasi,
      // teks yang sudah diketik staf tidak boleh ikut hilang.
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );

  return (
    <Card>
      <form ref={formRef} action={formAction} className="space-y-2">
        <h3 className="text-sm font-medium">Template broadcast baru</h3>
        <Input name="name" placeholder="Nama, mis. Tindak lanjut 3 hari" className="w-full" fieldSize="sm" />
        <Textarea
          name="body"
          rows={3}
          placeholder="Bpk/Ibu {nama_pasien}, ..."
          className="w-full font-mono"
          fieldSize="sm"
        />
        <p className="text-xs text-muted-foreground">Variabel tersedia: {VARS_HINT}</p>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <Button type="submit" variant="secondary" size="xs" disabled={isPending}>
          {isPending ? 'Menyimpan...' : 'Tambah template'}
        </Button>
      </form>
    </Card>
  );
}
