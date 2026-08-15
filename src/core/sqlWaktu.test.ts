import { keSqlUtc, offsetLokalMenit } from './sqlWaktu';

describe('keSqlUtc', () => {
  it('menghasilkan literal DATETIME dalam UTC, bukan waktu lokal', () => {
    // Inilah seluruh gunanya: nilai yang sama yang dulu diserahkan Sequelize
    // sebagai '2026-08-15 08:03:40' (WIB) harus menyeberang sebagai UTC.
    expect(keSqlUtc(new Date('2026-08-15T01:03:40.000Z'))).toBe('2026-08-15 01:03:40');
  });

  it('membuang milidetik, tidak membulatkannya', () => {
    // Kolomnya DATETIME tanpa presisi pecahan. Dibiarkan, MariaDB membulatkan
    // sendiri dan batas jendela bisa bergeser satu detik.
    expect(keSqlUtc(new Date('2026-08-15T01:03:40.999Z'))).toBe('2026-08-15 01:03:40');
  });

  /**
   * Tengah malam WIB adalah pukul 17:00 UTC hari SEBELUMNYA. Ini bentuk yang
   * benar-benar dipakai `startOfDay()` di halaman Ringkasan, dan tepat di
   * sinilah bug tujuh jam itu menggigit: sebelum perbaikan, batas ini
   * diserahkan sebagai '2026-08-15 00:00:00' sehingga "hari ini" sebenarnya
   * dimulai pukul 07:00 WIB.
   */
  it('tengah malam lokal menyeberang sebagai instan UTC yang benar', () => {
    const tengahMalamWib = new Date('2026-08-14T17:00:00.000Z');
    expect(keSqlUtc(tengahMalamWib)).toBe('2026-08-14 17:00:00');
  });

  it('bentuknya cocok dengan literal DATETIME MariaDB', () => {
    expect(keSqlUtc(new Date())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('offsetLokalMenit', () => {
  it('menjawab menit yang harus DITAMBAHKAN ke UTC untuk mendapat jam dinding lokal', () => {
    const pada = new Date('2026-08-15T01:00:00.000Z');
    const offset = offsetLokalMenit(pada);
    // Diturunkan dari zona server, jadi nilainya tidak dipatok ke satu angka --
    // yang dipatok adalah ARTINYA, dan itu bisa diperiksa tanpa tahu zonanya.
    expect(offset).toBe(-pada.getTimezoneOffset());

    const jamDindingLokal = new Date(pada.getTime() + offset * 60_000);
    // Menambahkan offset ke instan UTC harus menghasilkan komponen UTC yang
    // sama persis dengan komponen LOKAL instan aslinya -- itulah yang
    // dilakukan `created_at + INTERVAL :offset MINUTE` di dalam SQL.
    expect(jamDindingLokal.getUTCHours()).toBe(pada.getHours());
    expect(jamDindingLokal.getUTCDate()).toBe(pada.getDate());
  });
});
