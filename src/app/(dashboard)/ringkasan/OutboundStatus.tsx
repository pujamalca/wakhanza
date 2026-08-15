import type { PantauAck } from '@/lib/ackPantau';
import { ackHealth, AMBANG_BUNTU_MENIT } from '@/core/ackHealth';
import { LinkButton, IconGauge } from '@/components/ui';

/**
 * Satu-satunya panel yang mengukur apakah pesan benar-benar SAMPAI.
 *
 * Semua angka lain di halaman ini -- termasuk kotak "Terkirim hari ini" --
 * membaca `outbox.status`, dan status `sent` cuma berarti WhatsApp menerima
 * titipannya. Kiriman ke JID grup yang sama sekali tidak ada pun berakhir
 * `sent`. Pada gangguan 15 Agustus 2026 seluruh halaman ini hijau sementara
 * tidak satu pun pesan pergi ke mana pun.
 *
 * Kembaran `InboundStatus`, dan sengaja diletakkan berdampingan dengannya:
 * yang satu menjawab "apakah kita masih bisa mendengar", yang satu "apakah kita
 * masih bisa berbicara". Sampai panel ini ada, hanya pertanyaan pertama yang
 * punya jawaban di layar.
 *
 * Ini juga satu-satunya jalur yang benar-benar menyala di mesin ini hari ini:
 * `worker/ackWatchdog.ts` mengirim peringatan lewat `alert.webhook_url`, dan
 * kunci itu masih kosong (lihat `AlertConfigWarning` beberapa baris di bawah).
 */
export function OutboundStatus({ pantau }: { pantau: PantauAck }) {
  const kesehatan = ackHealth(pantau);
  const buntu = kesehatan === 'buntu';

  // Nada peringatan yang sama dengan SystemStatus dan InboundStatus, supaya
  // ketiga panel "sistem mungkin tidak bekerja" terbaca sebagai satu bahasa.
  const nada = buntu ? 'border-warning/40 bg-warning/5' : 'border bg-card';

  return (
    <section className={`rounded-lg border p-4 shadow-sm ${nada}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconGauge className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Kabar terkirim dari WhatsApp</p>

            {kesehatan === 'tidak-terpantau' ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Sesi WhatsApp sedang tidak siap, jadi belum ada yang bisa dinilai di sini. Keadaan sesinya ada di panel
                atas.
              </p>
            ) : kesehatan === 'sepi' ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Belum ada pesan yang cukup lama terkirim untuk dinilai. Angka di sini baru berarti setelah ada lalu
                lintas keluar.
              </p>
            ) : buntu ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {pantau.jatuhTempo} pesan sudah berstatus terkirim lebih dari {AMBANG_BUNTU_MENIT} menit tapi{' '}
                <span className="text-warning">tidak satu pun mendapat kabar</span> dari WhatsApp. Itu lebih sering
                berarti pesannya tidak benar-benar pergi daripada kabarnya yang telat -- periksa langsung di ponsel
                apakah pesan terakhir muncul. Menyalakan ulang worker sering tidak menolong pada keadaan ini; yang
                menolong biasanya menautkan ulang sesi lewat pindai QR.
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {pantau.berkabar} dari {pantau.jatuhTempo} pesan terakhir sudah dikonfirmasi diterima WhatsApp.
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                Tersangkut paling lama:{' '}
                <span className={buntu ? 'text-warning' : 'text-foreground'}>
                  {pantau.tersangkutTertuaMenit === null ? 'tidak ada' : `${pantau.tersangkutTertuaMenit} menit`}
                </span>
              </span>
            </div>
          </div>
        </div>

        <LinkButton href="/koneksi" variant="secondary" size="md" className="w-full shrink-0 justify-center sm:w-auto">
          Koneksi WhatsApp
        </LinkButton>
      </div>
    </section>
  );
}
