'use client';

import { useActionState } from 'react';
import { addOptOutAction } from './actions';
import { Input, Button, cardClassName } from '@/components/ui';

export function AddOptOutForm() {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => addOptOutAction(formData),
    {},
  );

  return (
    <div className={`${cardClassName} mb-4`}>
      <p className="text-sm font-medium">Tambah nomor manual</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Untuk pasien yang menyampaikan penolakan lewat jalur lain -- lisan di loket, telepon, atau surat.
      </p>

      {/*
        Kolom bertumpuk di bawah sm lalu sebaris di atasnya. Sebelumnya baris ini
        `flex` dengan lebar tetap w-40 + w-56 + tombol tanpa pembungkusan: total
        ~530px, sehingga seluruh halaman bisa digeser ke samping 71px di layar
        ponsel. Satu-satunya halaman yang meluber saat diperiksa menyeluruh.
      */}
      <form action={formAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="w-full sm:w-40">
          <Input name="phone" placeholder="08xxxxxxxxxx" className="w-full" fieldSize="md" aria-label="Nomor telepon" />
          {state.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
        </div>
        <Input
          name="note"
          placeholder="Catatan (opsional)"
          className="w-full sm:w-56"
          fieldSize="md"
          aria-label="Catatan"
        />
        <Button type="submit" variant="secondary" size="md" disabled={isPending} className="w-full justify-center sm:w-auto">
          Tambah manual
        </Button>
      </form>
    </div>
  );
}
