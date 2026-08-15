'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
import { togglePenjualanAction } from './penjualanActions';

/**
 * Sakelar PENJUALAN, berdiri sendiri dari sakelar utama farmasi.
 *
 * Yang ditampilkan saat MATI bukan sekadar "mati", melainkan lantai aktivasinya
 * dan LAJUNYA. Yang kedua khas fitur ini: 16-46 nota per hari, berbanding 2,21
 * faktur pengadaan per hari -- angka yang mengubah keputusannya sama sekali, dan
 * yang tidak bisa ditebak dari nama fiturnya.
 */
export function PenjualanSwitch({
  enabled,
  adaTujuan,
  sejak,
}: {
  enabled: boolean;
  adaTujuan: boolean;
  sejak: string;
}) {
  const [pending, start] = useTransition();

  return (
    <SwitchCard
      enabled={enabled}
      judul="Notifikasi penjualan"
      className="mb-4"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void togglePenjualanAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Setiap nota yang disimpan di menu{' '}
            <span className="font-medium text-foreground">Transaksi Penjualan Obat, Alkes &amp; BHP</span> dikirim ke
            tujuan yang dicentang, dan setiap nota yang dihapus dikabarkan sebagai pembatalan. Pesannya melewati
            antrean yang sama seperti notifikasi lain, jadi ikut terlihat di halaman Antrean dan Log.
          </>
        ) : (
          <>
            Tidak ada nota yang dikirim. Isi pesan dan tujuannya boleh disiapkan lebih dulu — tidak ada yang keluar
            sampai sakelar ini dinyalakan.
          </>
        )}
      </p>

      {/* LAJU. Ditaruh di sakelarnya, bukan cuma di prosa tab, karena inilah
          satu angka yang paling mungkin mengubah keputusan orang yang jarinya
          sudah di atas tombol -- dan satu-satunya hal di halaman ini yang tidak
          bisa ditebak dari nama fiturnya. */}
      <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
        Apotek ini menerbitkan <span className="font-medium text-foreground">16&ndash;46 nota per hari</span> (diukur
        pada 60 hari terakhir). Menyalakan ini berarti grup tujuan menerima{' '}
        <span className="font-medium text-foreground">puluhan pesan sehari</span> — jauh lebih ramai daripada nota
        pengadaan, yang rata-rata 2 per hari. Pertimbangkan grup mana yang menerimanya.
      </p>

      {/* Konsekuensi yang tidak bisa ditarik kembali, jadi dikatakan SEBELUM
          tombolnya ditekan. Di fitur ini lantainya menahan DUA hal, dan yang
          kedua tidak dipunyai pemicu farmasi lain. */}
      {!enabled && (
        <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
          Saat dinyalakan, sistem mencatat tanggal hari ini sebagai batas bawah. Nota bernomor{' '}
          <span className="font-medium text-foreground">sebelum</span> hari itu tidak akan pernah terkirim otomatis —
          dan <span className="font-medium text-foreground">penghapusannya juga tidak dikabarkan</span>, karena nota
          yang tidak pernah diberitakan tidak bisa dilaporkan dibatalkan.
        </p>
      )}
      {enabled && sejak && (
        <p className="mt-2 text-xs text-muted-foreground">
          Berlaku untuk nota bernomor sejak <span className="font-medium text-foreground">{sejak}</span>. Yang lebih
          lama tidak dikirim otomatis, dan penghapusannya tidak dikabarkan.
        </p>
      )}

      {enabled && !adaTujuan && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi{' '}
          <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Penjualan&rdquo;</span>, jadi nota
          penjualan tidak sampai ke mana pun. Centang di tab Tujuan pengiriman.
        </p>
      )}
    </SwitchCard>
  );
}
