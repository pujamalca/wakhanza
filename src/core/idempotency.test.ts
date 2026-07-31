import { buildIdempotencyKey } from './idempotency';

describe('buildIdempotencyKey', () => {
  it('menghasilkan 40 karakter hex (SHA1)', () => {
    const key = buildIdempotencyKey('QUEUE_REG', '2026/05/29/000001');
    expect(key).toMatch(/^[0-9a-f]{40}$/);
  });

  it('deterministik untuk input yang sama', () => {
    const a = buildIdempotencyKey('QUEUE_REG', '2026/05/29/000001');
    const b = buildIdempotencyKey('QUEUE_REG', '2026/05/29/000001');
    expect(a).toBe(b);
  });

  it('berbeda untuk trigger_code berbeda dengan kunci alami sama', () => {
    const a = buildIdempotencyKey('QUEUE_REG', '123');
    const b = buildIdempotencyKey('BOOK_CONFIRM', '123');
    expect(a).not.toBe(b);
  });

  it('berbeda untuk kunci alami berbeda', () => {
    const a = buildIdempotencyKey('QUEUE_REG', '2026/05/29/000001');
    const b = buildIdempotencyKey('QUEUE_REG', '2026/05/29/000002');
    expect(a).not.toBe(b);
  });

  it('BOOK_CANCEL: status yang sama -> kunci sama (pindaian ulang tidak mengirim dua kali)', () => {
    const a = buildIdempotencyKey('BOOK_CANCEL', '009042', '2026-08-01', 'Belum');
    const b = buildIdempotencyKey('BOOK_CANCEL', '009042', '2026-08-01', 'Belum');
    expect(a).toBe(b);
  });

  it('BOOK_CANCEL: status berubah -> kunci baru (satu pesan baru terkirim)', () => {
    const before = buildIdempotencyKey('BOOK_CANCEL', '009042', '2026-08-01', 'Belum');
    const after = buildIdempotencyKey('BOOK_CANCEL', '009042', '2026-08-01', 'Dokter Berhalangan');
    expect(before).not.toBe(after);
  });

  it('tidak ambigu terhadap batas antar bagian (concatenation collision)', () => {
    const a = buildIdempotencyKey('QUEUE_REG', '12', '3');
    const b = buildIdempotencyKey('QUEUE_REG', '1', '23');
    expect(a).not.toBe(b);
  });
});
