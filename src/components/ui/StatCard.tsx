import Link from 'next/link';
import { cardClassName } from './Card';

/**
 * Kotak angka ringkasan. Kontraknya sengaja tetap: label kalimat biasa (tanpa
 * titik dua), nilai tebal, selisih opsional yang SELALU menyebut pembandingnya,
 * dan sparkline opsional. Nilai besar memakai angka proporsional bawaan (bukan
 * `tabular-nums`) -- tabular hanya untuk kolom angka yang harus lurus ke bawah,
 * dan pada ukuran besar justru membuat angka seperti 121 terlihat renggang.
 */
export type StatTone = 'default' | 'success' | 'warning' | 'danger';

const TONE_VALUE_CLASS: Record<StatTone, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

const TONE_ICON_CLASS: Record<StatTone, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

export interface StatDelta {
  /** Selisih terhadap periode pembanding. 0 dianggap "tidak berubah" (netral, bukan baik/buruk). */
  value: number;
  /** Nama periode pembandingnya, mis. "vs kemarin". Wajib -- angka selisih tanpa pembanding tidak punya arti. */
  label: string;
  /** false untuk metrik yang naiknya justru buruk (mis. jumlah gagal). */
  goodWhenUp?: boolean;
}

export interface StatCardProps {
  label: string;
  value: number | string;
  /** Keterangan singkat di bawah nilai -- bukan pengganti label. */
  hint?: React.ReactNode;
  delta?: StatDelta;
  /** Deret nilai historis; 12 titik terakhir yang digambar. */
  trend?: number[];
  icon?: React.ReactNode;
  tone?: StatTone;
  /** Membuat seluruh kotak bisa diklik menuju halaman rinciannya. */
  href?: string;
}

function formatValue(value: number | string): string {
  if (typeof value === 'string') return value;
  return value >= 10000
    ? new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat('id-ID').format(value);
}

function DeltaText({ delta }: { delta: StatDelta }) {
  const goodWhenUp = delta.goodWhenUp ?? true;
  const isGood = delta.value === 0 ? null : delta.value > 0 === goodWhenUp;
  const cls = isGood === null ? 'text-muted-foreground' : isGood ? 'text-success' : 'text-destructive';
  const sign = delta.value > 0 ? '+' : '';
  return (
    <p className={`mt-1 text-xs ${cls}`}>
      {delta.value === 0 ? 'tetap' : `${sign}${new Intl.NumberFormat('id-ID').format(delta.value)}`}{' '}
      <span className="text-muted-foreground">{delta.label}</span>
    </p>
  );
}

/**
 * Sparkline 12 titik. Garisnya memakai warna redup (de-emphasis) dan HANYA titik
 * terakhir yang memakai warna aksen -- itu yang membuat mata langsung jatuh ke
 * periode berjalan alih-alih memandangi seluruh garis. Ukurannya tetap (tidak
 * diregangkan mengikuti lebar kotak) supaya titik ujungnya tetap bundar; SVG
 * yang dipaksa `preserveAspectRatio="none"` akan memipihkannya jadi elips.
 */
function Sparkline({ points }: { points: number[] }) {
  const data = points.slice(-12);
  if (data.length === 0) return null;

  const W = 120;
  const H = 32;
  const PAD = 6; // ruang untuk titik ujung (r=4) + cincin 2px supaya tidak terpotong
  const max = Math.max(...data, 1);
  const stepX = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0;
  const xy = data.map((v, i) => [PAD + i * stepX, H - PAD - (v / max) * (H - PAD * 2)] as const);
  const last = xy[xy.length - 1]!;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className="mt-2 shrink-0">
      {xy.length > 1 && (
        <polyline
          points={xy.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-muted-foreground/50"
        />
      )}
      {/* Cincin 2px sewarna permukaan card, bukan garis pemisah -- supaya titik
          tetap terbaca saat berimpit dengan garisnya sendiri. */}
      <circle cx={last[0]} cy={last[1]} r={4} strokeWidth={2} className="fill-chart-sent stroke-card" />
    </svg>
  );
}

export function StatCard({ label, value, hint, delta, trend, icon, tone = 'default', href }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={`mt-1 text-3xl font-semibold leading-none tracking-tight ${TONE_VALUE_CLASS[tone]}`}>
            {formatValue(value)}
          </p>
          {delta && <DeltaText delta={delta} />}
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_ICON_CLASS[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      {trend && <Sparkline points={trend} />}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`${cardClassName} block transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
      >
        {body}
      </Link>
    );
  }
  return <div className={cardClassName}>{body}</div>;
}
