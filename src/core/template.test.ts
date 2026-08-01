import {
  renderTemplate,
  findUnknownVariables,
  sanitizeValue,
  extractVariables,
  AUTOREPLY_TEMPLATE_VARIABLES,
} from './template';

describe('renderTemplate', () => {
  it('mengganti variabel yang dikenal', () => {
    const out = renderTemplate('Bpk/Ibu {nama_pasien}, no antrian Anda {no_antrian}.', {
      nama_pasien: 'Budi',
      no_antrian: '007',
    });
    expect(out).toBe('Bpk/Ibu Budi, no antrian Anda 007.');
  });

  it('mengganti variabel tak terisi dengan string kosong', () => {
    const out = renderTemplate('Halo {nama_pasien}', {});
    expect(out).toBe('Halo ');
  });

  it('TIDAK memindai ulang hasil substitusi (satu lintasan) — pasien bernama {kontak_rs}', () => {
    // Kasus ARCHITECTURE §9.2: nama pasien berisi pola variabel lain.
    const out = renderTemplate('Halo {nama_pasien}, hubungi {kontak_rs}.', {
      nama_pasien: '{kontak_rs}',
      kontak_rs: '0800-000-000',
    });
    // Nama pasien tercetak APA ADANYA sebagai teks "{kontak_rs}", bukan tergantikan
    // jadi nomor telepon RS yang sesungguhnya.
    expect(out).toBe('Halo {kontak_rs}, hubungi 0800-000-000.');
  });

  it('tidak meledak melawan reference berantai antar variabel', () => {
    const out = renderTemplate('{a} {b}', { a: '{b}', b: '{a}' } as never);
    expect(out).toBe('{b} {a}');
  });

  it('membersihkan karakter kendali dan baris baru dari nilai', () => {
    const out = renderTemplate('Nama: {nama_pasien}', { nama_pasien: 'Budi\n\nPESAN PALSU\r\nDari Admin' });
    expect(out).toBe('Nama: Budi PESAN PALSU Dari Admin');
  });

  it('membatasi panjang nilai', () => {
    const long = 'A'.repeat(100);
    const out = renderTemplate('{nama_pasien}', { nama_pasien: long });
    expect(out.length).toBe(60);
  });
});

describe('findUnknownVariables', () => {
  it('mengembalikan larik kosong bila semua variabel dikenal', () => {
    expect(findUnknownVariables('Halo {nama_pasien}, RM {no_rm}')).toEqual([]);
  });

  it('mendeteksi variabel yang tidak dikenal', () => {
    expect(findUnknownVariables('Halo {nama_pasien}, {variabel_ngawur}')).toEqual(['variabel_ngawur']);
  });
});

describe('extractVariables', () => {
  it('mengembalikan nama unik tanpa duplikat', () => {
    expect(extractVariables('{a} {b} {a}')).toEqual(['a', 'b']);
  });
});

describe('sanitizeValue', () => {
  it('merapikan spasi berlebih', () => {
    expect(sanitizeValue('Budi   Santoso')).toBe('Budi Santoso');
  });

  it('membuang karakter kendali', () => {
    expect(sanitizeValue('Budi\x00\x1FSantoso')).toBe('Budi Santoso');
  });
});

describe('variabel jadwal berbaris banyak', () => {
  const jadwal = '*Senin*\n- 14.01-20.00  dr. Rita (Poliklinik Jantung)';

  it('mempertahankan baris baru -- sanitizeValue justru membuangnya', () => {
    expect(renderTemplate('Jadwal:\n\n{jadwal_dokter}', { jadwal_dokter: jadwal })).toBe(`Jadwal:\n\n${jadwal}`);
  });

  it('tidak dipotong di 60 karakter seperti nilai biasa', () => {
    const panjang = Array.from({ length: 10 }, (_, i) => `- baris ke-${i} yang cukup panjang`).join('\n');
    expect(renderTemplate('{jadwal_dokter}', { jadwal_dokter: panjang })).toBe(panjang);
  });

  it('variabel BIASA tetap disanitasi, pengecualiannya tidak bocor', () => {
    expect(renderTemplate('{nama_pasien}', { nama_pasien: 'Budi\nSantoso' })).toBe('Budi Santoso');
  });

  it('aturan satu lintasan tetap berlaku: {kontak_rs} di dalam jadwal tidak ikut diganti', () => {
    const jahat = '- 08.00  dr. {kontak_rs}';
    expect(
      renderTemplate('{jadwal_dokter}\nKontak: {kontak_rs}', { jadwal_dokter: jahat, kontak_rs: '0751-123' }),
    ).toBe('- 08.00  dr. {kontak_rs}\nKontak: 0751-123');
  });
});

describe('daftar variabel per konteks', () => {
  it('template pemicu menolak variabel khusus balasan otomatis', () => {
    expect(findUnknownVariables('{jadwal_dokter}')).toEqual(['jadwal_dokter']);
  });

  it('template balasan otomatis menerimanya', () => {
    expect(findUnknownVariables('{jadwal_dokter} {daftar_poli}', AUTOREPLY_TEMPLATE_VARIABLES)).toEqual([]);
  });

  it('balasan otomatis menolak {nama_pasien} -- pengirimnya belum tentu pasien terdaftar', () => {
    expect(findUnknownVariables('{nama_pasien}', AUTOREPLY_TEMPLATE_VARIABLES)).toEqual(['nama_pasien']);
  });
});
