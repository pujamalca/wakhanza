'use client';

import { useState, useTransition } from 'react';
import { Card, Input, Button, Badge, EmptyState, IconSearch } from '@/components/ui';
import { previewAutoReplyAction, type PreviewResult } from './actions';

const CONTOH = ['jadwal dokter', 'jadwal dokter jantung', 'dokter hari ini', 'poli apa saja', 'alamat rumah sakit'];

/**
 * "Kalau pasien mengetik ini, apa yang dia terima?"
 *
 * Ini alat terpenting di halaman ini. Tanpanya, satu-satunya cara staf tahu
 * aturannya benar adalah menunggu pasien sungguhan mengirim pesan -- artinya
 * kesalahan kata kunci baru ketahuan setelah pasien menerima jawaban yang
 * salah. Kotak ini memakai fungsi pencocokan dan perenderan yang SAMA PERSIS
 * dengan worker, jadi yang tampil adalah pesan sungguhan lengkap dengan baris
 * kode uniknya, bukan perkiraan.
 */
export function TestBox() {
  const [text, setText] = useState('');
  const [hasil, setHasil] = useState<PreviewResult | null>(null);
  const [pending, start] = useTransition();

  function coba(pesan: string) {
    if (!pesan.trim()) return;
    setText(pesan);
    start(async () => setHasil(await previewAutoReplyAction(pesan)));
  }

  return (
    <Card>
      <div className="space-y-3">
        <div>
          <h3 className="text-title-sm">Uji coba</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ketik pesan seperti yang akan dikirim pasien. Tidak ada pesan yang benar-benar terkirim, dan tidak ada yang tercatat.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            coba(text);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="mis. mau tanya jadwal dokter jantung"
            aria-label="Pesan pasien untuk diuji"
            className="w-full"
            fieldSize="sm"
          />
          <Button type="submit" variant="primary" size="sm" disabled={pending || !text.trim()} className="shrink-0 justify-center">
            <IconSearch className="h-4 w-4" />
            {pending ? 'Memeriksa...' : 'Coba'}
          </Button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {CONTOH.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => coba(c)}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {c}
            </button>
          ))}
        </div>

        {hasil &&
          (hasil.matched ? (
            <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="success">Cocok</Badge>
                <span className="font-medium">{hasil.ruleLabel}</span>
                <span className="text-xs text-muted-foreground">lewat kata kunci &ldquo;{hasil.keyword}&rdquo;</span>
              </div>
              {/* Teks balasan pakai lebar tetap dan pembungkusan apa adanya --
                  jadwal punya perataan kolom yang hilang kalau dirender proporsional. */}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-xs">
                {hasil.body}
              </pre>
            </div>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
              <Badge variant="warning">Tidak cocok</Badge>
              <p className="mt-1.5 text-muted-foreground">
                Tidak ada aturan aktif yang cocok, jadi pesan seperti ini <span className="font-medium">tidak dibalas</span>.
                Tambahkan kata kuncinya ke salah satu aturan di bawah bila seharusnya dijawab.
              </p>
            </div>
          ))}

        {!hasil && <EmptyState>Hasil uji coba muncul di sini.</EmptyState>}
      </div>
    </Card>
  );
}
