'use client';

import { useActionState, useState } from 'react';
import { renderTemplate, BROADCAST_TEMPLATE_VARIABLES, type TemplateVariable } from '@/core/template';
import { sendBroadcastAction } from './actions';
import { MessageEditor, WaPreview, Select, Button, cardClassName } from '@/components/ui';

export interface BroadcastTemplateOption {
  id: number;
  name: string;
  body: string;
}

const DEFAULT_BODY =
  'Bpk/Ibu {nama_pasien}, kami dari {nama_rs} ingin menyampaikan informasi terkait kunjungan Anda sebelumnya. Silakan hubungi {kontak_rs} bila ada pertanyaan.';

export function ComposeForm({
  hiddenFilters,
  sampleVars,
  total,
  reachable,
  uniqueCodeFooter,
  templates,
}: {
  hiddenFilters: Record<string, string[]>;
  sampleVars: Partial<Record<TemplateVariable, string>> | null;
  total: number;
  reachable: number;
  /** Contoh baris kode unik yang ditambahkan otomatis; null bila fitur dimatikan. */
  uniqueCodeFooter: string | null;
  /** Template broadcast tersimpan yang aktif (dikelola di /template). */
  templates: BroadcastTemplateOption[];
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

      {templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">Pakai template:</label>
          <Select
            fieldSize="sm"
            defaultValue=""
            // Teks template DISALIN ke kotak isi, bukan diacu -- staf bebas
            // menyuntingnya setelah memilih, dan template yang belakangan
            // diubah/dihapus tidak mengubah pesan yang sudah disusun/terkirim.
            onChange={(e) => {
              const picked = templates.find((t) => String(t.id) === e.target.value);
              if (picked) setBody(picked.body);
            }}
          >
            <option value="">-- pilih --</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <MessageEditor
        name="messageBody"
        value={body}
        onValueChange={setBody}
        variables={BROADCAST_TEMPLATE_VARIABLES}
        rows={4}
        showPreview={false}
      />

      {preview && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <p className="mb-1 text-muted-foreground">Pratinjau (contoh pasien pertama):</p>
          {/* WaPreview, bukan teks polos: pratinjau harus memperlihatkan *tebal*
              sebagai tebal seperti yang dilihat pasien, bukan bintangnya. */}
          <p className="whitespace-pre-wrap">
            <WaPreview text={uniqueCodeFooter ? `${preview}\n\n${uniqueCodeFooter}` : preview} />
          </p>
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
