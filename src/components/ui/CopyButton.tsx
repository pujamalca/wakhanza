'use client';

import { useState } from 'react';
import { IconCheck, IconCopy } from './icons';

/**
 * Menyalin sebuah ID ke papan klip.
 *
 * Ada karena satu-satunya cara memakai id grup / id pengguna adalah
 * MENEMPELKANNYA di tempat lain, dan `120363000000000000@g.us` adalah persis
 * bentuk yang paling gampang salah saat diketik ulang -- satu digit meleset
 * menghasilkan tujuan yang diterima WhatsApp tanpa keluhan dan tidak pernah
 * sampai ke siapa pun.
 *
 * DUA jalur, dan yang kedua bukan kelebihan melainkan keharusan.
 * `navigator.clipboard.writeText` menuntut konteks aman DAN izin
 * `clipboard-write`; ia terbukti menjawab `NotAllowedError: Write permission
 * denied` pada peramban yang dikendalikan otomatis, dan tidak ada cara
 * memastikan dari sini bahwa peramban di meja petugas berperilaku lain.
 * Tombol salin yang diam-diam tidak menyalin adalah persis kegagalan yang
 * halaman ini ada untuk mencegahnya -- staf menempel ID lama yang masih ada di
 * papan klip, dan tujuannya diterima WhatsApp tanpa keluhan.
 *
 * Karena itu ada `document.execCommand('copy')` sebagai cadangan: usang, tapi
 * tidak menuntut izin apa pun dan bekerja di mana Clipboard API ditolak. Kalau
 * KEDUANYA gagal, teksnya tetap terlihat di layar untuk disalin manual --
 * kegagalannya cukup ditandai di tombol, bukan dijadikan galat halaman.
 */
async function salinKePapanKlip(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Jalur cadangan.
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    // Di luar layar, bukan display:none -- elemen yang tidak dirender tidak
    // bisa diseleksi, dan tanpa seleksi execCommand('copy') tidak menyalin apa pun.
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [keadaan, setKeadaan] = useState<'diam' | 'tersalin' | 'gagal'>('diam');

  return (
    <button
      type="button"
      title={keadaan === 'gagal' ? 'Tidak bisa menyalin — salin manual dari teks di sebelah kiri' : `Salin ${label ?? value}`}
      aria-label={`Salin ${label ?? value}`}
      className="inline-flex shrink-0 items-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={async () => {
        setKeadaan((await salinKePapanKlip(value)) ? 'tersalin' : 'gagal');
        // Kembali ke keadaan semula supaya tombol berikutnya yang ditekan tidak
        // tampak sudah tersalin padahal belum.
        setTimeout(() => setKeadaan('diam'), 1500);
      }}
    >
      {keadaan === 'tersalin' ? (
        <IconCheck className="h-3.5 w-3.5 text-success" />
      ) : (
        <IconCopy className={`h-3.5 w-3.5 ${keadaan === 'gagal' ? 'text-destructive' : ''}`} />
      )}
    </button>
  );
}
