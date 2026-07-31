/** F5.4: percobaan ulang maksimum 3 kali dengan jeda menaik 1/5/25 menit. */
const BACKOFF_MINUTES = [1, 5, 25] as const;
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

export function isPermanentAfter(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

export function retryDelayMs(attemptNumber: number): number {
  const idx = Math.min(Math.max(attemptNumber - 1, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx]! * 60_000;
}

/** F5.3: pesan yang pemicunya lebih tua dari ambang dibatalkan berstatus expired. */
export function isStale(eventAt: Date, thresholdHours: number, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - eventAt.getTime();
  return ageMs > thresholdHours * 60 * 60 * 1000;
}

/** F5.2: jeda acak antar pesan supaya nomor tidak diblokir. */
export function randomDelayMs(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}
