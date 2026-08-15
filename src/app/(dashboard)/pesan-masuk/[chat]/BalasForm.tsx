'use client';

import { useState, useTransition } from 'react';
import { Button, MessageEditor } from '@/components/ui';
import { kirimBalasanAction } from '../actions';
import { MAX_PANJANG_BALASAN } from '@/core/percakapan';

/**
 * Kotak balasan, ditempel di kaki percakapan seperti aplikasi chat mana pun.
 *
 * Memakai `MessageEditor` yang SAMA dipakai `/template`, `/broadcast`, dan
 * `/balasan-otomatis` -- bukan `<textarea>` telanjang. Yang dibeli bukan
 * keseragaman melainkan penanda format WhatsApp: `*tebal*` dan `_miring_` tidak
 * akan pernah benar kalau tiap tempat menyusun pesan punya kotaknya sendiri,
 * dan yang paling mungkin menyimpang adalah kotak yang paling baru.
 *
 * `showPreview={false}` karena di sini pratinjaunya adalah gelembung percakapan
 * di atasnya: balasan yang terkirim muncul di sana beberapa detik kemudian,
 * dalam bentuk yang benar-benar diterima penerimanya. Pratinjau kedua di bawah
 * kotak cuma menggandakan hal yang sama sambil mendorong kotaknya turun.
 */
export function BalasForm({ chatId, keGrup, bisaDibalas }: { chatId: string; keGrup: boolean; bisaDibalas: boolean }) {
  const [teks, setTeks] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const kosong = teks.trim().length === 0;
  const kepanjangan = teks.trim().length > MAX_PANJANG_BALASAN;

  function kirim() {
    setGalat(null);
    start(async () => {
      const hasil = await kirimBalasanAction(chatId, teks);
      if (hasil.error) {
        setGalat(hasil.error);
        return;
      }
      // Dikosongkan HANYA setelah server memastikan barisnya masuk antrean.
      // Dikosongkan lebih dulu, kegagalan apa pun menghapus kalimat yang baru
      // saja diketik petugas -- dan tidak ada satu pun tempat untuk mengambilnya
      // kembali.
      setTeks('');
    });
  }

  if (!bisaDibalas) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
        Percakapan ini tidak bisa dibalas dari sini: nomor pengirimnya tidak bisa dipetakan (pengalamatan{' '}
        <strong>@lid</strong>). Balas lewat aplikasi WhatsApp di ponsel rumah sakit.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <MessageEditor
        name="balasan"
        value={teks}
        onValueChange={setTeks}
        rows={3}
        disabled={pending}
        showPreview={false}
        placeholder={keGrup ? 'Balasan ini terbaca seluruh anggota grup…' : 'Tulis balasan…'}
      />

      {galat && <p className="mt-2 text-sm text-destructive">{galat}</p>}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {kepanjangan ? (
            <span className="text-destructive">
              {teks.trim().length.toLocaleString('id-ID')} karakter — batas {MAX_PANJANG_BALASAN.toLocaleString('id-ID')}.
            </span>
          ) : (
            <>Masuk antrean kirim seperti pesan lain, jadi tidak langsung terkirim detik itu juga.</>
          )}
        </p>
        <Button variant="primary" disabled={pending || kosong || kepanjangan} onClick={kirim}>
          {pending ? 'Mengirim…' : 'Kirim balasan'}
        </Button>
      </div>
    </div>
  );
}
