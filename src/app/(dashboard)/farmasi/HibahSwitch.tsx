'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
import { toggleHibahAction } from './hibahActions';

/**
 * Sakelar HIBAH, berdiri sendiri dari sakelar utama farmasi DAN dari pengadaan.
 *
 * Terpisah dari pengadaan bukan demi keseragaman: keduanya menjawab pertanyaan
 * kebijakan yang berbeda, dan RS yang sudah memutuskan satu belum tentu sudah
 * memutuskan yang lain. Nota pembelian memuat harga yang dibayar ke pemasok;
 * nota hibah memuat nilai barang pemberian.
 *
 * Yang ditampilkan saat MATI bukan sekadar "mati", melainkan lantai
 * aktivasinya: itu satu-satunya perilaku di bagian ini yang tidak bisa ditarik
 * kembali setelah tombolnya ditekan, dan mengatakannya sesudah menekan sudah
 * terlambat.
 */
export function HibahSwitch({
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
      judul="Notifikasi hibah"
      className="mb-4"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleHibahAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Setiap penerimaan yang disimpan di menu{' '}
            <span className="font-medium text-foreground">Hibah Obat &amp; BHP</span> dikirim ke tujuan yang dicentang.
            Pesannya melewati antrean yang sama seperti notifikasi lain, jadi ikut terlihat di halaman Antrean dan Log.
          </>
        ) : (
          <>
            Tidak ada nota yang dikirim. Isi pesan dan tujuannya boleh disiapkan lebih dulu — tidak ada yang keluar
            sampai sakelar ini dinyalakan.
          </>
        )}
      </p>

      {/* Konsekuensi yang tidak bisa ditarik kembali, jadi dikatakan SEBELUM
          tombolnya ditekan. Sesudah menyala ia berubah jadi keterangan
          tanggalnya, karena sejak itu pertanyaannya berbeda: bukan lagi "apa
          yang akan terjadi" melainkan "sejak kapan". */}
      {!enabled && (
        <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
          Saat dinyalakan, sistem mencatat tanggal hari ini sebagai batas bawah. Penerimaan yang bernomor{' '}
          <span className="font-medium text-foreground">sebelum</span> hari itu tidak akan pernah terkirim otomatis —
          supaya menyalakan sakelar tidak membongkar arsip hibah lama sekaligus.
        </p>
      )}
      {enabled && sejak && (
        <p className="mt-2 text-xs text-muted-foreground">
          Berlaku untuk penerimaan bernomor sejak <span className="font-medium text-foreground">{sejak}</span>. Yang
          lebih lama tidak dikirim otomatis.
        </p>
      )}

      {enabled && !adaTujuan && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Hibah&rdquo;</span>
          , jadi nota penerimaan tidak sampai ke mana pun. Centang di tab Tujuan pengiriman.
        </p>
      )}
    </SwitchCard>
  );
}
