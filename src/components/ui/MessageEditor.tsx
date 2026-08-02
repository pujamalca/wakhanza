'use client';

import { useId, useRef, useState } from 'react';
import { parseWaMarkup, toggleMarker, insertAt, WA_MARKERS, type WaNode, type WaStyle } from '@/core/waFormat';
import { Textarea } from './Textarea';

/**
 * Kotak penyusun pesan WhatsApp: toolbar format, sisip variabel, dan pratinjau.
 *
 * SENGAJA BUKAN editor WYSIWYG (contenteditable). Editor semacam itu
 * menghasilkan HTML, dan HTML akan terkirim APA ADANYA ke pasien -- pesan
 * rumah sakit berisi `<b>` mentah. Yang benar untuk kanal ini adalah kotak
 * teks biasa yang menuliskan penanda WhatsApp (`*tebal*`, `_miring_`,
 * `~coret~`, ```` ```mono``` ````), ditambah pratinjau yang membacanya kembali.
 * Staf mendapat kemudahan tanpa satu pun karakter asing masuk ke pesan.
 *
 * Nilai tetap dipegang `<textarea name=...>` sungguhan, jadi Server Action
 * membacanya lewat FormData persis seperti sebelumnya -- tidak ada input
 * tersembunyi yang bisa tidak sinkron dengan yang dilihat staf.
 */

const TOOLBAR: Array<{ style: WaStyle; label: string; title: string; className: string }> = [
  { style: 'bold', label: 'B', title: 'Tebal  *teks*', className: 'font-bold' },
  { style: 'italic', label: 'I', title: 'Miring  _teks_', className: 'italic' },
  { style: 'strike', label: 'S', title: 'Coret  ~teks~', className: 'line-through' },
  { style: 'mono', label: '</>', title: 'Monospasi  ```teks```', className: 'font-mono text-[10px]' },
];

/**
 * Merender markup WhatsApp jadi elemen React.
 *
 * Diekspor tersendiri karena halaman Broadcast punya pratinjau yang lebih
 * berguna daripada pratinjau bawaan editor: ia mengganti variabel dengan data
 * pasien PERTAMA dari hasil filter, jadi staf melihat kalimat jadi, bukan
 * `{nama_pasien}`. Pratinjau itu tetap harus menampilkan tebal/miring dengan
 * benar, dan satu-satunya cara menjaminnya sama dengan editor adalah memakai
 * perender yang sama.
 *
 * Tidak memakai dangerouslySetInnerHTML sama sekali -- isinya berasal dari
 * ketikan staf DAN dari kolom sik, jadi merender lewat elemen React membuat
 * penyisipan HTML mustahil, bukan sekadar tidak mungkin lewat sanitasi.
 */
export function WaPreview({ text }: { text: string }) {
  return <Rendered nodes={parseWaMarkup(text)} />;
}

function Rendered({ nodes }: { nodes: WaNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'text') return <span key={i}>{n.value}</span>;
        if (n.type === 'var')
          // Variabel ditandai supaya staf melihat mana yang akan diganti isi
          // sungguhan -- inilah yang paling sering salah ketik dan selama ini
          // hanya ketahuan setelah pesannya terkirim kosong.
          return (
            <span key={i} className="rounded bg-primary/15 px-1 text-primary" title={`Diganti nilai ${n.name} saat dikirim`}>
              {`{${n.name}}`}
            </span>
          );
        const inner = <Rendered nodes={n.children} />;
        if (n.type === 'bold') return <strong key={i}>{inner}</strong>;
        if (n.type === 'italic') return <em key={i}>{inner}</em>;
        if (n.type === 'strike') return <s key={i}>{inner}</s>;
        return (
          <code key={i} className="rounded bg-muted px-1 font-mono text-xs">
            {inner}
          </code>
        );
      })}
    </>
  );
}

export function MessageEditor({
  name,
  defaultValue = '',
  value: controlledValue,
  onValueChange,
  variables = [],
  rows = 6,
  disabled = false,
  placeholder,
  /** Baris kode unik yang ditambahkan otomatis saat kirim; ditampilkan di pratinjau supaya staf tidak kaget. */
  footerNote,
  hint,
  showPreview = true,
}: {
  name: string;
  defaultValue?: string;
  /**
   * Isi dikendalikan pemanggil. Dipakai halaman Broadcast, yang harus bisa
   * MENIMPA isi kotak saat staf memilih template dari dropdown -- kalau
   * editornya memegang state sendiri, pilihan template tidak akan terlihat.
   */
  value?: string;
  onValueChange?: (v: string) => void;
  variables?: readonly string[];
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  footerNote?: string | null;
  hint?: React.ReactNode;
  /** Dimatikan bila halaman sudah punya pratinjau yang lebih spesifik (mis. dengan data pasien sungguhan). */
  showPreview?: boolean;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const terkendali = controlledValue !== undefined;
  const value = terkendali ? controlledValue : internal;

  const setValue = (v: string) => {
    if (!terkendali) setInternal(v);
    onValueChange?.(v);
  };

  const ref = useRef<HTMLTextAreaElement>(null);
  const previewId = useId();

  /** Mengembalikan fokus DAN posisi kursor sesudah nilai diubah dari tombol. */
  function terapkan(next: string, selStart: number, selEnd: number) {
    setValue(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function format(style: WaStyle) {
    const el = ref.current;
    if (!el) return;
    const r = toggleMarker(value, el.selectionStart, el.selectionEnd, style);
    terapkan(r.value, r.selStart, r.selEnd);
  }

  function sisipVariabel(nama: string) {
    const el = ref.current;
    if (!el) return;
    const r = insertAt(value, el.selectionStart, el.selectionEnd, `{${nama}}`);
    terapkan(r.value, r.caret, r.caret);
  }

  // Variabel yang diketik staf tapi tidak ada di daftar. Server sudah menolaknya
  // saat disimpan; ditampilkan di sini supaya ketahuan SEBELUM menekan Simpan.
  const dikenal = new Set(variables);
  const takDikenal = [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].filter((v) => !dikenal.has(v));

  const nodes = parseWaMarkup(value);

  return (
    <div className="space-y-1.5">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
          {TOOLBAR.map((t) => (
            <button
              key={t.style}
              type="button"
              title={t.title}
              aria-label={t.title}
              onClick={() => format(t.style)}
              className={`h-7 min-w-7 rounded px-1.5 text-sm transition-colors hover:bg-background ${t.className}`}
            >
              {t.label}
            </button>
          ))}
          {variables.length > 0 && (
            <>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
              <select
                aria-label="Sisipkan variabel"
                value=""
                onChange={(e) => {
                  if (e.target.value) sisipVariabel(e.target.value);
                }}
                className="h-7 rounded border bg-background px-1.5 text-xs text-foreground"
              >
                <option value="">+ Sisipkan variabel</option>
                {variables.map((v) => (
                  <option key={v} value={v}>{`{${v}}`}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <Textarea
        ref={ref}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={previewId}
        fieldSize="sm"
        className="w-full font-mono"
      />

      {hint}

      {takDikenal.length > 0 && (
        <p className="text-xs text-destructive">
          Variabel tidak dikenal: {takDikenal.map((v) => `{${v}}`).join(', ')} — akan ditolak saat disimpan.
        </p>
      )}

      {showPreview && (
        <div id={previewId} className="rounded-md border bg-muted/30 p-2">
          <div className="mb-1 text-xs text-muted-foreground">Pratinjau seperti di WhatsApp</div>
          {value.trim() ? (
            <div className="whitespace-pre-wrap break-words text-sm">
              <Rendered nodes={nodes} />
              {footerNote && <span className="mt-2 block text-muted-foreground">{'\n' + footerNote}</span>}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">(kosong)</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Dipakai halaman yang ingin menyebut penanda di teks bantuan tanpa menyalinnya. */
export const WA_MARKER_HINT = `${WA_MARKERS.bold}tebal${WA_MARKERS.bold}  ${WA_MARKERS.italic}miring${WA_MARKERS.italic}  ${WA_MARKERS.strike}coret${WA_MARKERS.strike}`;
