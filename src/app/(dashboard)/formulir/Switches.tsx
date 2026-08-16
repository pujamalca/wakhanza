'use client';

import { useState, useTransition } from 'react';
import { Button, SwitchCard, Callout } from '@/components/ui';
import { toggleFormulirAction } from './actions';

/**
 * Sakelar utama fitur formulir.
 *
 * Isinya SENGAJA tidak dilipat lebih jauh dan tidak dipindahkan ke laci bantuan:
 * ia golongan A (pagar) menurut aturan empat tingkat di DESIGN_SYSTEM.md -- yang
 * dibaca sebelum tindakan yang membuka sesuatu, bukan orientasi yang dibaca
 * sekali. Menyalakannya membuat SETIAP nomor yang mengirim WhatsApp ke rumah
 * sakit bisa menyimpan baris ke database ini, dan itu satu-satunya arah masuk
 * yang begitu.
 */
export function MasterSwitch({ enabled, jumlahAktif }: { enabled: boolean; jumlahAktif: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <SwitchCard
      enabled={enabled}
      tingkat="utama"
      judul="Formulir lewat WhatsApp"
      className="mb-6"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          size="md"
          disabled={pending}
          className="shrink-0"
          onClick={() =>
            start(async () => {
              const hasil = await toggleFormulirAction(!enabled);
              setError(hasil.error ?? null);
            })
          }
        >
          {pending ? 'Menyimpan…' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <div className="space-y-3 text-prose text-muted-foreground">
        <p>
          Pasien mengetik kata kunci yang Anda tentukan, lalu dituntun pertanyaan demi pertanyaan sampai jawabannya
          tersimpan di tab <strong>Masuk</strong>. Kata kunci dan daftar pertanyaannya sepenuhnya Anda yang menentukan.
        </p>

        <Callout variant="privasi" title="Ini satu-satunya arah masuk yang menyimpan tulisan pasien">
          <p>
            Empat jalur pesan masuk lain hanya membaca, atau menulis catatan tentang satu nomor. Yang ini menyimpan
            kalimat yang <strong>diketik pasien</strong>, dan tidak seperti perintah lewat WhatsApp, ia terbuka untuk
            setiap nomor — daftar putih tidak bisa dipasang tanpa membatalkan gunanya.
          </p>
          <p className="mt-2">
            Yang menggantikannya tiga hal: sakelar ini, kuota per nomor per hari, dan masa simpan yang terbatas
            (keduanya di Pengaturan). Isinya bisa memuat keluhan, dan tabel ini <strong>bukan rekam medis</strong> serta
            ikut tercadangkan — pertimbangkan itu saat menyusun pertanyaannya.
          </p>
        </Callout>

        {enabled && jumlahAktif === 0 && (
          <Callout variant="warning" title="Menyala, tapi belum ada formulir yang aktif">
            Tidak ada kata kunci yang menjaring apa pun, jadi tidak ada pesan pasien yang akan dijawab. Aktifkan
            setidaknya satu formulir di bawah.
          </Callout>
        )}

        {error && <p className="text-destructive">{error}</p>}
      </div>
    </SwitchCard>
  );
}
