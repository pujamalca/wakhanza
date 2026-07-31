'use client';

import { useActionState, useState } from 'react';
import { renderTemplate, BROADCAST_TEMPLATE_VARIABLES, type TemplateVariable } from '@/core/template';
import { sendBroadcastAction } from './actions';
import { Textarea, Button, cardClassName } from '@/components/ui';

const DEFAULT_BODY =
  'Bpk/Ibu {nama_pasien}, kami dari {nama_rs} ingin menyampaikan informasi terkait kunjungan Anda sebelumnya. Silakan hubungi {kontak_rs} bila ada pertanyaan.';

export function ComposeForm({
  hiddenFilters,
  sampleVars,
  total,
  reachable,
  uniqueCodeFooter,
}: {
  hiddenFilters: Record<string, string[]>;
  sampleVars: Partial<Record<TemplateVariable, string>> | null;
  total: number;
  reachable: number;
  /** Contoh baris kode unik yang ditambahkan otomatis; null bila fitur dimatikan. */
  uniqueCodeFooter: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => sendBroadcastAction(_prev, formData),
    {},
  );
  const [body, setBody] = useState(DEFAULT_BODY);

  const preview = sampleVars ? renderTemplate(body, sampleVars) : null;

  return (
    <form
      action={formAction}
      className={`mt-4 space-y-2 ${cardClassName}`}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Kirim pesan ini ke ${total} pasien (${reachable} akan benar-benar menerima -- sisanya tanpa nomor valid atau sudah berhenti)?`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <h2 className="font-medium">Susun pesan</h2>

      {Object.entries(hiddenFilters).map(([name, values]) =>
        values.map((v) => <input key={`${name}-${v}`} type="hidden" name={name} value={v} />),
      )}

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

      {preview && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <p className="mb-1 text-muted-foreground">Pratinjau (contoh pasien pertama):</p>
          <p className="whitespace-pre-wrap">{uniqueCodeFooter ? `${preview}\n\n${uniqueCodeFooter}` : preview}</p>
          {uniqueCodeFooter && (
            <p className="mt-2 text-muted-foreground">
              Baris terakhir ditambahkan otomatis dan BERBEDA untuk setiap pasien — supaya kiriman massal tidak berisi teks
              yang identik, yang terbaca sebagai spam oleh WhatsApp. Atur atau matikan di Pengaturan.
            </p>
          )}
        </div>
      )}

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}

      <Button type="submit" variant="primary" size="xs" disabled={isPending || total === 0}>
        {isPending ? 'Mengirim...' : `Kirim ke ${total} pasien`}
      </Button>
    </form>
  );
}
