import { formatDurationSeconds, msSettingToSeconds, secondsToMsSetting } from './duration';

describe('formatDurationSeconds', () => {
  it('memakai satu desimal untuk kisaran kirim yang normal', () => {
    expect(formatDurationSeconds(311)).toBe('0,3 s');
    expect(formatDurationSeconds(1200)).toBe('1,2 s');
    expect(formatDurationSeconds(8449)).toBe('8,4 s');
  });

  it('memakai koma, bukan titik, sebagai pemisah desimal', () => {
    expect(formatDurationSeconds(1500)).not.toContain('.');
  });

  it('tidak membulatkan yang sangat cepat menjadi "0,0 s"', () => {
    // 0,0 s terbaca seperti nol atau gagal; yang sebenarnya terjadi adalah
    // "lebih cepat dari satuan terkecil yang ditampilkan".
    expect(formatDurationSeconds(4)).toBe('<0,1 s');
    expect(formatDurationSeconds(49)).toBe('<0,1 s');
    expect(formatDurationSeconds(50)).toBe('0,1 s');
  });

  it('membuang desimal di atas 10 detik', () => {
    expect(formatDurationSeconds(10_000)).toBe('10 s');
    expect(formatDurationSeconds(12_340)).toBe('12 s');
    expect(formatDurationSeconds(75_600)).toBe('76 s');
  });

  it('tidak pernah menghasilkan angka negatif atau NaN', () => {
    expect(formatDurationSeconds(0)).toBe('0 s');
    expect(formatDurationSeconds(-5)).toBe('0 s');
    expect(formatDurationSeconds(Number.NaN)).toBe('0 s');
  });
});

describe('konversi satuan pengaturan', () => {
  it('menampilkan nilai bawaan sebagai detik bulat', () => {
    expect(msSettingToSeconds('60000')).toBe('60');
    expect(msSettingToSeconds('300000')).toBe('300');
    expect(msSettingToSeconds('3000')).toBe('3');
    expect(msSettingToSeconds('8000')).toBe('8');
  });

  it('menampilkan pecahan dengan koma', () => {
    expect(msSettingToSeconds('1500')).toBe('1,5');
    expect(msSettingToSeconds('1')).toBe('0,001');
  });

  it('menerima koma maupun titik saat mengetik', () => {
    expect(secondsToMsSetting('1,5')).toBe('1500');
    expect(secondsToMsSetting('1.5')).toBe('1500');
    expect(secondsToMsSetting(' 60 ')).toBe('60000');
  });

  it('bolak-balik tanpa berubah untuk semua nilai bawaan', () => {
    // Form Pengaturan mengirim ulang SEMUA kunci saat disimpan, termasuk yang
    // tidak disentuh -- konversi yang tidak persis kebalikannya akan menggeser
    // nilai sedikit demi sedikit setiap kali halaman disimpan.
    for (const stored of ['60000', '300000', '3000', '8000', '1500', '0', '1']) {
      expect(secondsToMsSetting(msSettingToSeconds(stored))).toBe(stored);
    }
  });

  it('meneruskan nilai non-angka apa adanya, tidak menjadikannya 0/NaN', () => {
    for (const aneh of ['', '   ', 'abc', '-500', '1e3', '60000 ms']) {
      expect(msSettingToSeconds(aneh)).toBe(aneh);
      expect(secondsToMsSetting(aneh)).toBe(aneh);
    }
  });
});
