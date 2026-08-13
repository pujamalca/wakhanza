'use client';

import { useTransition } from 'react';
import { Badge, Button, IconAlertTriangle, IconCheck } from '@/components/ui';
import { toggleRekapPenjualanAction } from './penjualanActions';

/**
 * Sakelar REKAP HARIAN -- berdiri sendiri dari sakelar notifikasi penjualan
 * tepat di atasnya, dan halaman ini HARUS mengatakan itu.
 *
 * Rekap adalah ALTERNATIF dari kabar per nota, bukan tambahannya. Orang yang
 * membaca dua sakelar bertumpuk di satu tab wajar mengira yang bawah bertingkat
 * di bawah yang atas -- dan kesimpulan itu justru membuatnya menyalakan 16-46
 * pesan sehari untuk mendapatkan satu pesan sehari yang ia inginkan. Karena itu
 * kalimatnya menyebut kombinasi yang sedang berlaku, bukan cuma keadaan
 * sakelarnya sendiri.
 */
export function RekapSwitch({
  enabled,
  adaTujuan,
  notaEnabled,
  jam,
  offset,
}: {
  enabled: boolean;
  adaTujuan: boolean;
  notaEnabled: boolean;
  jam: string;
  offset: number;
}) {
  const [pending, start] = useTransition();

  const hari = offset === 0 ? 'hari itu juga' : offset === 1 ? 'kemarin' : `${offset} hari sebelumnya`;

  return (
    <section
      className={`mb-4 rounded-lg border p-4 ${
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
              <h3 className="text-title-sm">Rekap penjualan harian</h3>
              <Badge variant={enabled ? 'success' : 'warning'}>{enabled ? 'Menyala' : 'Mati'}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? (
                <>
                  Setiap hari pukul <span className="font-medium text-foreground">{jam}</span>, satu pesan berisi total
                  penjualan {hari} dikirim ke tujuan yang sama dengan nota penjualan. Bukan per transaksi &mdash; satu
                  pesan saja.
                </>
              ) : (
                <>
                  Tidak ada rekap yang dikirim. Jam kirim dan isi pesannya boleh disiapkan lebih dulu &mdash; tidak ada
                  yang keluar sampai sakelar ini dinyalakan.
                </>
              )}
            </p>

            {/* Yang paling gampang disalahpahami di tab ini, dan yang paling
                mahal salahnya: orang menyalakan notifikasi per-nota hanya untuk
                bisa mendapatkan rekapnya. Kalimatnya karena itu menyebut
                kombinasi yang sedang berlaku, bukan aturannya secara abstrak. */}
            <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
              Sakelar ini <span className="font-medium text-foreground">berdiri sendiri</span> dari
              &ldquo;Notifikasi penjualan&rdquo; di atas.{' '}
              {notaEnabled ? (
                <>
                  Keduanya sedang menyala, jadi grup menerima{' '}
                  <span className="font-medium text-foreground">tiap nota</span> (puluhan sehari){' '}
                  <span className="font-medium text-foreground">dan</span> satu rekap. Kalau yang dibutuhkan hanya angka
                  penutup hari, matikan yang di atas &mdash; rekap ini tetap jalan.
                </>
              ) : (
                <>
                  Notifikasi per nota sedang mati, jadi menyalakan rekap ini memberi{' '}
                  <span className="font-medium text-foreground">satu pesan sehari</span> tanpa puluhan pesan per
                  transaksi.
                </>
              )}
            </p>

            {enabled && !adaTujuan && (
              <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                Sakelarnya menyala tapi{' '}
                <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Penjualan&rdquo;</span>, jadi
                rekapnya tidak sampai ke mana pun. Centang di tab Tujuan pengiriman.
              </p>
            )}
          </div>
        </div>
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleRekapPenjualanAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>
    </section>
  );
}
