'use client';

import { useTransition } from 'react';
import { Button, Badge, IconAlertTriangle, IconCheck } from '@/components/ui';
import { togglePemesananAction } from './pemesananActions';

/**
 * Sakelar SURAT PEMESANAN, berdiri sendiri dari sakelar utama farmasi, dari
 * pengadaan, DAN dari hibah.
 *
 * Terpisah dari pengadaan walau keduanya dua ujung dari alur yang sama: RS
 * sangat wajar hanya ingin diberitahu saat barang DATANG, atau sebaliknya hanya
 * saat barang DIPESAN. Satu sakelar untuk keduanya memaksa memilih dua-duanya
 * atau tidak sama sekali.
 *
 * Yang ditampilkan saat MATI bukan sekadar "mati", melainkan lantai aktivasinya:
 * itu satu-satunya perilaku di bagian ini yang tidak bisa ditarik kembali setelah
 * tombolnya ditekan, dan mengatakannya sesudah menekan sudah terlambat.
 */
export function PemesananSwitch({
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
              <h3 className="text-title-sm">Notifikasi surat pemesanan</h3>
              <Badge variant={enabled ? 'success' : 'warning'}>{enabled ? 'Menyala' : 'Mati'}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? (
                <>
                  Setiap pesanan yang disimpan di menu{' '}
                  <span className="font-medium text-foreground">Surat Pemesanan Obat &amp; BHP</span> dikirim ke tujuan
                  yang dicentang. Pesannya melewati antrean yang sama seperti notifikasi lain, jadi ikut terlihat di
                  halaman Antrean dan Log.
                </>
              ) : (
                <>
                  Tidak ada nota yang dikirim. Isi pesan dan tujuannya boleh disiapkan lebih dulu — tidak ada yang
                  keluar sampai sakelar ini dinyalakan.
                </>
              )}
            </p>

            {/* Konsekuensi yang tidak bisa ditarik kembali, jadi dikatakan
                SEBELUM tombolnya ditekan. Sesudah menyala ia berubah jadi
                keterangan tanggalnya, karena sejak itu pertanyaannya berbeda:
                bukan lagi "apa yang akan terjadi" melainkan "sejak kapan". */}
            {!enabled && (
              <p className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs text-muted-foreground">
                Saat dinyalakan, sistem mencatat tanggal hari ini sebagai batas bawah. Pesanan yang bernomor{' '}
                <span className="font-medium text-foreground">sebelum</span> hari itu tidak akan pernah terkirim
                otomatis — supaya menyalakan sakelar tidak membongkar arsip pesanan lama sekaligus.
              </p>
            )}
            {enabled && sejak && (
              <p className="mt-2 text-xs text-muted-foreground">
                Berlaku untuk pesanan bernomor sejak <span className="font-medium text-foreground">{sejak}</span>. Yang
                lebih lama tidak dikirim otomatis.
              </p>
            )}

            {enabled && !adaTujuan && (
              <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                Sakelarnya menyala tapi{' '}
                <span className="font-medium">belum ada tujuan yang mencentang &ldquo;Pemesanan&rdquo;</span>, jadi
                nota pesanan tidak sampai ke mana pun. Centang di tab Tujuan pengiriman.
              </p>
            )}
          </div>
        </div>
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void togglePemesananAction(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>
    </section>
  );
}
