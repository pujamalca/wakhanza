import { namaPenjamin } from './penjamin';

describe('namaPenjamin', () => {
  it('meneruskan nama penjamin sungguhan apa adanya', () => {
    expect(namaPenjamin('BPJS Kesehatan')).toBe('BPJS Kesehatan');
    expect(namaPenjamin('UMUM')).toBe('UMUM');
  });

  it('mempertahankan tanda baca di dalam nama, bukan cuma huruf', () => {
    // Nama sungguhan di katalog penjab instalasi ini. Dibuang tanda kurungnya
    // berarti pasien membaca nama yang tidak sama dengan yang tertulis di
    // kartunya sendiri.
    expect(namaPenjamin('Asuransi Adira ( Medicillin )')).toBe('Asuransi Adira ( Medicillin )');
    expect(namaPenjamin('Asuransi Axa Services/Mandiri')).toBe('Asuransi Axa Services/Mandiri');
  });

  /**
   * INTI-nya. `penjab` punya baris `kd_pj = '-'` yang png_jawab-nya juga '-'.
   * Tanpa ini, pesan ke pasien berbunyi "Cara bayar: -".
   */
  it('memperlakukan penanda "-" sebagai tidak diisi, bukan sebagai nama', () => {
    expect(namaPenjamin('-')).toBe('');
    expect(namaPenjamin(' - ')).toBe('');
    expect(namaPenjamin('--')).toBe('');
  });

  it('null / undefined / kosong menghasilkan string kosong', () => {
    expect(namaPenjamin(null)).toBe('');
    expect(namaPenjamin(undefined)).toBe('');
    expect(namaPenjamin('')).toBe('');
    expect(namaPenjamin('   ')).toBe('');
  });

  it('teks "null"/"undefined" yang terlanjur tersimpan tidak ikut terkirim', () => {
    expect(namaPenjamin('null')).toBe('');
    expect(namaPenjamin('NULL')).toBe('');
    expect(namaPenjamin('undefined')).toBe('');
  });

  /**
   * TIDAK menebak "Umum" saat kosong. `UMUM` adalah baris penjab tersendiri
   * (A01), jadi kekosongan berarti datanya belum diisi -- bukan bahwa
   * pasiennya bayar sendiri. Menebak di sini menghasilkan jawaban
   * percaya-diri-dan-keliru, kesalahan yang sama yang membuat detectPoli()
   * mengembalikan null saat ambigu.
   */
  it('tidak pernah mengarang nilai pengganti saat kosong', () => {
    expect(namaPenjamin(null)).not.toMatch(/umum/i);
    expect(namaPenjamin('-')).not.toMatch(/umum/i);
  });

  it('nama yang KEBETULAN memuat tanda hubung tetap lolos', () => {
    expect(namaPenjamin('Asuransi A-Z')).toBe('Asuransi A-Z');
    expect(namaPenjamin('BPJS - Ketenagakerjaan')).toBe('BPJS - Ketenagakerjaan');
  });

  it('memangkas spasi pinggir, karena kolomnya varchar hasil ketikan manusia', () => {
    expect(namaPenjamin('  BPJS Kesehatan  ')).toBe('BPJS Kesehatan');
  });
});
