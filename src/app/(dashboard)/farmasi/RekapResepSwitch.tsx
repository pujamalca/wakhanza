'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
import { toggleRekapResepAction } from './resepRekapActions';

/**
 * Sakelar REKAP HARIAN RESEP -- berdiri sendiri dari sakelar notifikasi resep
 * tepat di atasnya, dan halaman ini HARUS mengatakan itu.
 *
 * Rekap adalah ALTERNATIF dari kabar per kejadian, bukan tambahannya. Orang yang
 * membaca dua sakelar bertumpuk di satu tab wajar mengira yang bawah bertingkat
 * di bawah yang atas -- dan di sini kesimpulan itu jauh lebih mahal daripada di
 * tab Penjualan. Sakelar di atas menyalakan pesan yang memuat NAMA PASIEN, NOMOR
 * REKAM MEDIS, dan POLI ke sebuah grup WhatsApp; menyalakannya hanya demi
 * mendapatkan satu pesan berisi angka berarti mengambil keputusan privasi
 * terberat di halaman ini karena salah paham.
 *
 * Karena itu kalimatnya menyebut kombinasi yang SEDANG berlaku, bukan aturannya
 * secara abstrak -- pola yang sama dengan `RekapSwitch` milik penjualan.
 */
export function RekapResepSwitch({
  enabled,
  adaTujuan,
  notifEnabled,
  jam,
  offset,
}: {
  enabled: boolean;
  adaTujuan: boolean;
  notifEnabled: boolean;
  jam: string;
  offset: number;
}) {
  const [pending, start] = useTransition();

  const hari = offset === 0 ? 'hari itu juga' : offset === 1 ? 'kemarin' : `${offset} hari sebelumnya`;

  return (
    <SwitchCard
      enabled={enabled}
      judul="Rekap resep harian"
      className="mb-4"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleRekapResepAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Setiap hari pukul <span className="font-medium text-foreground">{jam}</span>, satu pesan berisi jumlah resep{' '}
            {hari} dikirim ke tujuan yang sama dengan notifikasi resep. Bukan per resep &mdash; satu pesan saja.
          </>
        ) : (
          <>
            Tidak ada rekap yang dikirim. Jam kirim dan isi pesannya boleh disiapkan lebih dulu &mdash; tidak ada yang
            keluar sampai sakelar ini dinyalakan.
          </>
        )}
      </p>

      {/* Yang paling gampang disalahpahami di tab ini, dan yang paling mahal
          salahnya: orang menyalakan notifikasi per-resep -- yang membawa data
          pasien ke grup -- hanya untuk bisa mendapatkan rekapnya. Kalimatnya
          karena itu menyebut kombinasi yang sedang berlaku, bukan aturannya
          secara abstrak. */}
      <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
        Sakelar ini <span className="font-medium text-foreground">berdiri sendiri</span> dari &ldquo;Notifikasi
        resep&rdquo; di atas.{' '}
        {notifEnabled ? (
          <>
            Keduanya sedang menyala, jadi grup menerima{' '}
            <span className="font-medium text-foreground">tiap resep divalidasi dan tiap obat diserahkan</span>{' '}
            <span className="font-medium text-foreground">dan</span> satu rekap. Kalau yang dibutuhkan hanya angka
            penutup hari, matikan yang di atas &mdash; rekap ini tetap jalan.
          </>
        ) : (
          <>
            Notifikasi per resep sedang mati, jadi menyalakan rekap ini memberi{' '}
            <span className="font-medium text-foreground">satu pesan sehari berisi angka saja</span> &mdash; tanpa satu
            pun nama pasien beredar di grup.
          </>
        )}
      </p>

      {enabled && !adaTujuan && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi <span className="font-medium">belum ada tujuan yang aktif</span>, jadi rekapnya tidak
          sampai ke mana pun. Aktifkan tujuan di tab Tujuan pengiriman.
        </p>
      )}
    </SwitchCard>
  );
}
