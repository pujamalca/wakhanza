'use client';

import { useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, Badge, IconAlertTriangle, IconCheck } from '@/components/ui';
import { toggleBpjsAction, toggleBatalAction, toggleKontrolAction } from './actions';

/**
 * Kerangka sakelar besar, dipakai ketiganya.
 *
 * Sengaja satu komponen berparameter alih-alih tiga salinan: ketiganya
 * menampilkan hal yang sama persis (ikon + lencana + penjelasan + peringatan
 * setengah-jadi + tombol), dan tiga salinan yang berbeda-beda sedikit adalah
 * cara paling gampang membuat satu sakelar diam-diam berhenti menampilkan
 * peringatannya.
 */
function SakelarBesar({
  judul,
  enabled,
  penjelasan,
  peringatan,
  onToggle,
}: {
  judul: string;
  enabled: boolean;
  penjelasan: ReactNode;
  peringatan?: ReactNode;
  onToggle: (nilai: boolean) => Promise<void>;
}) {
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
              <h2 className="font-medium">{judul}</h2>
              <Badge variant={enabled ? 'success' : 'warning'}>{enabled ? 'Menyala' : 'Mati'}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{penjelasan}</p>
            {enabled && peringatan && (
              <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">{peringatan}</p>
            )}
          </div>
        </div>
        <Button
          variant={enabled ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void onToggle(!enabled))}
        >
          {pending ? 'Menyimpan...' : enabled ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>
    </section>
  );
}

/**
 * Sakelar utama halaman. Menahan KEDUA fitur sekaligus, dan itu disengaja:
 * selama ini mati, tidak ada satu pun pesan BPJS yang keluar apa pun setelan
 * di bawahnya -- jadi tujuan dan isi pesan bisa disiapkan tanpa risiko.
 */
export function MasterSwitch({ enabled, adaTujuan }: { enabled: boolean; adaTujuan: boolean }) {
  return (
    <SakelarBesar
      judul="Notifikasi BPJS"
      enabled={enabled}
      onToggle={toggleBpjsAction}
      penjelasan={
        enabled
          ? 'Kedua fitur di tab sebelah berjalan sesuai sakelarnya masing-masing.'
          : 'Tidak ada pesan BPJS yang dikirim ke mana pun, apa pun setelan di tab lain. Tujuan dan isi pesan boleh disiapkan lebih dulu.'
      }
      peringatan={
        !adaTujuan ? (
          <>
            Sakelarnya menyala tapi <span className="font-medium">belum ada satu pun tujuan</span>. Pemberitahuan
            pembatalan tidak akan sampai ke mana pun sampai ada tujuan yang ditambahkan dan dicentang di{' '}
            <Link href="/bpjs?tab=tujuan" className="font-medium underline">
              tab Tujuan pengiriman
            </Link>
            .
          </>
        ) : undefined
      }
    />
  );
}

export function BatalSwitch({ enabled, adaPenerima }: { enabled: boolean; adaPenerima: boolean }) {
  return (
    <SakelarBesar
      judul="Pemberitahuan pembatalan"
      enabled={enabled}
      onToggle={toggleBatalAction}
      penjelasan={
        enabled
          ? 'Setiap pembatalan yang tercatat di Mobile JKN dikirim ke tujuan yang mencentang “Terima pembatalan”.'
          : 'Pembatalan Mobile JKN tidak diberitahukan ke siapa pun.'
      }
      peringatan={
        !adaPenerima ? (
          <>
            Menyala, tapi <span className="font-medium">belum ada tujuan yang mencentang “Terima pembatalan”</span> —
            jadi tidak ada pesan yang benar-benar terkirim. Centang salah satu di{' '}
            <Link href="/bpjs?tab=tujuan" className="font-medium underline">
              tab Tujuan pengiriman
            </Link>
            .
          </>
        ) : undefined
      }
    />
  );
}

export function KontrolSwitch({
  enabled,
  kePasien,
  adaPenerima,
}: {
  enabled: boolean;
  kePasien: boolean;
  adaPenerima: boolean;
}) {
  return (
    <SakelarBesar
      judul="Pengingat surat kontrol"
      enabled={enabled}
      onToggle={toggleKontrolAction}
      penjelasan={
        enabled ? (
          kePasien ? (
            <>
              Pasien diingatkan sebelum tanggal kontrolnya. Ini{' '}
              <span className="font-medium text-foreground">satu-satunya pesan di halaman ini yang dibaca pasien</span>,
              jadi ia tunduk pada jam tenang dan permintaan “Berhenti Kirim Otomatis” seperti notifikasi pasien lain.
            </>
          ) : (
            <>
              Pasien <span className="font-medium text-foreground">tidak</span> diingatkan — pengingatnya hanya dikirim
              ke tujuan yang mencentang “Terima salinan kontrol”.
            </>
          )
        ) : (
          'Tidak ada pengingat kontrol yang dikirim. Jadwal dan isi pesan boleh disiapkan lebih dulu.'
        )
      }
      peringatan={
        !kePasien && !adaPenerima ? (
          <>
            Menyala, <span className="font-medium">tidak dikirim ke pasien</span>, dan belum ada tujuan yang menerima
            salinannya — pengingatnya tidak pergi ke mana pun, dan itu tidak meninggalkan satu baris pun di halaman
            Antrean.
          </>
        ) : undefined
      }
    />
  );
}
