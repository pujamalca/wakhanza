'use client';

import { useActionState } from 'react';
import { updateTemplateAction } from './actions';
import { Card, Input, Textarea, Button, Badge } from '@/components/ui';

const KNOWN_VARS = [
  'nama_pasien',
  'no_rm',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'no_antrian',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'jenis_layanan',
];

export function TemplateForm({
  triggerCode,
  initialLabel,
  initialBody,
  initialActive,
  readOnly,
}: {
  triggerCode: string;
  initialLabel: string;
  initialBody: string;
  initialActive: boolean;
  readOnly: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => updateTemplateAction(triggerCode, formData),
    {},
  );

  return (
    <Card>
      <form action={formAction} className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">{triggerCode}</span>
          {readOnly ? (
            <Badge variant={initialActive ? 'success' : 'neutral'}>{initialActive ? 'Aktif' : 'Nonaktif'}</Badge>
          ) : (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="isActive" defaultChecked={initialActive} className="accent-primary" />
              Aktif
            </label>
          )}
        </div>
        <Input name="label" defaultValue={initialLabel} disabled={readOnly} className="w-full font-medium" fieldSize="sm" />
        <Textarea name="body" defaultValue={initialBody} disabled={readOnly} rows={3} className="w-full font-mono" fieldSize="sm" />
        <p className="text-xs text-muted-foreground">Variabel tersedia: {KNOWN_VARS.map((v) => `{${v}}`).join(' ')}</p>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        {!readOnly && (
          <Button type="submit" variant="primary" size="xs" disabled={isPending}>
            {isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        )}
      </form>
    </Card>
  );
}
