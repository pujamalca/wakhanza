import { isPermanentAfter, retryDelayMs, isStale, randomDelayMs, MAX_ATTEMPTS } from './retry';

describe('isPermanentAfter', () => {
  it('belum permanen sebelum percobaan ke-3', () => {
    expect(isPermanentAfter(1)).toBe(false);
    expect(isPermanentAfter(2)).toBe(false);
  });
  it('permanen pada dan setelah percobaan ke-3', () => {
    expect(isPermanentAfter(3)).toBe(true);
    expect(isPermanentAfter(4)).toBe(true);
  });
  it('MAX_ATTEMPTS = 3 sesuai F5.4', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe('retryDelayMs', () => {
  it('percobaan 1 -> 1 menit', () => {
    expect(retryDelayMs(1)).toBe(60_000);
  });
  it('percobaan 2 -> 5 menit', () => {
    expect(retryDelayMs(2)).toBe(5 * 60_000);
  });
  it('percobaan 3 -> 25 menit', () => {
    expect(retryDelayMs(3)).toBe(25 * 60_000);
  });
  it('percobaan di luar jangkauan tetap memakai jeda terbesar', () => {
    expect(retryDelayMs(10)).toBe(25 * 60_000);
  });
});

describe('isStale', () => {
  const now = new Date('2026-07-31T12:00:00');
  it('belum basi bila di bawah ambang', () => {
    const eventAt = new Date('2026-07-31T09:00:00'); // 3 jam lalu
    expect(isStale(eventAt, 6, now)).toBe(false);
  });
  it('basi bila melampaui ambang', () => {
    const eventAt = new Date('2026-07-31T05:00:00'); // 7 jam lalu
    expect(isStale(eventAt, 6, now)).toBe(true);
  });
  it('tepat di ambang belum dianggap basi', () => {
    const eventAt = new Date('2026-07-31T06:00:00'); // tepat 6 jam
    expect(isStale(eventAt, 6, now)).toBe(false);
  });
});

describe('randomDelayMs', () => {
  it('selalu dalam rentang [min,max]', () => {
    for (let i = 0; i < 200; i++) {
      const d = randomDelayMs(3000, 8000);
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThan(8000);
    }
  });
  it('mengembalikan min bila max <= min', () => {
    expect(randomDelayMs(5000, 5000)).toBe(5000);
  });
});
