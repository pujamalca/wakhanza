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

/**
 * Dua cara menafsirkan "pasien mana" pada jadwal broadcast berulang. Bedanya
 * menentukan berapa kali SATU pasien menerima pesan, jadi ini bukan sekadar
 * preferensi tampilan:
 *
 * - `rolling`  : jendela berjalan `lookbackDays` terakhir sampai HARI INI.
 *                Pasien yang sama tetap masuk kriteria selama masih di dalam
 *                jendela, jadi jadwal harian dengan lookback 30 hari mengirim
 *                ke orang yang sama 30 kali. Masuk akal untuk pengumuman
 *                berkala ke seluruh segmen, berbahaya untuk yang lain.
 * - `followup` : TEPAT satu hari kalender, `offsetDays` hari yang lalu.
 *                Dipasangkan dengan pengulangan harian, tiap pasien melewati
 *                jendela ini persis SEKALI -- inilah bentuk "pasien yang
 *                daftar hari ini, dikirimi 3 hari lagi".
 */
export type ScheduleWindowMode = 'rolling' | 'followup';

export const DEFAULT_FOLLOWUP_OFFSET_DAYS = 3;

export interface ScheduleWindowInput {
  windowMode?: ScheduleWindowMode;
  /** Dipakai mode 'rolling'. */
  lookbackDays: number;
  /** Dipakai mode 'followup'. 0 = pasien yang berkunjung hari ini juga. */
  offsetDays?: number;
}

/**
 * Rentang tanggal kunjungan yang disasar, dihitung ULANG dari `now` setiap
 * kali dipanggil -- jadwal berulang tidak boleh membekukan tanggal saat
 * dibuat, karena "30 hari terakhir" berarti jendela yang berbeda tiap minggu.
 *
 * Untuk 'followup', dateFrom == dateTo (satu hari kalender penuh, bukan
 * jendela kosong): pemanggilnya memangkas lewat prefix no_rawat [hari, hari+1).
 */
export function resolveScheduleWindow(input: ScheduleWindowInput, now: Date): { dateFrom: Date; dateTo: Date } {
  if (input.windowMode === 'followup') {
    const day = new Date(now);
    day.setDate(day.getDate() - (input.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS));
    day.setHours(0, 0, 0, 0);
    return { dateFrom: day, dateTo: new Date(day) };
  }

  const from = new Date(now);
  from.setDate(from.getDate() - input.lookbackDays);
  return { dateFrom: from, dateTo: new Date(now) };
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
