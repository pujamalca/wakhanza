import type { DayVolume } from './queries';
import { cardClassName, EmptyState, IconActivity, tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';

/**
 * Grafik batang bertumpuk, dibangun dari elemen HTML biasa dan bukan SVG --
 * dengan begitu ia tetap Server Component tanpa satu baris pun JavaScript
 * klien, sementara tooltip per batang cukup ditangani `group-hover` CSS.
 *
 * Beberapa ketentuan bentuk yang mudah rusak tanpa sadar bila dikutak-katik:
 * - Batang dibatasi 24px dan tidak pernah memenuhi lebar slotnya; sisa ruangnya
 *   disengaja.
 * - Ujung data membulat 4px, PANGKALNYA tetap siku di garis dasar.
 * - Pemisah antar segmen adalah CELAH 2px sewarna permukaan (`gap-[2px]`),
 *   bukan garis tepi. Menambahkan `border` pada segmen akan menambah tinta yang
 *   bukan data.
 * - Warna batang HANYA di batang. Angka, label, dan legenda memakai token teks;
 *   teks berwarna seri tidak pernah lolos kontras pada permukaan terang.
 */
const PLOT_HEIGHT = 200;

/** Batas atas sumbu Y dibulatkan ke angka yang enak dibaca (1/2/2,5/5 × 10^n). */
function niceCeil(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

const nf = new Intl.NumberFormat('id-ID');
const dayLabel = (d: Date) => d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

function LegendKey({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${className}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function Column({ day, top, edge }: { day: DayVolume; top: number; edge: 'start' | 'end' | null }) {
  const total = day.sent + day.failed;
  // Sejajarkan tooltip ke tepi pada kolom pertama/terakhir -- kalau selalu
  // dipusatkan, dua kolom di ujung akan mendorong tooltipnya keluar kartu.
  const align = edge === 'start' ? 'left-0' : edge === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2';

  return (
    <div className="group relative flex h-full flex-1 flex-col justify-end">
      <div
        className={`pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max rounded-lg border bg-card px-3 py-2 text-xs shadow-lg group-hover:block ${align}`}
      >
        <p className="font-medium">{dayLabel(day.date)}</p>
        <p className="mt-1.5 flex items-center gap-2">
          <LegendKey className="bg-chart-sent">Terkirim</LegendKey>
          <span className="ml-auto pl-3 font-medium tabular-nums">{nf.format(day.sent)}</span>
        </p>
        <p className="mt-1 flex items-center gap-2">
          <LegendKey className="bg-chart-failed">Gagal</LegendKey>
          <span className="ml-auto pl-3 font-medium tabular-nums">{nf.format(day.failed)}</span>
        </p>
      </div>

      <div className="mx-auto flex h-full w-full max-w-[24px] flex-col justify-end gap-[2px]">
        {day.failed > 0 && (
          <div className="shrink-0 rounded-t-[4px] bg-chart-failed" style={{ height: `${(day.failed / top) * 100}%` }} />
        )}
        {day.sent > 0 && (
          <div
            className={`shrink-0 bg-chart-sent ${day.failed > 0 ? '' : 'rounded-t-[4px]'}`}
            style={{ height: `${(day.sent / top) * 100}%` }}
          />
        )}
        {/* Hari nol tetap menyisakan jejak tipis di garis dasar: hari mati harus
            terlihat sebagai batang kosong, bukan menghilang tanpa bekas. */}
        {total === 0 && <div className="h-[3px] shrink-0 rounded-full bg-border" />}
      </div>
    </div>
  );
}

export function VolumeChart({ days }: { days: DayVolume[] }) {
  const grandTotal = days.reduce((sum, d) => sum + d.sent + d.failed, 0);
  const top = niceCeil(Math.max(...days.map((d) => d.sent + d.failed), 1));
  const todayKey = days[days.length - 1]?.key;

  return (
    <figure className={cardClassName}>
      <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-title">Aktivitas kirim {days.length} hari terakhir</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Hanya pesan yang benar-benar dicoba kirim. Yang dilewati karena tanpa nomor atau menolak tidak ikut dihitung.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <LegendKey className="bg-chart-sent">Terkirim</LegendKey>
          <LegendKey className="bg-chart-failed">Gagal</LegendKey>
        </div>
      </figcaption>

      {grandTotal === 0 ? (
        <EmptyState icon={<IconActivity className="h-5 w-5" />} title="Belum ada pesan pada rentang ini">
          Begitu worker mendeteksi kejadian pertama di Khanza, batang hariannya muncul di sini.
        </EmptyState>
      ) : (
        <>
          <div className="flex gap-2">
            <div
              className="flex shrink-0 flex-col justify-between text-right text-[11px] leading-none tabular-nums text-muted-foreground"
              style={{ height: PLOT_HEIGHT }}
              aria-hidden="true"
            >
              <span className="-translate-y-1/2">{nf.format(top)}</span>
              <span>{nf.format(top / 2)}</span>
              <span className="translate-y-1/2">0</span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="relative" style={{ height: PLOT_HEIGHT }}>
                {/* Garis bantu: 1px solid, sewarna satu langkah dari permukaan.
                    Tidak putus-putus -- garis putus menarik perhatian ke chrome. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-0 top-0 border-t" />
                  <div className="absolute inset-x-0 top-1/2 border-t" />
                  <div className="absolute inset-x-0 bottom-0 border-t" />
                </div>
                <div className="relative flex h-full items-stretch gap-1">
                  {days.map((day, i) => (
                    <Column
                      key={day.key}
                      day={day}
                      top={top}
                      edge={i === 0 ? 'start' : i === days.length - 1 ? 'end' : null}
                    />
                  ))}
                </div>
              </div>

              {/* Baris label di LUAR area plot, dengan flex+gap yang sama persis
                  supaya tiap tanggal tetap lurus di bawah kolomnya. Menaruhnya
                  di dalam kolom akan memakan tinggi plot dan menggeser batang. */}
              <div className="mt-1.5 flex gap-1">
                {days.map((day) => (
                  <span
                    key={day.key}
                    className={`flex-1 text-center text-[10px] tabular-nums ${
                      day.key === todayKey ? 'font-semibold text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {day.date.getDate()}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-right text-[10px] text-muted-foreground">Angka = tanggal · paling kanan hari ini</p>
            </div>
          </div>

          {/* Tampilan tabel: jalur baca yang tidak bergantung pada warna maupun
              hover -- satu-satunya cara pembaca pengguna keyboard/pembaca layar
              mendapatkan angka yang sama. */}
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Lihat sebagai tabel
            </summary>
            <div className={`${tableWrapperClass} mt-3`}>
              <table className="w-full text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className={cellClass}>Tanggal</th>
                    <th className={`${cellClass} text-right`}>Terkirim</th>
                    <th className={`${cellClass} text-right`}>Gagal</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.key} className={rowClass}>
                      <td className={cellClass}>{dayLabel(day.date)}</td>
                      <td className={`${cellClass} text-right tabular-nums`}>{nf.format(day.sent)}</td>
                      <td className={`${cellClass} text-right tabular-nums`}>{nf.format(day.failed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </figure>
  );
}
