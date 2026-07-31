export type RepeatKind = 'once' | 'daily' | 'weekly' | 'monthly';

export interface ScheduleTiming {
  repeatKind: RepeatKind;
  /** 'HH:MM', jam dinding lokal -- diabaikan untuk 'once' (pakai runOnceAt langsung). */
  timeOfDay: string;
  /** 0=Minggu..6=Sabtu, wajib untuk 'weekly'. */
  dayOfWeek?: number | null;
  /** 1-28 (dibatasi supaya selalu valid di semua bulan termasuk Februari), wajib untuk 'monthly'. */
  dayOfMonth?: number | null;
  /** Tanggal+jam spesifik, wajib untuk 'once'. */
  runOnceAt?: Date | null;
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const [h, m] = timeOfDay.split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

/**
 * Kapan eksekusi BERIKUTNYA, dihitung dari `after` (saat jadwal dibuat, atau
 * saat terakhir jalan). Dipakai baik oleh dashboard (hitung next_run_at
 * pertama kali) maupun worker (hitung ulang setelah tiap kali jalan) supaya
 * keduanya konsisten. Memakai getter/setter Date lokal biasa (bukan util
 * UTC+7 eksplisit) -- konsisten dengan seluruh proyek yang mengasumsikan
 * server RS berzona WIB (lihat khanza/common.ts, core/quietHours.ts).
 *
 * Mengembalikan null bila tidak ada eksekusi berikutnya ('once' yang
 * runOnceAt-nya sudah lewat, atau input tidak lengkap).
 */
export function computeNextRunAt(timing: ScheduleTiming, after: Date): Date | null {
  if (timing.repeatKind === 'once') {
    if (!timing.runOnceAt) return null;
    return timing.runOnceAt > after ? timing.runOnceAt : null;
  }

  const { hour, minute } = parseTimeOfDay(timing.timeOfDay);

  if (timing.repeatKind === 'daily') {
    const next = new Date(after);
    next.setHours(hour, minute, 0, 0);
    if (next <= after) next.setDate(next.getDate() + 1);
    return next;
  }

  if (timing.repeatKind === 'weekly') {
    if (timing.dayOfWeek == null) return null;
    const next = new Date(after);
    next.setHours(hour, minute, 0, 0);
    let daysUntil = (timing.dayOfWeek - next.getDay() + 7) % 7;
    if (daysUntil === 0 && next <= after) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (timing.repeatKind === 'monthly') {
    if (timing.dayOfMonth == null) return null;
    const dom = Math.min(Math.max(timing.dayOfMonth, 1), 28);
    const next = new Date(after);
    next.setDate(dom);
    next.setHours(hour, minute, 0, 0);
    if (next <= after) {
      next.setMonth(next.getMonth() + 1);
      // dom<=28 selalu valid di bulan manapun -- setDate ulang murni jaga-jaga,
      // bukan karena setMonth bisa overflow di sini (tidak bisa, karena day-of-month
      // sebelum panggilan ini sudah <=28).
      next.setDate(dom);
    }
    return next;
  }

  return null;
}
