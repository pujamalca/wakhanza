'use client';

import { useActionState, useState } from 'react';
import { renderTemplate, BROADCAST_TEMPLATE_VARIABLES, type TemplateVariable } from '@/core/template';
import { Input, Textarea, Button, cardClassName } from '@/components/ui';
import { createScheduleAction } from './actions';

const DEFAULT_BODY =
  'Bpk/Ibu {nama_pasien}, kami dari {nama_rs} ingin menyampaikan informasi terkait kunjungan Anda sebelumnya. Silakan hubungi {kontak_rs} bila ada pertanyaan.';

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function ScheduleForm({
  hiddenFilters,
  sampleVars,
  total,
  uniqueCodeFooter,
}: {
  hiddenFilters: Record<string, string[]>;
  sampleVars: Partial<Record<TemplateVariable, string>> | null;
  total: number;
  /** Contoh baris kode unik yang ditambahkan otomatis; null bila fitur dimatikan. */
  uniqueCodeFooter: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => createScheduleAction(_prev, formData),
    {},
  );
  const [body, setBody] = useState(DEFAULT_BODY);
  const [repeatKind, setRepeatKind] = useState<'once' | 'daily' | 'weekly' | 'monthly'>('weekly');

  const preview = sampleVars ? renderTemplate(body, sampleVars) : null;

  return (
    <form action={formAction} className={`mt-4 space-y-3 ${cardClassName}`}>
      <h2 className="font-medium">Susun jadwal broadcast</h2>

      {Object.entries(hiddenFilters).map(([name, values]) =>
        values.map((v) => <input key={`${name}-${v}`} type="hidden" name={name} value={v} />),
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium">Nama jadwal (untuk staf sendiri, tidak dikirim ke pasien)</label>
        <Input name="name" placeholder="mis. Pengingat kontrol bulanan BPJS" className="w-full sm:w-1/2" />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Isi pesan</label>
        <Textarea
          name="messageBody"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          fieldSize="sm"
          className="w-full font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Variabel tersedia: {BROADCAST_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}
        </p>
      </div>

      {preview && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <p className="mb-1 text-muted-foreground">Pratinjau (contoh pasien pertama dari hasil filter saat ini):</p>
          <p className="whitespace-pre-wrap">{uniqueCodeFooter ? `${preview}\n\n${uniqueCodeFooter}` : preview}</p>
          {uniqueCodeFooter && (
            <p className="mt-2 text-muted-foreground">
              Baris terakhir ditambahkan otomatis dan BERBEDA untuk setiap pasien pada setiap kali jadwal jalan — supaya
              kiriman berulang tidak berisi teks yang identik, yang terbaca sebagai spam oleh WhatsApp. Atur atau matikan di
              Pengaturan.
            </p>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-medium">Pola pengulangan</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ['once', 'Sekali'],
              ['daily', 'Harian'],
              ['weekly', 'Mingguan'],
              ['monthly', 'Bulanan'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="repeatKind"
                value={value}
                checked={repeatKind === value}
                onChange={() => setRepeatKind(value)}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {repeatKind === 'once' ? (
        <div className="space-y-1">
          <label className="text-sm font-medium">Tanggal &amp; jam kirim</label>
          <input
            type="datetime-local"
            name="runOnceAt"
            required
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {repeatKind === 'weekly' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Hari</label>
              <select name="dayOfWeek" defaultValue={1} className="rounded-md border bg-background px-2 py-1 text-sm text-foreground">
                {DAY_LABELS.map((label, value) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {repeatKind === 'monthly' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Tanggal (1-28)</label>
              <input
                type="number"
                name="dayOfMonth"
                min={1}
                max={28}
                defaultValue={1}
                className="w-20 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Jam</label>
            <input
              type="time"
              name="timeOfDay"
              defaultValue="09:00"
              className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        </div>
      )}

      {repeatKind !== 'once' && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Berhenti otomatis setelah tanggal (opsional)</label>
          <p className="text-xs text-muted-foreground">
            Disarankan diisi -- supaya jadwal tidak berjalan tanpa batas waktu tanpa ada yang meninjau ulang.
          </p>
          <input type="date" name="stopAfterDate" className="rounded-md border bg-background px-2 py-1 text-sm text-foreground" />
        </div>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" variant="primary" size="sm" disabled={isPending || total === 0}>
        {isPending ? 'Menyimpan...' : 'Simpan jadwal'}
      </Button>
    </form>
  );
}
