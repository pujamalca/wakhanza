'use client';

import { useActionState, useState } from 'react';
import { Input, Button, Card } from '@/components/ui';
import { PANJANG_SANDI_MINIMAL } from '@/core/userPolicy';
import { ubahNamaAction, gantiSandiAction, type HasilForm } from './actions';

function Pesan({ state }: { state: HasilForm }) {
  if (state.error) return <p className="text-xs text-destructive">{state.error}</p>;
  if (state.sukses) return <p className="text-xs text-success">{state.sukses}</p>;
  return null;
}

export function FormNama({ namaSekarang }: { namaSekarang: string }) {
  const [state, formAction, isPending] = useActionState(ubahNamaAction, {} as HasilForm);

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-medium">Nama tampilan</h2>
        <p className="text-xs text-muted-foreground">
          Nama yang dilihat rekan kerja di jejak audit. Tidak pernah ikut terkirim ke pasien.
        </p>
      </div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 space-y-1">
          <span className="block text-xs font-medium">Nama lengkap</span>
          <Input name="name" defaultValue={namaSekarang} fieldSize="sm" className="w-full" required />
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </form>
      <Pesan state={state} />
    </Card>
  );
}

export function FormSandi() {
  const [baru, setBaru] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [state, formAction, isPending] = useActionState(
    async (prev: HasilForm, formData: FormData) => {
      const hasil = await gantiSandiAction(prev, formData);
      // Kotak dikosongkan hanya bila benar-benar berhasil. Mengosongkannya saat
      // gagal memaksa mengetik ulang ketiganya hanya karena satu salah.
      if (hasil.sukses) {
        setBaru('');
        setUlangi('');
      }
      return hasil;
    },
    {} as HasilForm,
  );

  const terlaluPendek = baru.length > 0 && baru.length < PANJANG_SANDI_MINIMAL;
  const tidakSama = ulangi.length > 0 && baru !== ulangi;

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-medium">Ganti kata sandi</h2>
        <p className="text-xs text-muted-foreground">
          Kata sandi saat ini wajib diisi &mdash; itu yang memastikan bukan orang lain yang menggantinya lewat komputer
          yang Anda tinggalkan terbuka.
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <label className="block space-y-1 sm:w-80">
          <span className="block text-xs font-medium">Kata sandi saat ini</span>
          <Input
            name="sandiLama"
            type="password"
            autoComplete="current-password"
            fieldSize="sm"
            className="w-full"
            required
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="block text-xs font-medium">Kata sandi baru</span>
            <Input
              name="sandiBaru"
              type="password"
              autoComplete="new-password"
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
              fieldSize="sm"
              className="w-full"
              required
            />
            <span className="block text-xs text-muted-foreground">
              Minimal {PANJANG_SANDI_MINIMAL} karakter. Kalimat pendek yang mudah diingat lebih baik daripada campuran
              simbol yang berakhir ditempel di monitor.
            </span>
          </label>
          <label className="min-w-56 flex-1 space-y-1">
            <span className="block text-xs font-medium">Ulangi kata sandi baru</span>
            <Input
              name="sandiUlangi"
              type="password"
              autoComplete="new-password"
              value={ulangi}
              onChange={(e) => setUlangi(e.target.value)}
              fieldSize="sm"
              className="w-full"
              required
            />
          </label>
        </div>

        {terlaluPendek && <p className="text-xs text-destructive">Kata sandi baru minimal {PANJANG_SANDI_MINIMAL} karakter.</p>}
        {tidakSama && <p className="text-xs text-destructive">Ulangan kata sandi belum sama.</p>}
        <Pesan state={state} />

        <Button type="submit" variant="primary" size="sm" disabled={isPending || terlaluPendek || tidakSama}>
          {isPending ? 'Menyimpan...' : 'Ganti kata sandi'}
        </Button>
      </form>
    </Card>
  );
}
