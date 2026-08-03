import { segmentScope } from './segmentScope';

const KOSONG = { dateFrom: null, dateTo: null };

describe('segmentScope', () => {
  it('rentang tanggal lengkap = berjendela', () => {
    expect(segmentScope({ dateFrom: new Date('2026-07-01'), dateTo: new Date('2026-07-31') })).toBe('berjendela');
  });

  it('batas bawah saja tetap berjendela -- prefix no_rawat sudah bisa dipakai', () => {
    expect(segmentScope({ dateFrom: new Date('2026-07-01'), dateTo: null })).toBe('berjendela');
  });

  it('batas bawah menang atas filter lain: yang menentukan bentuk query cuma tanggal', () => {
    expect(segmentScope({ dateFrom: new Date('2026-07-01'), dateTo: null, cari: 'Budi' })).toBe('berjendela');
  });

  it('batas ATAS saja bukan jendela -- tetap tak berbatas ke belakang', () => {
    expect(segmentScope({ dateFrom: null, dateTo: new Date('2026-07-31'), cari: 'Budi' })).toBe('semua-waktu');
  });

  it.each([
    ['pencarian', { cari: 'Budi' }],
    ['kdKab', { kdKab: ['1'] }],
    ['kdKec', { kdKec: ['1.1'] }],
    ['kdKel', { kdKel: ['1.1.1'] }],
  ])('tanpa tanggal + %s (melekat pada pasien) = semua-waktu', (_nama, filter) => {
    expect(segmentScope({ ...KOSONG, ...filter })).toBe('semua-waktu');
  });

  // Keduanya menyaring KUNJUNGAN, bukan pasien, jadi tidak menyempitkan sisi
  // penggerak query semua-waktu sama sekali -- lihat komentar di segmentScope().
  it('cara bayar saja tidak cukup untuk semua-waktu', () => {
    expect(segmentScope({ ...KOSONG, kdPj: ['BPJ'] })).toBe('tanpa-batas');
  });

  it('batas atas tanggal saja tidak cukup untuk semua-waktu', () => {
    expect(segmentScope({ dateFrom: null, dateTo: new Date('2026-07-31') })).toBe('tanpa-batas');
  });

  it('cara bayar MENDAMPINGI penyaring pasien tetap boleh', () => {
    expect(segmentScope({ ...KOSONG, cari: 'Budi', kdPj: ['BPJ'] })).toBe('semua-waktu');
  });

  it('tanpa apa pun = tanpa-batas', () => {
    expect(segmentScope(KOSONG)).toBe('tanpa-batas');
  });

  it('larik filter KOSONG tidak dihitung sebagai filter', () => {
    expect(segmentScope({ ...KOSONG, kdKab: [], kdKec: [], kdKel: [], kdPj: [] })).toBe('tanpa-batas');
  });

  it('pencarian berisi spasi saja tidak dihitung sebagai filter', () => {
    expect(segmentScope({ ...KOSONG, cari: '   ' })).toBe('tanpa-batas');
  });
});
