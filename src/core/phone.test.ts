import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  // Empat kondisi nyata dari PRD §5.1 / ARCHITECTURE §5.1 (8.117 baris sik.pasien).
  it('menerima nomor yang diawali 08', () => {
    expect(normalizePhone('081200000048')).toEqual({ ok: true, value: '6281200000048' });
  });

  it('menyelamatkan nomor yang kehilangan 0 di depan', () => {
    expect(normalizePhone('81200000086')).toEqual({ ok: true, value: '6281200000086' });
  });

  it('menolak nomor yang jelas bukan seluler', () => {
    expect(normalizePhone('2341231231')).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('menolak tanda "-" sebagai kosong', () => {
    expect(normalizePhone('-')).toEqual({ ok: false, reason: 'empty' });
  });

  it('menolak string kosong dan null', () => {
    expect(normalizePhone('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizePhone(null)).toEqual({ ok: false, reason: 'empty' });
    expect(normalizePhone(undefined)).toEqual({ ok: false, reason: 'empty' });
    expect(normalizePhone('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('merapikan nomor yang sudah 628... dan berspasi', () => {
    expect(normalizePhone('6281200000048 ')).toEqual({ ok: true, value: '6281200000048' });
  });

  it('merapikan nomor bertanda hubung', () => {
    expect(normalizePhone('0812-0000-0048')).toEqual({ ok: true, value: '6281200000048' });
  });

  it('menerima +62 dengan tanda plus', () => {
    expect(normalizePhone('+6281200000048')).toEqual({ ok: true, value: '6281200000048' });
  });

  it('memangkas awalan 62 berganda', () => {
    expect(normalizePhone('6262812345678')).toEqual({ ok: true, value: '62812345678' });
  });

  it('menerima nomor 9 digit yang kehilangan 0 (batas bawah panjang valid)', () => {
    // '812345678' -> 62 + '812345678' = '62812345678' (628 + '1' + 7 digit) -> lolos §7.
    expect(normalizePhone('812345678')).toEqual({ ok: true, value: '62812345678' });
  });

  it('menolak nomor 628-prefixed yang terlalu pendek', () => {
    expect(normalizePhone('62812345')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('menolak nomor telepon rumah (awalan kode area, bukan seluler)', () => {
    // '0751...' (kode area kota) -> 62751... -> tidak diawali 628.
    expect(normalizePhone('07517971627')).toEqual({ ok: false, reason: 'not_mobile' });
  });

  it('menolak 628 yang diikuti 0 (bukan awalan operator seluler yang sah)', () => {
    expect(normalizePhone('6280123456789')).toEqual({ ok: false, reason: 'not_mobile' });
  });

  it('menolak sisa notasi ilmiah spreadsheet yang rusak (ditemukan nyata di sik.pasien)', () => {
    // "8,13E+11" -> digit saja -> '81311' -> kandidat '6281311' -> terlalu pendek.
    expect(normalizePhone('8,13E+11')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('menolak nilai sampah pendek seperti ditemukan nyata di sik.pasien', () => {
    expect(normalizePhone('65')).toEqual({ ok: false, reason: 'unparseable' });
    expect(normalizePhone('102')).toEqual({ ok: false, reason: 'unparseable' });
  });
});
