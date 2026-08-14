'use client';

import { useTransition } from 'react';
import { Badge, Button, IconAlertTriangle, IconCheck } from '@/components/ui';
import { toggleBulananAction } from './bulananActions';

/**
 * Sakelar REKAP BULANAN FARMASI.
 *
 * Berdiri sendiri dari SELURUH sakelar lain di halaman ini -- termasuk
 * "Notifikasi resep" yang membawa data pasien ke grup. Yang perlu dikatakan
 * halaman ini bukan aturannya secara abstrak melainkan apa yang dibawanya:
 * rekapnya seluruhnya ANGKA, jadi ia bisa dinyalakan tanpa satu pun keputusan
 * privasi yang tertunda di tab lain.
 *
 * Satu hal yang diangkat ke depan dan tidak dipunyai sakelar lain: LAJU-nya.
 * Sekali sebulan berarti kesalahan bentuk pesan baru ketahuan tiga puluh hari
 * kemudian, dan itulah alasan tombol "Kirim rekap uji" ada di bawah.
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
   * Ditemukan saat verifikasi, bukan dari perancangan: rekap bulanan yang
   * terlewat memang sengaja DIKEJAR (isinya bulan yang sudah tutup, jadi angkanya
   * tidak berubah). Akibatnya, menyalakan sakelarnya pada tanggal 14 -- ketika
   * tanggal kirim 3 sudah lewat dan belum pernah ada kiriman -- membuat rekapnya
   * berangkat pada siklus berikutnya, bukan bulan depan.
   *
   * Perilakunya benar dan bahkan berguna (staf langsung melihat hasilnya alih-alih
   * menunggu tiga minggu), tapi orang yang menekan tombolnya wajar mengira
   * kiriman pertamanya masih lama. Perilaku yang benar dan tak terduga tetap
   * kejutan.
   */
  langsungBerangkat: string;
}) {
  const [pending, start] = useTransition();

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
              <h3 className="text-title-sm">Rekap bulanan farmasi</h3>
              <Badge variant={enabled ? 'success' : 'warning'}>{enabled ? 'Menyala' : 'Mati'}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? (
                <>
                  Setiap tanggal <span className="font-medium text-foreground">{tanggal}</span> pukul{' '}
                  <span className="font-medium text-foreground">{jam}</span>, satu pesan berisi seluruh kegiatan farmasi{' '}
                  <span className="font-medium text-foreground">bulan sebelumnya</span> dikirim ke tujuan yang mencentang
                  &ldquo;Terima rekap bulanan&rdquo;.
                </>
              ) : (
                <>
                  Tidak ada rekap bulanan yang dikirim. Jadwal dan isi pesannya boleh disiapkan lebih dulu &mdash; tidak
                  ada yang keluar sampai sakelar ini dinyalakan.
                </>
              )}
            </p>

            {/* Perilaku yang benar tapi tak terduga, jadi dikatakan SEBELUM
                tombolnya ditekan alih-alih ditemukan sesudahnya. */}
            {!enabled && langsungBerangkat && (
              <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
                Tanggal {tanggal} bulan ini <span className="font-medium">sudah lewat</span> dan belum pernah ada
                kiriman, jadi begitu dinyalakan rekap{' '}
                <span className="font-medium">{langsungBerangkat}</span> akan langsung berangkat &mdash; tidak menunggu
                tanggal {tanggal} bulan depan. Itu disengaja: isinya bulan yang sudah tutup, jadi angkanya sama saja
                dikirim hari ini atau tiga minggu lagi.
              </p>
            )}

            {/* Kalimat yang membedakannya dari SETIAP sakelar lain di halaman
                ini, dan yang paling menentukan keputusan orang: isinya angka,
                jadi tidak ada keputusan privasi yang harus diambil lebih dulu. */}
            <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
              Sakelar ini <span className="font-medium text-foreground">berdiri sendiri</span> dari seluruh sakelar lain
              di halaman ini. Isinya{' '}
              <span className="font-medium text-foreground">seluruhnya angka</span> &mdash; tidak ada nama pasien, nomor
              rekam medis, nama obat, maupun nama pemasok &mdash; jadi ia bisa dinyalakan tanpa lebih dulu menyalakan
              &ldquo;Notifikasi resep&rdquo;.
            </p>

            {/* Laju sekali-sebulan diangkat ke depan justru karena ia yang
                membuat tombol uji di bawah bukan kenyamanan melainkan syarat. */}
            <p className="mt-2 text-xs text-muted-foreground">
              Berbunyi <span className="font-medium text-foreground">sekali sebulan</span>, jadi bentuk pesan yang keliru
              baru ketahuan tiga puluh hari kemudian. Pakai <span className="font-medium text-foreground">Pratinjau</span>{' '}
              dan <span className="font-medium text-foreground">Kirim rekap uji</span> di bawah sebelum menunggu jadwalnya.
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
                <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Terima rekap bulanan&rdquo;</span>,
                jadi rekapnya tidak sampai ke mana pun. Centang di tab Tujuan pengiriman &mdash; centang itu{' '}
                <span className="font-medium">terpisah</span> dari &ldquo;Aktif&rdquo;.
              </p>
            )}
          </div>
        </div>
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleBulananAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>
    </section>
  );
}
