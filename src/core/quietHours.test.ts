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

  it('AUTO_REPLY TIDAK ditunda -- pasien sedang menunggu jawaban atas pesannya sendiri', () => {
    const eventAt = at(23);
    expect(computeScheduledAt(eventAt, 'AUTO_REPLY', 21, 7)).toEqual(eventAt);
  });

  it('AUTO_REPLY di dini hari pun langsung, bukan ditahan sampai pagi', () => {
    const eventAt = at(2);
    expect(computeScheduledAt(eventAt, 'AUTO_REPLY', 21, 7)).toEqual(eventAt);
  });

  /**
   * Surat yang SAMA lewat dua jalur, dan hanya yang manual melewati jam tenang.
   * Dipatok berpasangan dalam satu uji karena yang perlu dijaga bukan nilai
   * masing-masing melainkan bahwa keduanya BERBEDA: yang membenarkan
   * ADMINISTRASI bukan isi pesannya melainkan adanya orang yang menunggunya di
   * loket. Begitu pengirimnya jadwal, alasannya gugur -- surat yang tersimpan
   * pukul 22.30 lalu dikirim seketika membangunkan orang untuk berkas yang sama
   * gunanya bila tiba pukul 07.00.
   */
  it('surat manual melewati jam tenang, surat OTOMATIS tidak', () => {
    const eventAt = at(22, 30);
    expect(computeScheduledAt(eventAt, 'ADMINISTRASI', 21, 7)).toEqual(eventAt);

    const otomatis = computeScheduledAt(eventAt, 'SURAT_SAKIT', 21, 7);
    expect(otomatis).not.toEqual(eventAt);
    expect(otomatis.getHours()).toBe(7);
    expect(otomatis.getDate()).toBe(1);
  });

  it('pengecualian jam tenang tidak bocor ke pemicu lain', () => {
    const eventAt = at(23);
    expect(computeScheduledAt(eventAt, 'BROADCAST', 21, 7)).not.toEqual(eventAt);
    expect(computeScheduledAt(eventAt, 'QUEUE_REG', 21, 7)).not.toEqual(eventAt);
  });

  /**
   * KEDUA pengingat kontrol tunduk jam tenang, dan yang dijaga di sini bukan
   * nilai masing-masing melainkan bahwa keduanya SAMA.
   *
   * BPJS_KONTROL dan KONTROL_ULANG mengirim kalimat yang sama gunanya kepada
   * pasien yang sama-sama tidak menunggunya; satu-satunya bedanya adalah lewat
   * kanal mana suratnya diterbitkan, dan itu bukan hal yang boleh menentukan
   * apakah seseorang dibangunkan tengah malam. Keduanya juga dijadwalkan pada
   * jam yang dipilih staf, jadi dalam pemakaian normal jam tenang memang tidak
   * pernah menggigit -- pagar ini untuk siklus yang tertunda, bukan yang wajar.
   */
  it('kedua pengingat kontrol sama-sama TUNDUK jam tenang', () => {
    const eventAt = at(22, 30);
    for (const code of ['BPJS_KONTROL', 'KONTROL_ULANG']) {
      const dijadwalkan = computeScheduledAt(eventAt, code, 21, 7);
      expect(dijadwalkan).not.toEqual(eventAt);
      expect(dijadwalkan.getHours()).toBe(7);
    }
  });
});
