'use client';

import { useActionState } from 'react';
import { correctPhoneAction } from './actions';
import { Input, Button } from '@/components/ui';

export function CorrectionForm({ noRkmMedis, currentValue }: { noRkmMedis: string; currentValue: string | null }) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => correctPhoneAction(noRkmMedis, formData),
    {},
  );

  return (
    <form action={formAction} className="flex items-start gap-1">
      <div>
        <Input name="phone" defaultValue={currentValue ?? ''} placeholder="08xxxxxxxxxx" className="w-36" fieldSize="sm" />
        {state.error && <p className="max-w-[9rem] text-[11px] text-destructive">{state.error}</p>}
      </div>
      <Button type="submit" variant="secondary" size="xs" disabled={isPending}>
        Simpan
      </Button>
    </form>
  );
}
