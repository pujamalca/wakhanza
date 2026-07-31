'use client';

import { useState } from 'react';

/**
 * Dua mode jendela tanggal (lihat khanza/broadcastSchedule.ts) menentukan
 * berapa kali SATU pasien menerima pesan, jadi pilihannya harus terbaca
 * eksplisit -- bukan tersembunyi di balik angka "lookback" yang artinya
 * berubah tergantung pola pengulangan.
 *
 * Preset diterima lewat prop, bukan diimpor dari ./filters: modul itu menarik
 * khanza/* yang berujung ke koneksi database -- tidak boleh masuk bundel klien.
 */
export function WindowModeFields({
  presets,
  defaultMode,
  defaultLookback,
  defaultOffset,
}: {
  presets: { key: string; label: string }[];
  defaultMode: 'rolling' | 'followup';
  defaultLookback: number;
  defaultOffset: number;
}) {
  const [mode, setMode] = useState(defaultMode);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Pasien mana yang dikirimi (dihitung ulang tiap kali jadwal jalan)</p>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name="windowMode"
          value="followup"
          checked={mode === 'followup'}
          onChange={() => setMode('followup')}
          className="mt-1 accent-primary"
        />
        <span>
          <span className="font-medium">Tindak lanjut</span> — pasien yang berkunjung{' '}
          <input
            type="number"
            name="offset"
            min={0}
            defaultValue={defaultOffset}
            disabled={mode !== 'followup'}
            className="w-16 rounded-md border bg-background px-2 py-0.5 text-xs text-foreground disabled:opacity-40"
          />{' '}
          hari yang lalu, tepat hari itu saja.
          <span className="block text-xs text-muted-foreground">
            Dipasangkan dengan pengulangan harian, setiap pasien melewati jendela ini persis sekali — inilah bentuk &ldquo;pasien
            yang daftar hari ini, dikirimi 3 hari lagi&rdquo;. Isi 0 untuk pasien yang daftar hari ini juga.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name="windowMode"
          value="rolling"
          checked={mode === 'rolling'}
          onChange={() => setMode('rolling')}
          className="mt-1 accent-primary"
        />
        <span>
          <span className="font-medium">Jendela berjalan</span> — semua pasien yang berkunjung dalam{' '}
          <input
            type="number"
            name="lookback"
            min={1}
            defaultValue={defaultLookback}
            disabled={mode !== 'rolling'}
            className="w-16 rounded-md border bg-background px-2 py-0.5 text-xs text-foreground disabled:opacity-40"
          />{' '}
          hari terakhir.
          <span className="block text-xs text-muted-foreground">
            Pasien yang sama tetap masuk kriteria selama masih di dalam jendela, jadi ia menerima pesan LAGI setiap kali jadwal
            jalan. Cocok untuk pengumuman berkala, bukan untuk tindak lanjut.
          </span>
          {mode === 'rolling' && (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="submit"
                  name="preset"
                  value={p.key}
                  className="rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {p.label} terakhir
                </button>
              ))}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
