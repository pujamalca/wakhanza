import { isQuietHours, nextWindowStart, computeScheduledAt } from './quietHours';

const at = (h: number, m = 0) => {
  const d = new Date(2026, 6, 31, h, m, 0, 0);
  return d;
};

describe('isQuietHours (default 21..7, melewati tengah malam)', () => {
  it('jam 22:00 termasuk jam tenang', () => {
    expect(isQuietHours(at(22), 21, 7)).toBe(true);
  });
  it('jam 02:00 termasuk jam tenang', () => {
    expect(isQuietHours(at(2), 21, 7)).toBe(true);
  });
  it('jam 06:59 masih jam tenang', () => {
    expect(isQuietHours(at(6, 59), 21, 7)).toBe(true);
  });
  it('jam 07:00 sudah di luar jam tenang', () => {
    expect(isQuietHours(at(7), 21, 7)).toBe(false);
  });
  it('jam 12:00 di luar jam tenang', () => {
    expect(isQuietHours(at(12), 21, 7)).toBe(false);
  });
  it('jam 20:59 masih di luar jam tenang', () => {
    expect(isQuietHours(at(20, 59), 21, 7)).toBe(false);
  });
  it('jam 21:00 mulai jam tenang', () => {
    expect(isQuietHours(at(21), 21, 7)).toBe(true);
  });
});

describe('nextWindowStart', () => {
  it('dari tengah malam (dini hari), jendela buka HARI YANG SAMA jam 07:00', () => {
    const next = nextWindowStart(at(2), 7);
    expect(next.getDate()).toBe(31);
    expect(next.getHours()).toBe(7);
  });

  it('dari malam hari, jendela buka BESOK jam 07:00', () => {
    const next = nextWindowStart(at(22), 7);
    expect(next.getDate()).toBe(1); // 1 Agustus
    expect(next.getHours()).toBe(7);
  });
});

describe('computeScheduledAt', () => {
  it('QUEUE_REG saat jam tenang -> ditunda ke jendela berikutnya', () => {
    const scheduled = computeScheduledAt(at(22), 'QUEUE_REG', 21, 7);
    expect(scheduled.getHours()).toBe(7);
    expect(scheduled.getDate()).toBe(1);
  });

  it('QUEUE_REG di luar jam tenang -> terjadwal segera (event_at apa adanya)', () => {
    const eventAt = at(12);
    expect(computeScheduledAt(eventAt, 'QUEUE_REG', 21, 7)).toEqual(eventAt);
  });

  it('BOOK_CANCEL TIDAK ditunda meski saat jam tenang', () => {
    const eventAt = at(22);
    expect(computeScheduledAt(eventAt, 'BOOK_CANCEL', 21, 7)).toEqual(eventAt);
  });
});
