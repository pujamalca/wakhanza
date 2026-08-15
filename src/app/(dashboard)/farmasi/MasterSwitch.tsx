'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { Button, SwitchCard } from '@/components/ui';
import { toggleFarmasiAction } from './actions';

/**
 * Sakelar utama, sengaja sebesar ini di puncak halaman -- pola yang sama dengan
 * /balasan-otomatis, dan karena alasan yang sedikit berbeda.
 *
 * Di sana yang disembunyikan adalah "belum ada yang dibalas". Di sini yang
 * disembunyikan lebih berat: begitu menyala, nama pasien dan poli yang
 * didatanginya mulai mengalir ke sebuah GRUP WhatsApp yang isinya ditentukan
 * siapa pun yang mengelola grup itu -- di luar sistem ini. Keadaan itu tidak
 * boleh cuma terbaca dari sudut layar.
 */
export function MasterSwitch({ enabled, adaTargetAktif }: { enabled: boolean; adaTargetAktif: boolean }) {
  const [pending, start] = useTransition();

  return (
    <SwitchCard
      enabled={enabled}
      judul="Notifikasi farmasi"
      tingkat="utama"
      className="mb-6"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleFarmasiAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Setiap resep yang divalidasi dan diserahkan dikirim ke tujuan di bawah. Pesannya melewati antrean yang sama
            seperti notifikasi pasien, jadi ikut terlihat di halaman Antrean dan Log.
          </>
        ) : (
          <>
            Tidak ada notifikasi apotek yang dikirim ke mana pun. Tujuan dan isi pesan boleh disiapkan lebih dulu —
            tidak ada yang keluar sampai sakelar ini dinyalakan.
          </>
        )}
      </p>
      {enabled && !adaTargetAktif && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi <span className="font-medium">belum ada tujuan yang aktif</span>, jadi tidak ada pesan
          yang benar-benar terkirim. Tambahkan satu di{' '}
          <Link href="/farmasi?tab=tujuan" className="font-medium underline">
            tab Tujuan pengiriman
          </Link>
          .
        </p>
      )}
    </SwitchCard>
  );
}
