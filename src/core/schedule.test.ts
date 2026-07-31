import { computeNextRunAt } from './schedule';

// 31 Juli 2026 = Jumat (getDay() === 5).
const at = (h: number, m = 0) => new Date(2026, 6, 31, h, m, 0, 0);

describe('computeNextRunAt: once', () => {
  it('runOnceAt di masa depan -> dipakai apa adanya', () => {
    const runOnceAt = new Date(2026, 7, 15, 9, 0);
    const next = computeNextRunAt({ repeatKind: 'once', timeOfDay: '09:00', runOnceAt }, at(10));
    expect(next).toEqual(runOnceAt);
  });

  it('runOnceAt sudah lewat -> null (tidak dijadwalkan ulang)', () => {
    const runOnceAt = new Date(2026, 6, 1, 9, 0);
    expect(computeNextRunAt({ repeatKind: 'once', timeOfDay: '09:00', runOnceAt }, at(10))).toBeNull();
  });

  it('tanpa runOnceAt -> null', () => {
    expect(computeNextRunAt({ repeatKind: 'once', timeOfDay: '09:00' }, at(10))).toBeNull();
  });
});

describe('computeNextRunAt: daily', () => {
  it('jam kirim belum lewat hari ini -> jalan hari ini', () => {
    const next = computeNextRunAt({ repeatKind: 'daily', timeOfDay: '18:00' }, at(10));
    expect(next?.getDate()).toBe(31);
    expect(next?.getHours()).toBe(18);
  });

  it('jam kirim sudah lewat hari ini -> jalan besok', () => {
    const next = computeNextRunAt({ repeatKind: 'daily', timeOfDay: '08:00' }, at(10));
    expect(next?.getDate()).toBe(1); // 1 Agustus
    expect(next?.getHours()).toBe(8);
  });

  it('persis di jam kirim -> dianggap sudah lewat, jalan besok (bukan jalan dua kali)', () => {
    const next = computeNextRunAt({ repeatKind: 'daily', timeOfDay: '10:00' }, at(10, 0));
    expect(next?.getDate()).toBe(1);
  });
});

describe('computeNextRunAt: weekly', () => {
  it('hari target masih di masa depan minggu ini -> jalan hari itu', () => {
    // Jumat (5) -> target Senin (1): 3 hari lagi (3 Agustus).
    const next = computeNextRunAt({ repeatKind: 'weekly', timeOfDay: '09:00', dayOfWeek: 1 }, at(10));
    expect(next?.getDate()).toBe(3);
    expect(next?.getMonth()).toBe(7); // Agustus
  });

  it('hari ini PERSIS hari target, jam belum lewat -> jalan hari ini', () => {
    const next = computeNextRunAt({ repeatKind: 'weekly', timeOfDay: '18:00', dayOfWeek: 5 }, at(10));
    expect(next?.getDate()).toBe(31);
    expect(next?.getMonth()).toBe(6); // Juli
  });

  it('hari ini PERSIS hari target, jam sudah lewat -> minggu depan (bukan hari ini lagi)', () => {
    const next = computeNextRunAt({ repeatKind: 'weekly', timeOfDay: '08:00', dayOfWeek: 5 }, at(10));
    expect(next?.getDate()).toBe(7); // 7 Agustus (Jumat berikutnya)
    expect(next?.getMonth()).toBe(7);
  });

  it('tanpa dayOfWeek -> null', () => {
    expect(computeNextRunAt({ repeatKind: 'weekly', timeOfDay: '09:00' }, at(10))).toBeNull();
  });
});

describe('computeNextRunAt: monthly', () => {
  it('tanggal target masih di depan bulan ini -> bulan ini', () => {
    const midJuly = new Date(2026, 6, 10, 10, 0);
    const next = computeNextRunAt({ repeatKind: 'monthly', timeOfDay: '09:00', dayOfMonth: 28 }, midJuly);
    expect(next?.getMonth()).toBe(6); // Juli
    expect(next?.getDate()).toBe(28);
  });

  it('tanggal target sudah lewat bulan ini -> bulan depan', () => {
    const next = computeNextRunAt({ repeatKind: 'monthly', timeOfDay: '09:00', dayOfMonth: 1 }, at(10));
    expect(next?.getMonth()).toBe(7); // Agustus
    expect(next?.getDate()).toBe(1);
  });

  it('lewat pergantian tahun (Desember -> Januari)', () => {
    const desember = new Date(2026, 11, 20, 10, 0);
    const next = computeNextRunAt({ repeatKind: 'monthly', timeOfDay: '09:00', dayOfMonth: 5 }, desember);
    expect(next?.getFullYear()).toBe(2027);
    expect(next?.getMonth()).toBe(0); // Januari
    expect(next?.getDate()).toBe(5);
  });

  it('dayOfMonth di atas 28 dibatasi jadi 28 (aman untuk Februari)', () => {
    const next = computeNextRunAt({ repeatKind: 'monthly', timeOfDay: '09:00', dayOfMonth: 31 }, at(10));
    expect(next?.getDate()).toBe(28);
  });

  it('tanpa dayOfMonth -> null', () => {
    expect(computeNextRunAt({ repeatKind: 'monthly', timeOfDay: '09:00' }, at(10))).toBeNull();
  });
});
