'use client';

import { useTransition } from 'react';
import { Button, Badge, IconAlertTriangle, IconCheck } from '@/components/ui';
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
    <section
      className={`mb-6 rounded-lg border p-4 ${
        enabled ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={enabled ? 'text-success' : 'text-warning'}>
            {enabled ? <IconCheck className="h-5 w-5" /> : <IconAlertTriangle className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">Balasan otomatis</h2>
              <Badge variant={enabled ? 'success' : 'warning'}>{enabled ? 'Menyala' : 'Mati'}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? (
                <>
                  Pesan masuk dari pasien dicocokkan dengan aturan di bawah dan dibalas otomatis. Balasan tetap melewati antrean
                  pengiriman yang sama seperti notifikasi lain, jadi terlihat di halaman Antrean dan Log.
                </>
              ) : (
                <>
                  Pesan masuk dari pasien <span className="font-medium">tidak dibalas sama sekali</span>. Aturan di bawah boleh
                  disusun dan diuji lebih dulu — tidak ada yang terkirim sampai sakelar ini dinyalakan.
                </>
              )}
            </p>
          </div>
        </div>
        {canEdit && (
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            className="w-full shrink-0 justify-center sm:w-auto"
            disabled={pending}
            onClick={() => start(() => void toggleAutoReplyAction(!enabled))}
          >
            {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
          </Button>
        )}
      </div>
    </section>
  );
}
