'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
import { toggleDaruratAction } from './daruratActions';

/**
 * Sakelar DARURAT STOK, berdiri sendiri dari sakelar utama farmasi.
 *
 * Keduanya sengaja terpisah karena isinya berbeda jenis: notifikasi resep
 * memuat data PASIEN dan itu yang membuat sakelarnya berat; peringatan
 * persediaan tidak menyebut seorang pasien pun. Rumah sakit yang memutuskan
 * belum mau data pasien mengalir ke grup tetap boleh memakai peringatan
 * persediaan, dan menggabungkan keduanya akan menutup pilihan itu.
 *
 * Dua peringatan setengah-jadi ditampilkan di sini alih-alih dibiarkan diam,
 * karena keduanya bergejala sama persis: sakelar menyala, halaman tampak benar,
 * dan tidak satu pun pesan pernah keluar.
 */
export function DaruratSwitch({
  enabled,
  adaTujuan,
  adaJadwal,
}: {
  enabled: boolean;
  adaTujuan: boolean;
  adaJadwal: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <SwitchCard
      enabled={enabled}
      judul="Peringatan darurat stok"
      className="mb-4"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleDaruratAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Jadwal yang aktif di bawah dijalankan worker saat jatuh tempo. Pesannya melewati antrean yang sama seperti
            notifikasi lain, jadi ikut terlihat di halaman Antrean dan Log.
          </>
        ) : (
          <>
            Tidak ada peringatan yang dikirim otomatis. Jadwal dan isi pesan boleh disiapkan lebih dulu — tidak ada yang
            keluar sampai sakelar ini dinyalakan. Tombol &ldquo;Kirim sekarang&rdquo; tetap bekerja.
          </>
        )}
      </p>
      {enabled && !adaTujuan && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi{' '}
          <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Terima darurat stok&rdquo;</span>, jadi
          peringatan yang jatuh tempo tidak sampai ke mana pun.
        </p>
      )}
      {enabled && adaTujuan && !adaJadwal && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala dan tujuannya sudah ada, tapi{' '}
          <span className="font-medium">belum ada satu pun jadwal</span> — jadi tidak ada yang memicunya. Tambahkan
          jadwal di bawah.
        </p>
      )}
    </SwitchCard>
  );
}
