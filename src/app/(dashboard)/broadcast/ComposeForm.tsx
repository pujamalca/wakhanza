'use client';

import { useActionState, useState } from 'react';
import { renderTemplate, BROADCAST_TEMPLATE_VARIABLES, type TemplateVariable } from '@/core/template';
import { sendBroadcastAction } from './actions';
import { MessageEditor, WaPreview, Select, Button, cardClassName } from '@/components/ui';
import {
  periksaBerkasLampiran,
  periksaPanjangKeterangan,
  formatUkuran,
  jenisLampiranDari,
  ACCEPT_LAMPIRAN,
  MAX_KETERANGAN,
} from '@/core/media';

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
  const [lampiran, setLampiran] = useState<File | null>(null);

  const preview = sampleVars ? renderTemplate(body, sampleVars) : null;

  // Diperiksa juga di server sebelum menulis apa pun (actions.ts). Di sini
  // hanya supaya staf tahu SEBELUM menekan Kirim, bukan sesudah.
  const berkasError = lampiran ? periksaBerkasLampiran(lampiran.name, lampiran.type, lampiran.size).error : undefined;
  const panjangFooter = uniqueCodeFooter ? uniqueCodeFooter.length + 2 : 0;
  const keteranganError = lampiran && !berkasError ? periksaPanjangKeterangan(body, panjangFooter).error : undefined;
  const lampiranBermasalah = !!(berkasError || keteranganError);

  return (
    <form
      action={formAction}
      className={`mt-4 space-y-2 ${cardClassName}`}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Kirim pesan ini ke ${total} pasien (${reachable} akan benar-benar menerima -- sisanya tanpa nomor valid atau sudah berhenti)?` +
            (lampiran ? `\n\nLampiran ikut terkirim: ${lampiran.name} (${formatUkuran(lampiran.size)}).` : ''),
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

      <div className="space-y-1 border-t pt-2">
        <label className="text-xs font-medium" htmlFor="media-broadcast">
          Lampiran (opsional)
        </label>
        <input
          id="media-broadcast"
          type="file"
          name="media"
          accept={ACCEPT_LAMPIRAN}
          onChange={(e) => setLampiran(e.target.files?.[0] ?? null)}
          className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-border file:bg-muted file:px-2 file:py-1 file:text-xs file:text-foreground hover:file:bg-muted/70"
        />
        {lampiran && !berkasError && (
          <p className="text-xs text-muted-foreground">
            {jenisLampiranDari(lampiran.type)?.label} &middot; {formatUkuran(lampiran.size)} &middot; dikirim sebagai{' '}
            <span className="text-foreground">{lampiran.name}</span>
          </p>
        )}
        {/* Batas keterangan hanya berlaku SAAT ada lampiran -- pesan teks biasa
            boleh panjang, jadi angka ini sengaja tidak ditampilkan kalau tidak
            ada berkas yang dipilih. */}
        {lampiran && !berkasError && !keteranganError && (
          <p className="text-xs text-muted-foreground">
            Panjang pesan {body.length + panjangFooter} / {MAX_KETERANGAN} karakter (termasuk baris kode pengiriman).
          </p>
        )}
        {(berkasError || keteranganError) && <p className="text-xs text-destructive">{berkasError ?? keteranganError}</p>}
      </div>

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}

      <Button type="submit" variant="primary" size="xs" disabled={isPending || total === 0 || lampiranBermasalah}>
        {isPending ? 'Mengirim...' : `Kirim ke ${total} pasien`}
      </Button>
    </form>
  );
}
