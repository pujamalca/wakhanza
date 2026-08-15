'use client';

import { useTransition } from 'react';
import { Button, SwitchCard } from '@/components/ui';
import { toggleBulananAction } from './bulananActions';

/**
 * Sakelar REKAP BULANAN ADMINISTRASI.
 *
 * Yang paling perlu dikatakan halaman ini bukan aturannya secara abstrak
 * melainkan apa yang MEMBEDAKANNYA dari sakelar lain di halaman yang sama:
 * kesembilan kelas pemicu di tab lain mengirim BERKAS PDF ke nomor seorang
 * PASIEN, sementara yang ini mengirim satu pesan berisi ANGKA ke grup STAF. Orang
 * yang sudah menahan `administrasi.enabled` karena keberatan soal berkas pasien
 * harus tahu bahwa keberatan itu tidak berlaku di sini.
 */
export function BulananSwitch({
  enabled,
  adaTujuan,
  tanggal,
  jam,
  terakhir,
  langsungBerangkat,
}: {
  enabled: boolean;
  adaTujuan: boolean;
  tanggal: number;
  jam: string;
  /** Bulan yang terakhir benar-benar terkirim, sudah berbentuk "Juli 2026". */
  terakhir: string;
  /**
   * Bulan mana yang akan LANGSUNG berangkat begitu sakelarnya dinyalakan, atau
   * kosong bila tidak ada.
   *
   * Rekap bulanan yang terlewat memang sengaja DIKEJAR (isinya bulan yang sudah
   * tutup, jadi angkanya tidak berubah). Akibatnya, menyalakan sakelarnya pada
   * tanggal 14 -- ketika tanggal kirim 3 sudah lewat dan belum pernah ada kiriman
   * -- membuat rekapnya berangkat pada siklus berikutnya, bukan bulan depan.
   *
   * Perilakunya benar dan bahkan berguna, tapi orang yang menekan tombolnya wajar
   * mengira kiriman pertamanya masih lama. Perilaku yang benar dan tak terduga
   * tetap kejutan.
   */
  langsungBerangkat: string;
}) {
  const [pending, start] = useTransition();

  return (
    <SwitchCard
      enabled={enabled}
      judul="Rekap bulanan administrasi"
      className="mb-4"
      aksi={
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleBulananAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled ? (
          <>
            Setiap tanggal <span className="font-medium text-foreground">{tanggal}</span> pukul{' '}
            <span className="font-medium text-foreground">{jam}</span>, satu pesan berisi gambaran kunjungan{' '}
            <span className="font-medium text-foreground">bulan sebelumnya</span> dikirim ke tujuan yang mencentang
            &ldquo;Terima rekap bulanan&rdquo;.
          </>
        ) : (
          <>
            Tidak ada rekap bulanan yang dikirim. Tujuan, jadwal, dan isi pesannya boleh disiapkan lebih dulu &mdash;
            tidak ada yang keluar sampai sakelar ini dinyalakan.
          </>
        )}
      </p>

      {/* Perilaku yang benar tapi tak terduga, jadi dikatakan SEBELUM tombolnya
          ditekan alih-alih ditemukan sesudahnya. */}
      {!enabled && langsungBerangkat && (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
          Tanggal {tanggal} bulan ini <span className="font-medium">sudah lewat</span> dan belum pernah ada kiriman,
          jadi begitu dinyalakan rekap <span className="font-medium">{langsungBerangkat}</span> akan langsung berangkat
          &mdash; tidak menunggu tanggal {tanggal} bulan depan. Itu disengaja: isinya bulan yang sudah tutup, jadi
          angkanya sama saja dikirim hari ini atau tiga minggu lagi.
        </p>
      )}

      {/* Kalimat yang membedakannya dari SETIAP tab lain di halaman ini, dan
          yang paling menentukan keputusan orang: yang ini tidak mengirim berkas
          pasien ke mana pun. */}
      <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
        Sakelar ini <span className="font-medium text-foreground">berdiri sendiri</span> dari &ldquo;Pengiriman
        surat&rdquo;. Tab lain di halaman ini mengirim{' '}
        <span className="font-medium text-foreground">berkas PDF berisi nama, umur, dan alamat pasien</span> ke nomor
        pasiennya; yang ini mengirim <span className="font-medium text-foreground">satu pesan berisi angka</span> ke
        grup staf. Tidak ada nama pasien, nomor rekam medis, nama poli, maupun diagnosa di dalamnya.
      </p>

      {/* Laju sekali-sebulan diangkat ke depan justru karena ia yang membuat
          tombol uji di bawah bukan kenyamanan melainkan syarat. */}
      <p className="mt-2 text-xs text-muted-foreground">
        Berbunyi <span className="font-medium text-foreground">sekali sebulan</span>, jadi bentuk pesan yang keliru baru
        ketahuan tiga puluh hari kemudian. Pakai <span className="font-medium text-foreground">Pratinjau</span> dan{' '}
        <span className="font-medium text-foreground">Kirim rekap uji</span> di bawah sebelum menunggu jadwalnya.
        {terakhir && (
          <>
            {' '}
            Terakhir terkirim: <span className="font-medium text-foreground">{terakhir}</span>.
          </>
        )}
      </p>

      {enabled && !adaTujuan && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          Sakelarnya menyala tapi{' '}
          <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Terima rekap bulanan&rdquo;</span>, jadi
          rekapnya tidak sampai ke mana pun. Centang di daftar tujuan di bawah &mdash; centang itu{' '}
          <span className="font-medium">terpisah</span> dari &ldquo;Aktif&rdquo;.
        </p>
      )}
    </SwitchCard>
  );
}
