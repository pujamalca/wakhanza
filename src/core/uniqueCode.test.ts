import { messageUniqueCode, buildUniqueCodeFooter, appendUniqueCode, UNIQUE_CODE_LENGTH } from './uniqueCode';
import { buildIdempotencyKey } from './idempotency';

describe('messageUniqueCode', () => {
  it('menghasilkan kode dengan panjang default 6', () => {
    expect(messageUniqueCode('apa saja')).toHaveLength(UNIQUE_CODE_LENGTH);
  });

  it('hanya memakai karakter Crockford Base32 (tanpa I, L, O, U)', () => {
    for (let i = 0; i < 500; i++) {
      expect(messageUniqueCode(`seed-${i}`)).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    }
  });

  it('deterministik — seed sama selalu menghasilkan kode sama', () => {
    // Ini yang membuat percobaan kirim ulang mengirim TEKS YANG SAMA, bukan
    // pesan yang tampak baru bagi WhatsApp.
    const key = buildIdempotencyKey('QUEUE_REG', '2026/07/31/000001');
    expect(messageUniqueCode(key)).toBe(messageUniqueCode(key));
  });

  it('berbeda untuk pesan yang berbeda', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      codes.add(messageUniqueCode(buildIdempotencyKey('QUEUE_REG', `2026/07/31/${i}`)));
    }
    // 2000 kode dari ruang 32^6: tabrakan acak secara teori mungkin tapi
    // sangat jarang (~0,2%). Ambang longgar di sini hanya untuk menangkap
    // kesalahan nyata seperti kode yang konstan atau nyaris tak berubah.
    expect(codes.size).toBeGreaterThan(1990);
  });

  it('membatasi panjang ke ukuran digest, tidak mengulang pola', () => {
    const long = messageUniqueCode('seed', 999);
    expect(long).toHaveLength(32);
  });
});

describe('buildUniqueCodeFooter', () => {
  it('mengganti {kode} di dalam template', () => {
    const footer = buildUniqueCodeFooter('seed', 'Ref: {kode}')!;
    expect(footer).toMatch(/^Ref: [0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('mengembalikan null bila template kosong (fitur dimatikan)', () => {
    expect(buildUniqueCodeFooter('seed', '')).toBeNull();
    expect(buildUniqueCodeFooter('seed', '   ')).toBeNull();
  });

  it('tetap menempelkan kode walau admin menghapus {kode} dari template', () => {
    // Tanpa jaring pengaman ini, seluruh pesan berakhiran teks identik dan
    // fitur ini mati diam-diam tanpa satu pun pesan error.
    const footer = buildUniqueCodeFooter('seed', 'Kode pesan')!;
    expect(footer).toMatch(/^Kode pesan [0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('mengganti semua kemunculan {kode}', () => {
    const footer = buildUniqueCodeFooter('seed', '{kode} / {kode}')!;
    const [a, b] = footer.split(' / ');
    expect(a).toBe(b);
  });
});

describe('appendUniqueCode', () => {
  it('menambahkan footer setelah baris kosong', () => {
    const out = appendUniqueCode('Halo Budi.', 'seed', 'Ref: {kode}');
    expect(out).toMatch(/^Halo Budi\.\n\nRef: [0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('mengembalikan body apa adanya bila template kosong', () => {
    expect(appendUniqueCode('Halo Budi.', 'seed', '')).toBe('Halo Budi.');
  });

  it('tidak mengembangkan {variabel} yang berasal dari data pasien', () => {
    // Substitusi footer HARUS terpisah dari renderTemplate: nama pasien yang
    // sudah tersubstitusi tidak boleh dipindai ulang untuk pola {...}
    // (ARCHITECTURE §9.2, aturan satu lintasan).
    const body = 'Halo {kontak_rs}.'; // seolah-olah nama pasien literal "{kontak_rs}"
    const out = appendUniqueCode(body, 'seed', 'Ref: {kode}');
    expect(out).toContain('Halo {kontak_rs}.');
  });

  it('dua pasien pada kampanye yang sama menerima teks berbeda', () => {
    // Inti dari fitur ini: broadcast tanpa {nama_pasien} pun tidak lagi
    // menghasilkan ratusan pesan identik karakter per karakter.
    const body = 'Info dari RS. Balas STOP untuk berhenti.';
    const a = appendUniqueCode(body, buildIdempotencyKey('BROADCAST', 7, '000001'), 'Ref: {kode}');
    const b = appendUniqueCode(body, buildIdempotencyKey('BROADCAST', 7, '000002'), 'Ref: {kode}');
    expect(a).not.toBe(b);
  });
});
