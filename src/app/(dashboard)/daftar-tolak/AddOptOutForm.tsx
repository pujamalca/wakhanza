'use client';

import { useActionState } from 'react';
import { addOptOutAction } from './actions';
import { Input, Button } from '@/components/ui';

export function AddOptOutForm() {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => addOptOutAction(formData),
    {},
  );

  return (
    <form action={formAction} className="mb-4 flex items-start gap-2">
      <div>
        <Input name="phone" placeholder="08xxxxxxxxxx" className="w-40" fieldSize="md" />
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      </div>
      <Input name="note" placeholder="Catatan (opsional)" className="w-56" fieldSize="md" />
      <Button type="submit" variant="secondary" size="md" disabled={isPending}>
        Tambah manual
      </Button>
    </form>
  );
}
