import {
  messageUniqueCode,
  buildUniqueCodeFooter,
  appendUniqueCode,
  formatWaktuKirim,
  DEFAULT_UNIQUE_CODE_TEMPLATE,
  UNIQUE_CODE_LENGTH,
} from './uniqueCode';
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

describe('formatWaktuKirim', () => {
  it('memakai YYYY-MM-DD HH:mm:ss dengan nol di depan', () => {
    expect(formatWaktuKirim(new Date(2026, 7, 2, 20, 18, 41))).toBe('2026-08-02 20:18:41');
    expect(formatWaktuKirim(new Date(2026, 0, 9, 4, 5, 6))).toBe('2026-01-09 04:05:06');
  });

  it('memakai jam 24 (tengah malam bukan 12)', () => {
    expect(formatWaktuKirim(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31 00:00:00');
  });
});

describe('buildUniqueCodeFooter', () => {
  const WAKTU = new Date(2026, 7, 2, 20, 18, 41);

  it('mengganti {waktu} dan {kode} pada template bawaan', () => {
    const footer = buildUniqueCodeFooter('seed', DEFAULT_UNIQUE_CODE_TEMPLATE, WAKTU)!;
    expect(footer).toMatch(/^Kode Pengiriman : 2026-08-02 20:18:41 [0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('mengembalikan null bila template kosong (fitur dimatikan)', () => {
    expect(buildUniqueCodeFooter('seed', '', WAKTU)).toBeNull();
    expect(buildUniqueCodeFooter('seed', '   ', WAKTU)).toBeNull();
  });

  it('tetap menempelkan kode walau admin menghapus {kode} dari template', () => {
    // Tanpa jaring pengaman ini, seluruh pesan berakhiran teks identik dan
    // fitur ini mati diam-diam tanpa satu pun pesan error.
    const footer = buildUniqueCodeFooter('seed', 'Kode Pengiriman : {waktu}', WAKTU)!;
    expect(footer).toMatch(/^Kode Pengiriman : 2026-08-02 20:18:41 [0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('mengganti semua kemunculan {kode} dan {waktu}', () => {
    const footer = buildUniqueCodeFooter('seed', '{kode} / {kode} @ {waktu} / {waktu}', WAKTU)!;
    const [kodeA, sisa] = footer.split(' / ');
    expect(sisa!.startsWith(kodeA!)).toBe(true);
    expect(footer.match(/2026-08-02 20:18:41/g)).toHaveLength(2);
  });

  it('waktu berbeda TIDAK cukup membedakan pesan tanpa {kode}', () => {
    // Alasan {kode} tetap dipertahankan: satu broadcast meng-enqueue seluruh
    // penerimanya dalam perulangan rapat, jadi detiknya sama untuk ratusan
    // pesan. Tanpa kode, seluruh kiriman berakhiran teks identik.
    const a = buildUniqueCodeFooter('penerima-1', 'Kode Pengiriman : {waktu}', WAKTU)!;
    const b = buildUniqueCodeFooter('penerima-2', 'Kode Pengiriman : {waktu}', WAKTU)!;
    expect(a.slice(0, 'Kode Pengiriman : 2026-08-02 20:18:41'.length)).toBe(
      b.slice(0, 'Kode Pengiriman : 2026-08-02 20:18:41'.length),
    );
    expect(a).not.toBe(b); // yang membedakan HANYA kodenya
  });
});

describe('appendUniqueCode', () => {
  const WAKTU = new Date(2026, 7, 2, 20, 18, 41);

  it('menambahkan footer setelah baris kosong', () => {
    const out = appendUniqueCode('Halo Budi.', 'seed', DEFAULT_UNIQUE_CODE_TEMPLATE, WAKTU);
    expect(out).toMatch(/^Halo Budi\.\n\nKode Pengiriman : 2026-08-02 20:18:41 [0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it('mengembalikan body apa adanya bila template kosong', () => {
    expect(appendUniqueCode('Halo Budi.', 'seed', '', WAKTU)).toBe('Halo Budi.');
  });

  it('tidak mengembangkan {variabel} yang berasal dari data pasien', () => {
    // Substitusi footer HARUS terpisah dari renderTemplate: nama pasien yang
    // sudah tersubstitusi tidak boleh dipindai ulang untuk pola {...}
    // (ARCHITECTURE §9.2, aturan satu lintasan).
    const body = 'Halo {kontak_rs}.'; // seolah-olah nama pasien literal "{kontak_rs}"
    const out = appendUniqueCode(body, 'seed', DEFAULT_UNIQUE_CODE_TEMPLATE, WAKTU);
    expect(out).toContain('Halo {kontak_rs}.');
  });

  it('dua pasien pada kampanye yang sama menerima teks berbeda WALAU detiknya sama', () => {
    // Inti dari fitur ini: broadcast tanpa {nama_pasien} pun tidak lagi
    // menghasilkan ratusan pesan identik karakter per karakter -- dan waktu
    // yang sama persis di sini meniru keadaan sungguhannya.
    const body = 'Info dari RS.';
    const a = appendUniqueCode(body, buildIdempotencyKey('BROADCAST', 7, '000001'), DEFAULT_UNIQUE_CODE_TEMPLATE, WAKTU);
    const b = appendUniqueCode(body, buildIdempotencyKey('BROADCAST', 7, '000002'), DEFAULT_UNIQUE_CODE_TEMPLATE, WAKTU);
    expect(a).not.toBe(b);
  });
});
