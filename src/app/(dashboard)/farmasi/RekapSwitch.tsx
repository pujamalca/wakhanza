'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
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
    <SwitchCard
      enabled={enabled}
      judul="Rekap penjualan harian"
      className="mb-4"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleRekapPenjualanAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Setiap hari pukul <span className="font-medium text-foreground">{jam}</span>, satu pesan berisi total
            penjualan {hari} dikirim ke tujuan yang sama dengan nota penjualan. Bukan per transaksi &mdash; satu pesan
            saja.
          </>
        ) : (
          <>
            Tidak ada rekap yang dikirim. Jam kirim dan isi pesannya boleh disiapkan lebih dulu &mdash; tidak ada yang
            keluar sampai sakelar ini dinyalakan.
          </>
        )}
      </p>

      {/* Yang paling gampang disalahpahami di tab ini, dan yang paling mahal
          salahnya: orang menyalakan notifikasi per-nota hanya untuk bisa
          mendapatkan rekapnya. Kalimatnya karena itu menyebut kombinasi yang
          sedang berlaku, bukan aturannya secara abstrak. */}
      <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
        Sakelar ini <span className="font-medium text-foreground">berdiri sendiri</span> dari &ldquo;Notifikasi
        penjualan&rdquo; di atas.{' '}
        {notaEnabled ? (
          <>
            Keduanya sedang menyala, jadi grup menerima <span className="font-medium text-foreground">tiap nota</span>{' '}
            (puluhan sehari) <span className="font-medium text-foreground">dan</span> satu rekap. Kalau yang dibutuhkan
            hanya angka penutup hari, matikan yang di atas &mdash; rekap ini tetap jalan.
          </>
        ) : (
          <>
            Notifikasi per nota sedang mati, jadi menyalakan rekap ini memberi{' '}
            <span className="font-medium text-foreground">satu pesan sehari</span> tanpa puluhan pesan per transaksi.
          </>
        )}
      </p>

      {enabled && !adaTujuan && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi{' '}
          <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Penjualan&rdquo;</span>, jadi rekapnya
          tidak sampai ke mana pun. Centang di tab Tujuan pengiriman.
        </p>
      )}
    </SwitchCard>
  );
}
