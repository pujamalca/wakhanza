import {
  computeNextRunAt,
  resolveScheduleWindow,
  LOOKBACK_SEMUA_WAKTU,
  DEFAULT_FOLLOWUP_OFFSET_DAYS,
  MIN_INTERVAL_DAYS,
  MAX_INTERVAL_DAYS,
} from './schedule';

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

describe('resolveScheduleWindow: rolling', () => {
  it('jendela berjalan N hari terakhir sampai sekarang', () => {
    const now = at(10);
    const { dateFrom, dateTo } = resolveScheduleWindow({ lookbackDays: 30 }, now);
    expect(dateTo.getTime()).toBe(now.getTime());
    expect(dateFrom!.getDate()).toBe(1); // 31 Juli - 30 hari = 1 Juli
    expect(dateFrom!.getMonth()).toBe(6);
  });

  it('windowMode absen (baris jadwal lama) diperlakukan sebagai rolling', () => {
    const { dateFrom, dateTo } = resolveScheduleWindow({ lookbackDays: 7 }, at(10));
    expect(dateTo.getDate()).toBe(31);
    expect(dateFrom!.getDate()).toBe(24);
  });

  it('tidak memangkas jam -- rentangnya sampai detik ini', () => {
    const now = at(14, 37);
    const { dateTo } = resolveScheduleWindow({ lookbackDays: 3 }, now);
    expect(dateTo.getHours()).toBe(14);
    expect(dateTo.getMinutes()).toBe(37);
  });

  /**
   * Nol = tanpa batas bawah, dan `dateFrom` null itulah yang membuat
   * `segmentScope()` memilih bentuk query yang berangkat dari `pasien`.
   * Mengembalikan tanggal "sangat lampau" alih-alih null akan tetap memakai
   * bentuk berjendela, yang prefix `no_rawat`-nya lalu merentang seluruh
   * riwayat -- persis pemindaian yang §4.4 ada untuk mencegah.
   */
  it('lookbackDays 0 = tanpa batas bawah (dateFrom null)', () => {
    const now = at(10);
    const { dateFrom, dateTo } = resolveScheduleWindow({ lookbackDays: LOOKBACK_SEMUA_WAKTU }, now);
    expect(dateFrom).toBeNull();
    expect(dateTo.getTime()).toBe(now.getTime());
  });

  // Angka negatif berarti jendela yang membentang ke MASA DEPAN -- tidak
  // pernah bisa dimaksudkan, jadi diperlakukan sama dengan tanpa batas alih-alih
  // diam-diam menghasilkan rentang yang membuang semua kunjungan lampau.
  it('lookbackDays negatif diperlakukan sebagai tanpa batas', () => {
    expect(resolveScheduleWindow({ lookbackDays: -5 }, at(10)).dateFrom).toBeNull();
  });

  it('jendela bernilai tetap berperilaku persis seperti sebelumnya', () => {
    expect(resolveScheduleWindow({ lookbackDays: 1 }, at(10)).dateFrom).not.toBeNull();
  });
});

describe('resolveScheduleWindow: followup', () => {
  it('tepat SATU hari kalender, N hari yang lalu', () => {
    const { dateFrom, dateTo } = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 30, offsetDays: 3 }, at(10));
    expect(dateFrom!.getDate()).toBe(28); // 31 Juli - 3 hari
    expect(dateTo.getDate()).toBe(28);
    expect(dateFrom!.getTime()).toBe(dateTo.getTime());
  });

  it('dipangkas ke tengah malam, bukan jam saat jadwal jalan', () => {
    // Kalau jamnya ikut terbawa, jadwal yang jalan pukul 09:00 akan melewatkan
    // pasien yang mendaftar pukul 07:00 di hari yang sama.
    const { dateFrom } = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 30, offsetDays: 1 }, at(9, 30));
    expect(dateFrom!.getHours()).toBe(0);
    expect(dateFrom!.getMinutes()).toBe(0);
    expect(dateFrom!.getSeconds()).toBe(0);
    expect(dateFrom!.getMilliseconds()).toBe(0);
  });

  it('offsetDays 0 = pasien yang berkunjung hari ini', () => {
    const { dateFrom, dateTo } = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 30, offsetDays: 0 }, at(10));
    expect(dateFrom!.getDate()).toBe(31);
    expect(dateTo.getDate()).toBe(31);
  });

  it('mengabaikan lookbackDays sepenuhnya', () => {
    const a = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 1, offsetDays: 5 }, at(10));
    const b = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 365, offsetDays: 5 }, at(10));
    expect(a.dateFrom!.getTime()).toBe(b.dateFrom!.getTime());
  });

  it('offsetDays absen -> default', () => {
    const { dateFrom } = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 30 }, at(10));
    expect(dateFrom!.getDate()).toBe(31 - DEFAULT_FOLLOWUP_OFFSET_DAYS);
  });

  it('lewat pergantian bulan', () => {
    const awalAgustus = new Date(2026, 7, 2, 9, 0);
    const { dateFrom } = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 30, offsetDays: 5 }, awalAgustus);
    expect(dateFrom!.getMonth()).toBe(6); // Juli
    expect(dateFrom!.getDate()).toBe(28);
  });

  it('dateFrom dan dateTo adalah objek berbeda (tidak saling mengubah)', () => {
    const { dateFrom, dateTo } = resolveScheduleWindow({ windowMode: 'followup', lookbackDays: 30, offsetDays: 3 }, at(10));
    dateTo.setDate(dateTo.getDate() + 10);
    expect(dateFrom!.getDate()).toBe(28);
  });
});

/**
 * `every_n_days` -- dipakai peringatan DARURAT STOK ("sekali tiga hari").
 *
 * Sengaja TIDAK ada di `RepeatKind` milik broadcast: ENUM MariaDB
 * `broadcast_schedule.repeat_kind` tidak memuatnya, dan tipe yang lebih lebar
 * akan membuat TypeScript meloloskan nilai yang baru gagal di tingkat database.
 */
describe('computeNextRunAt: every_n_days', () => {
  const tiga = { repeatKind: 'every_n_days' as const, timeOfDay: '18:00', intervalDays: 3 };

  it('jam kirim yang belum lewat hari ini dipakai hari itu juga', () => {
    const next = computeNextRunAt(tiga, at(9));
    expect(next?.getDate()).toBe(31);
    expect(next?.getHours()).toBe(18);
  });

  /**
   * Melompat N hari PENUH, bukan 1 hari lalu N-1 lagi. Akibatnya disengaja:
   * jadwal yang dibuat pukul 20:00 pertama kali jalan tiga hari lagi, bukan
   * besok. Jaraknya seragam sejak kejadian pertama, dan itu lebih penting
   * daripada memajukan yang pertama -- jarak tak seragam membuat "kenapa
   * peringatannya datang hari ini" tidak bisa dijawab dari pengaturannya.
   */
  it('jam kirim yang sudah lewat melompat N hari penuh', () => {
    expect(computeNextRunAt(tiga, at(20))?.getDate()).toBe(3); // 31 Juli + 3 = 3 Agustus
  });

  it('tepat pada jamnya dihitung sudah lewat', () => {
    expect(computeNextRunAt(tiga, at(18))?.getDate()).toBe(3);
  });

  it('menyeberangi pergantian bulan', () => {
    const next = computeNextRunAt(tiga, at(20));
    expect(next?.getMonth()).toBe(7); // Agustus
  });

  it('interval dijepit ke batas atas dan bawah', () => {
    const dasar = at(20);
    const besar = computeNextRunAt({ ...tiga, intervalDays: 999 }, dasar);
    expect(Math.round((besar!.getTime() - dasar.getTime()) / 86_400_000)).toBe(MAX_INTERVAL_DAYS);

    // 1 punya namanya sendiri ('daily'); dijepit ke MIN supaya tidak ada dua
    // jalan menuju perilaku yang sama.
    const kecil = computeNextRunAt({ ...tiga, intervalDays: 1 }, dasar);
    expect(Math.round((kecil!.getTime() - dasar.getTime()) / 86_400_000)).toBe(MIN_INTERVAL_DAYS);
  });

  it('pecahan dibulatkan ke bawah lebih dulu', () => {
    const dasar = at(20);
    const next = computeNextRunAt({ ...tiga, intervalDays: 4.9 }, dasar);
    expect(Math.round((next!.getTime() - dasar.getTime()) / 86_400_000)).toBe(4);
  });

  /**
   * Tanpa intervalDays ia TIDAK menebak angka bawaan. Jadwal yang diam-diam
   * memilih angkanya sendiri adalah jadwal yang jalan pada hari yang tidak
   * pernah dipilih siapa pun; null membuat pemanggil menolak menyimpannya.
   */
  it('tanpa intervalDays -> null', () => {
    expect(computeNextRunAt({ repeatKind: 'every_n_days', timeOfDay: '18:00' }, at(9))).toBeNull();
    expect(computeNextRunAt({ repeatKind: 'every_n_days', timeOfDay: '18:00', intervalDays: null }, at(9))).toBeNull();
  });

  it('detik dan milidetik selalu dinolkan', () => {
    const next = computeNextRunAt(tiga, new Date(2026, 6, 31, 9, 0, 37, 512));
    expect(next?.getSeconds()).toBe(0);
    expect(next?.getMilliseconds()).toBe(0);
  });
});
