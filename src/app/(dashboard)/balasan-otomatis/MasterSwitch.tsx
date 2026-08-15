'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
import { toggleAutoReplyAction } from './actions';

/**
 * Sakelar utama, dan sengaja dibuat sebesar ini di puncak halaman.
 *
 * Selama mati, SELURUH halaman di bawahnya cuma persiapan: aturan boleh
 * disimpan dan diuji, tapi tidak satu pun pesan pasien dibalas. Menyembunyikan
 * keadaan itu di sudut layar akan membuat staf menyusun sepuluh aturan lalu
 * bertanya-tanya kenapa tidak ada yang terjadi -- atau lebih buruk, mengira
 * sistemnya sudah menjawab pasien padahal belum.
 */
export function MasterSwitch({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition();

  return (
    <SwitchCard
      enabled={enabled}
      judul="Balasan otomatis"
      tingkat="utama"
      className="mb-6"
      aksi={
        canEdit && (
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            className="w-full shrink-0 justify-center sm:w-auto"
            disabled={pending}
            onClick={() => start(() => void toggleAutoReplyAction(!enabled))}
          >
            {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
          </Button>
        )
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Pesan masuk dari pasien dicocokkan dengan aturan di bawah dan dibalas otomatis. Balasan tetap melewati
            antrean pengiriman yang sama seperti notifikasi lain, jadi terlihat di halaman Antrean dan Log.
          </>
        ) : (
          <>
            Pesan masuk dari pasien <span className="font-medium">tidak dibalas sama sekali</span>. Aturan di bawah
            boleh disusun dan diuji lebih dulu — tidak ada yang terkirim sampai sakelar ini dinyalakan.
          </>
        )}
      </p>
    </SwitchCard>
  );
}
