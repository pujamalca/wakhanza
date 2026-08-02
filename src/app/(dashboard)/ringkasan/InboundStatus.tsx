import type { InboundActivity } from './queries';
import { inboundHealth, AMBANG_SUNYI_MENIT } from '@/core/inboundHealth';
import { LinkButton, IconReply } from '@/components/ui';

/**
 * Satu-satunya panel di halaman ini yang mengukur arah MASUK.
 *
 * Semua angka lain -- terkirim, menunggu, perlu ditinjau, grafik volume --
 * mengukur apa yang kita KIRIM. Saat WhatsApp memindahkan pengalamatan ke
 * `@lid` dan setiap pesan pasien dibuang di baris kedua listener, seluruh
 * halaman ini tetap hijau selama berjam-jam. Nol pesan masuk seharian di nomor
 * RS yang aktif adalah tanda rusak, bukan hari sepi -- tapi hanya kalau ada
 * yang menampilkannya.
 *
 * Sengaja TIDAK berupa StatCard seperti empat kotak di atasnya: angka telanjang
 * "0" di deretan kotak justru terbaca sebagai kabar baik (nol gagal, nol perlu
 * ditinjau). Di sini nol adalah kabar buruk, jadi ia perlu kalimat.
 */

function formatSelang(menit: number): string {
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

export function InboundStatus({ inbound, autoReplyEnabled }: { inbound: InboundActivity; autoReplyEnabled: boolean }) {
  const { last24h, unmatched24h, minutesSinceLast } = inbound;

  // Penilaiannya di core/, bukan di sini: keadaan "belum pernah menerima apa
  // pun" tidak bisa dibuat lewat database (auto_reply_log sengaja tanpa grant
  // UPDATE), jadi satu-satunya cara membuktikannya adalah unit test.
  const kesehatan = inboundHealth({ last24h, minutesSinceLast, autoReplyEnabled });
  const sunyi = kesehatan === 'sunyi';
  const bisaDinilai = kesehatan !== 'tidak-terpantau';

  // Sunyi memakai nada peringatan yang sama dengan SystemStatus, supaya kedua
  // panel "sistem mungkin tidak bekerja" terbaca sebagai satu bahasa.
  const nada = sunyi ? 'border-warning/40 bg-warning/5' : 'border bg-card';

  return (
    <section className={`rounded-lg border p-4 shadow-sm ${nada}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconReply className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Pesan masuk dari pasien</p>

            {!bisaDinilai ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Balasan otomatis sedang mati, jadi pesan masuk tidak dicatat. Angka di sini baru berarti setelah
                fiturnya dinyalakan.
              </p>
            ) : sunyi ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Tidak ada satu pun pesan masuk dalam {AMBANG_SUNYI_MENIT / 60} jam terakhir. Di nomor yang dipakai pasien,
                itu lebih sering berarti pesan masuk tidak sampai ke sistem daripada benar-benar tidak ada yang
                mengirim -- kirim satu pesan dari ponsel lain untuk memastikan.
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {last24h} pesan masuk dalam 24 jam terakhir
                {unmatched24h > 0 && `, ${unmatched24h} di antaranya tidak cocok aturan mana pun`}.
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                Terakhir diterima:{' '}
                <span className={sunyi && bisaDinilai ? 'text-warning' : 'text-foreground'}>
                  {minutesSinceLast === null ? 'belum pernah' : formatSelang(minutesSinceLast)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <LinkButton href="/balasan-otomatis" variant="secondary" size="md" className="w-full shrink-0 justify-center sm:w-auto">
          Balasan otomatis
        </LinkButton>
      </div>
    </section>
  );
}
