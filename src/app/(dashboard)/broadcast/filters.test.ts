import { parseFilters, PRESET_SEMUA_WAKTU, DEFAULT_LOOKBACK_DAYS } from './filters';

function selisihHari(dari: Date, sampai: Date): number {
  return Math.round((sampai.getTime() - dari.getTime()) / 86_400_000);
}

describe('parseFilters', () => {
  it('halaman dibuka polos (tanpa kunci tanggal) = jendela bawaan, bukan semua waktu', () => {
    const f = parseFilters({});
    expect(f.dateFrom).not.toBeNull();
    expect(f.dateTo).not.toBeNull();
    expect(selisihHari(f.dateFrom!, f.dateTo!)).toBe(DEFAULT_LOOKBACK_DAYS);
  });

  it('kotak tanggal dikosongkan sendiri oleh staf = tanpa batas waktu', () => {
    const f = parseFilters({ dateFrom: '', dateTo: '' });
    expect(f.dateFrom).toBeNull();
    expect(f.dateTo).toBeNull();
  });

  it('preset semua waktu mengosongkan kedua tanggal walau kotaknya masih terisi', () => {
    // Chip "Semua waktu" adalah tombol submit, jadi nilai kotak tanggal yang
    // sedang tampil IKUT terkirim -- preset harus menang atasnya.
    const f = parseFilters({ preset: PRESET_SEMUA_WAKTU, dateFrom: '2026-07-01', dateTo: '2026-07-31' });
    expect(f.dateFrom).toBeNull();
    expect(f.dateTo).toBeNull();
  });

  it('preset rentang tetap menang atas kotak tanggal', () => {
    const f = parseFilters({ preset: '3m', dateFrom: '2026-07-01', dateTo: '2026-07-31' });
    expect(selisihHari(f.dateFrom!, f.dateTo!)).toBe(90);
  });

  it('tanggal mulai saja dilengkapi sampai hari ini, tidak jatuh ke semua waktu', () => {
    const f = parseFilters({ dateFrom: '2026-07-01', dateTo: '' });
    expect(f.dateFrom).not.toBeNull();
    expect(f.dateTo).not.toBeNull();
  });

  it('tanggal akhir saja dipertahankan apa adanya, tidak dikarang batas bawahnya', () => {
    const f = parseFilters({ dateFrom: '', dateTo: '2026-07-31' });
    expect(f.dateFrom).toBeNull();
    expect(f.dateTo?.getDate()).toBe(31);
  });

  it('tanggal ngawur diperlakukan seperti kosong, bukan Invalid Date', () => {
    const f = parseFilters({ dateFrom: 'bukan-tanggal', dateTo: '' });
    expect(f.dateFrom).toBeNull();
  });

  it('filter lain diteruskan apa adanya', () => {
    const f = parseFilters({ dateFrom: '', dateTo: '', kab: ['1', '2'], pj: 'BPJ', cari: '  Budi  ' });
    expect(f.kdKab).toEqual(['1', '2']);
    expect(f.kdPj).toEqual(['BPJ']);
    expect(f.cari).toBe('Budi');
  });
});
