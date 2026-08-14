import { namaPenjamin, lolosSaringPenjamin } from './penjamin';

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

/**
 * Penyaring cara bayar untuk lampiran hasil & tagihan (migrations/048).
 *
 * Yang dijaga di sini bukan pencocokannya -- itu sepele -- melainkan ketiga
 * kasus pinggirnya, dan ketiganya bisa salah ke arah yang BERBEDA:
 *
 *   daftar kosong      salah -> lampiran yang sedang berjalan mati serentak
 *   kode tak dikenal   salah -> daftar-izin yang meloloskan yang tidak diizinkan
 *   penanda '-'        salah -> perilakunya berbeda dari namaPenjamin() tanpa sebab
 */
describe('lolosSaringPenjamin', () => {
  it('daftar KOSONG meloloskan semuanya -- itu yang membuat migrasinya nol-perubahan', () => {
    // Menafsirkannya sebagai "tidak ada yang lolos" akan mematikan lampiran yang
    // sedang berjalan pada detik migrasinya diterapkan.
    expect(lolosSaringPenjamin('A01', [])).toBe(true);
    expect(lolosSaringPenjamin('A02', [])).toBe(true);
    expect(lolosSaringPenjamin(null, [])).toBe(true);
    expect(lolosSaringPenjamin('', [])).toBe(true);
  });

  it('meloloskan kode yang ada di daftar, menolak yang tidak', () => {
    expect(lolosSaringPenjamin('A01', ['A01'])).toBe(true);
    expect(lolosSaringPenjamin('A02', ['A01'])).toBe(false);
    expect(lolosSaringPenjamin('A02', ['A01', 'A02'])).toBe(true);
  });

  /**
   * DAFTAR-IZIN yang gagal ke arah "izinkan" bukan daftar-izin. Kunjungan yang
   * barisnya tidak ditemukan masuk golongan ini -- dan itu konsisten dengan jalur
   * lampirannya, yang beberapa langkah kemudian juga gagal karena
   * `ambilIdentitasKunjungan()` mengembalikan null untuk kunjungan yang sama.
   */
  it('kode yang TIDAK diketahui ditolak, bukan diloloskan', () => {
    expect(lolosSaringPenjamin(null, ['A01'])).toBe(false);
    expect(lolosSaringPenjamin(undefined, ['A01'])).toBe(false);
    expect(lolosSaringPenjamin('', ['A01'])).toBe(false);
    expect(lolosSaringPenjamin('   ', ['A01'])).toBe(false);
    expect(lolosSaringPenjamin('A99', ['A01', 'A02'])).toBe(false);
  });

  /**
   * Penanda '-' diperlakukan sebagai KODE BIASA, bukan dikosongkan seperti di
   * namaPenjamin(). Pertanyaannya berbeda: di sana yang dicari teks yang layak
   * dibaca pasien, di sini kunci yang bisa dicocokkan.
   *
   * Akibatnya kunjungan tanpa penjamin tidak pernah lolos begitu penyaringnya
   * dipasang -- '-' memang tidak ada di daftar pilihan. Terukur 2 dari 1.900
   * nota dalam 90 hari.
   */
  it("penanda '-' tidak pernah lolos saat penyaringnya dipasang", () => {
    expect(lolosSaringPenjamin('-', ['A01', 'A02'])).toBe(false);
    // ...tapi tetap lolos saat tidak ada penyaring sama sekali.
    expect(lolosSaringPenjamin('-', [])).toBe(true);
  });

  it("berbeda dari namaPenjamin(), dan itu disengaja", () => {
    // namaPenjamin mengosongkan '-'; penyaring memperlakukannya sebagai kode.
    expect(namaPenjamin('-')).toBe('');
    expect(lolosSaringPenjamin('-', ['-'])).toBe(true);
  });

  it('memangkas spasi di kedua sisi, karena keduanya hasil ketikan manusia', () => {
    // Kode datang dari kolom varchar Khanza; daftarnya dari JSON app_setting.
    expect(lolosSaringPenjamin('  A01  ', ['A01'])).toBe(true);
    expect(lolosSaringPenjamin('A01', ['  A01  '])).toBe(true);
  });

  it('cocok PERSIS, bukan sebagian -- A0 tidak boleh meloloskan A01', () => {
    // Kode penjamin di katalog ini berbagi awalan (A01, A02, A04, ... A58), jadi
    // pencocokan sebagian akan meloloskan penjamin yang sama sekali lain.
    expect(lolosSaringPenjamin('A01', ['A0'])).toBe(false);
    expect(lolosSaringPenjamin('A0', ['A01'])).toBe(false);
    expect(lolosSaringPenjamin('a01', ['A01'])).toBe(false);
  });
});
