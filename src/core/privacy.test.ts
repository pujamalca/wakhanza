import { checkPrivacy } from './privacy';

describe('checkPrivacy', () => {
  it('aman bila daftar sensitif kosong', () => {
    expect(checkPrivacy({ kdPoli: 'U0012' }, [])).toEqual({ safe: true });
  });

  it('tidak aman bila kd_poli ada di daftar sensitif', () => {
    expect(checkPrivacy({ kdPoli: 'U0099' }, ['U0099'])).toEqual({
      safe: false,
      reason: 'poli_sensitif:U0099',
    });
  });

  it('aman bila kd_poli tidak ada di daftar sensitif', () => {
    expect(checkPrivacy({ kdPoli: 'U0012' }, ['U0099'])).toEqual({ safe: true });
  });

  it('tidak aman bila kd_jenis_prw ada di daftar pemeriksaan sensitif', () => {
    expect(checkPrivacy({ kdJenisPrw: 'LAB001' }, [], ['LAB001'])).toEqual({
      safe: false,
      reason: 'pemeriksaan_sensitif:LAB001',
    });
  });

  it('aman bila kd_poli dan kd_jenis_prw tidak diisi', () => {
    expect(checkPrivacy({}, ['U0099'], ['LAB001'])).toEqual({ safe: true });
  });

  it('hasil penunjang: tidak aman bila SALAH SATU dari beberapa kode pemeriksaan sensitif', () => {
    expect(checkPrivacy({ kdJenisPrw: ['LAB010', 'LAB001', 'LAB020'] }, [], ['LAB001'])).toEqual({
      safe: false,
      reason: 'pemeriksaan_sensitif:LAB001',
    });
  });

  it('hasil penunjang: aman bila semua kode dalam larik tidak sensitif', () => {
    expect(checkPrivacy({ kdJenisPrw: ['LAB010', 'LAB020'] }, [], ['LAB001'])).toEqual({ safe: true });
  });
});
