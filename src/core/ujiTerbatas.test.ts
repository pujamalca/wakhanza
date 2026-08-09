import { BATAS_MAKSIMAL, TANPA_BATAS, batasSah, bolehKirimKePasien } from './ujiTerbatas';

describe('bolehKirimKePasien', () => {
  /**
   * Asersi TERPENTING di berkas ini.
   *
   * Kolom `template.batas_pasien_harian` bawaannya 0 untuk SELURUH baris yang
   * sudah ada. Menafsirkan 0 sebagai "nol pesan" akan mematikan setiap pemicu
   * pasien yang sedang berjalan pada detik migrations/036 diterapkan --
   * diam-diam, sebagai efek samping penambahan fitur.
   */
  it('0 berarti TANPA BATAS, bukan nol pesan', () => {
    expect(bolehKirimKePasien(TANPA_BATAS, 0)).toEqual({ boleh: true, sisa: null });
    expect(bolehKirimKePasien(TANPA_BATAS, 9_999)).toEqual({ boleh: true, sisa: null });
  });

  it('nilai negatif diperlakukan sama seperti tanpa batas', () => {
    // Satu-satunya cara membatasi adalah menuliskan angka positif dengan
    // sengaja; nilai aneh tidak boleh diam-diam menghentikan pengiriman.
    expect(bolehKirimKePasien(-5, 100).boleh).toBe(true);
    expect(bolehKirimKePasien(Number.NaN, 100).boleh).toBe(true);
  });

  it('melolosikan tepat sebanyak batasnya, lalu berhenti', () => {
    expect(bolehKirimKePasien(3, 0)).toEqual({ boleh: true, sisa: 2 });
    expect(bolehKirimKePasien(3, 1)).toEqual({ boleh: true, sisa: 1 });
    expect(bolehKirimKePasien(3, 2)).toEqual({ boleh: true, sisa: 0 });
    expect(bolehKirimKePasien(3, 3)).toEqual({ boleh: false, sisa: 0 });
  });

  it('terpakai melebihi batas tetap ditolak, bukan berputar', () => {
    // Bisa terjadi bila batasnya DITURUNKAN staf di tengah hari yang sudah
    // ramai. Yang benar adalah berhenti, bukan menghitung sisa negatif lalu
    // meloloskannya.
    expect(bolehKirimKePasien(3, 10)).toEqual({ boleh: false, sisa: 0 });
  });

  it('batas 1 meloloskan tepat satu', () => {
    expect(bolehKirimKePasien(1, 0)).toEqual({ boleh: true, sisa: 0 });
    expect(bolehKirimKePasien(1, 1).boleh).toBe(false);
  });

  it('terpakai yang tidak masuk akal dianggap nol, bukan menjatuhkan hitungan', () => {
    expect(bolehKirimKePasien(5, -3)).toEqual({ boleh: true, sisa: 4 });
    expect(bolehKirimKePasien(5, Number.NaN)).toEqual({ boleh: true, sisa: 4 });
  });
});

describe('batasSah', () => {
  it('menerima 0 sampai batas maksimal', () => {
    expect(batasSah(0)).toBe(true);
    expect(batasSah(1)).toBe(true);
    expect(batasSah(BATAS_MAKSIMAL)).toBe(true);
  });

  it('menolak yang di atas maksimal', () => {
    // Di atas ini ia bukan lagi uji terbatas, dan yang sebenarnya diinginkan
    // adalah mematikan batasnya (0). Angka raksasa yang tersimpan membuat
    // halaman menampilkan "uji terbatas aktif" untuk pemicu yang praktis tanpa
    // batas -- keterangan yang membohongi pembacanya sendiri.
    expect(batasSah(BATAS_MAKSIMAL + 1)).toBe(false);
  });

  it('menolak negatif dan pecahan', () => {
    expect(batasSah(-1)).toBe(false);
    expect(batasSah(2.5)).toBe(false);
  });
});
