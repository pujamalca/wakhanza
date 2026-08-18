import { buildIdempotencyKey, turunkanKunciTujuan, turunkanKunciBagian } from './idempotency';

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

describe('turunkanKunciTujuan', () => {
  const dasar = buildIdempotencyKey('QUEUE_REG', '2026/08/03/000042');

  it('tetap 40 karakter hex, jadi muat di VARCHAR(64)', () => {
    // Inilah alasan fungsi ini ada. Menyambung (`${dasar}:${chatId}`) untuk JID
    // grup 24 karakter menghasilkan 65 karakter -- satu karakter di atas batas
    // kolom, dan MariaDB non-strict memotongnya DIAM-DIAM tepat di bagian yang
    // membedakan satu tujuan dari tujuan lain.
    const kunci = turunkanKunciTujuan(dasar, '120363000000000000@g.us');
    expect(kunci).toMatch(/^[0-9a-f]{40}$/);
    expect(kunci.length).toBeLessThanOrEqual(64);
  });

  it('berbeda untuk tiap tujuan, sehingga semua tujuan lolos uq_idem', () => {
    const a = turunkanKunciTujuan(dasar, '120363000000000000@g.us');
    const b = turunkanKunciTujuan(dasar, '120363999999999999@g.us');
    const c = turunkanKunciTujuan(dasar, '6281234567890@c.us');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('berbeda dari kunci pesan aslinya, supaya salinan tidak menabrak pesan pasien', () => {
    expect(turunkanKunciTujuan(dasar, '120363000000000000@g.us')).not.toBe(dasar);
  });

  it('deterministik -- percobaan ulang menghasilkan kunci yang sama, bukan pesan baru', () => {
    const chat = '120363000000000000@g.us';
    expect(turunkanKunciTujuan(dasar, chat)).toBe(turunkanKunciTujuan(dasar, chat));
  });

  it('kejadian berbeda ke tujuan yang sama tetap berbeda', () => {
    const lain = buildIdempotencyKey('QUEUE_REG', '2026/08/03/000043');
    const chat = '120363000000000000@g.us';
    expect(turunkanKunciTujuan(dasar, chat)).not.toBe(turunkanKunciTujuan(lain, chat));
  });
});

describe('turunkanKunciBagian', () => {
  const dasar = buildIdempotencyKey('AUTO_REPLY', 'false_628123@c.us_ABCDEF');

  /**
   * INTI-nya. Beberapa pemanggil memeriksa lebih dulu apakah kunci DASAR sudah
   * ada di `outbox` untuk menolak pesan yang diserahkan ulang. Kalau bagian
   * pertama ikut diturunkan, kunci dasar itu tidak pernah benar-benar tertulis,
   * pemeriksaannya selalu meleset, dan satu restart worker membanjiri
   * penerimanya dengan jawaban lama.
   */
  it('bagian pertama memakai kunci dasarnya apa adanya', () => {
    expect(turunkanKunciBagian(dasar, 0)).toBe(dasar);
  });

  it('bagian berikutnya berbeda satu sama lain dan dari kunci dasar', () => {
    const kunci = [0, 1, 2, 3].map((i) => turunkanKunciBagian(dasar, i));
    expect(new Set(kunci).size).toBe(4);
  });

  it('tetap 40 karakter hex, jadi muat di VARCHAR(64)', () => {
    expect(turunkanKunciBagian(dasar, 7)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('deterministik -- jalan ulang atas jatuh tempo yang sama tidak menambah pesan', () => {
    expect(turunkanKunciBagian(dasar, 2)).toBe(turunkanKunciBagian(dasar, 2));
  });

  it('bagian yang sama dari kejadian berbeda tetap berbeda', () => {
    const lain = buildIdempotencyKey('AUTO_REPLY', 'false_628123@c.us_ZZZZZZ');
    expect(turunkanKunciBagian(dasar, 1)).not.toBe(turunkanKunciBagian(lain, 1));
  });

  it('indeks negatif diperlakukan seperti bagian pertama, bukan kunci ketiga', () => {
    expect(turunkanKunciBagian(dasar, -1)).toBe(dasar);
  });
});
