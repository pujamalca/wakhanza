import {
  bacaTanggalKirim,
  bulanRekap,
  bulanSebelum,
  bulanSesudah,
  bulanJatuhTempo,
  labelBulan,
  TANGGAL_KIRIM_MAKS,
  JAM_REKAP_BULANAN_BAWAAN,
} from './rekapBulan';

/**
 * Yang dijaga di sini adalah PERILAKU DI BATAS -- pergantian tahun, Februari,
 * worker yang mengejar rekap terlewat, penanda yang lebih baru daripada target.
 * Membuktikannya lewat database berarti menunggu keadaan itu benar-benar terjadi,
 * dan sebagiannya cuma sekali setahun.
 */

describe('bacaTanggalKirim', () => {
  it('menerima 1 sampai 28', () => {
    expect(bacaTanggalKirim(1)).toBe(1);
    expect(bacaTanggalKirim('3')).toBe(3);
    expect(bacaTanggalKirim(' 28 ')).toBe(28);
  });

  it('MENOLAK 29-31, karena Februari tidak punya tanggal itu', () => {
    // Menjepitnya ke 28 akan membuat setelan tersimpan berbeda dari yang
    // dijalankan; menolaknya membuat staf memilih tanggal yang benar-benar ada.
    expect(bacaTanggalKirim(29)).toBeNull();
    expect(bacaTanggalKirim(31)).toBeNull();
  });

  it('menolak nol, negatif, pecahan, dan yang bukan angka', () => {
    expect(bacaTanggalKirim(0)).toBeNull();
    expect(bacaTanggalKirim(-1)).toBeNull();
    expect(bacaTanggalKirim(2.5)).toBeNull();
    expect(bacaTanggalKirim('besok')).toBeNull();
    expect(bacaTanggalKirim('')).toBeNull();
    expect(bacaTanggalKirim(null)).toBeNull();
  });
});

describe('bulanRekap', () => {
  it('mengembalikan bulan SEBELUM bulan berjalan', () => {
    expect(bulanRekap(new Date(2026, 7, 3))).toBe('202607');
  });

  it('menyeberangi pergantian tahun', () => {
    expect(bulanRekap(new Date(2026, 0, 5))).toBe('202512');
  });

  it('BENAR pada tanggal 29-31, tempat setMonth meluber', () => {
    // Ini yang dijaga `d.setDate(1)`: tanpa itu, 31 Maret dikurangi sebulan
    // menghasilkan 3 Maret (Februari tidak punya tanggal 31), sehingga rekapnya
    // menyebut bulan yang keliru. Keadaan ini nyata saat worker mengejar rekap
    // yang terlewat -- `sekarang` di sana jam dinding sungguhan.
    expect(bulanRekap(new Date(2026, 2, 31))).toBe('202602');
    expect(bulanRekap(new Date(2026, 4, 31))).toBe('202604');
    expect(bulanRekap(new Date(2026, 6, 31))).toBe('202606');
  });

  it('menangani Februari dari Maret', () => {
    expect(bulanRekap(new Date(2026, 2, 1))).toBe('202602');
  });
});

describe('bulanSesudah', () => {
  it('maju satu bulan', () => {
    expect(bulanSesudah('202607')).toBe('202608');
  });

  it('menyeberangi pergantian tahun', () => {
    expect(bulanSesudah('202512')).toBe('202601');
  });

  it('mempertahankan bentuk dua digit', () => {
    expect(bulanSesudah('202608')).toBe('202609');
    expect(bulanSesudah('202609')).toBe('202610');
  });
});

describe('bulanSebelum', () => {
  it('mundur satu bulan', () => {
    expect(bulanSebelum('202607')).toBe('202606');
  });

  it('menyeberangi pergantian tahun', () => {
    expect(bulanSebelum('202601')).toBe('202512');
  });

  it('mundur beberapa bulan sekaligus, termasuk melewati Januari', () => {
    // Jendela picker "kecualikan tindakan" memakai bentuk ini: tiga bulan
    // terakhir termasuk bulan berjalan.
    expect(bulanSebelum('202608', 2)).toBe('202606');
    expect(bulanSebelum('202602', 2)).toBe('202512');
    expect(bulanSebelum('202601', 12)).toBe('202501');
  });

  it('bulan Desember dan Januari tidak meluber', () => {
    // `setMonth()` pada tanggal 31 meluber ke bulan berikutnya; aritmetika di
    // sini murni bilangan, jadi jebakan itu tidak punya tempat untuk hidup.
    expect(bulanSebelum('202612')).toBe('202611');
    expect(bulanSebelum('202603', 2)).toBe('202601');
  });

  it('bentuk yang tidak dikenali dikembalikan apa adanya', () => {
    expect(bulanSebelum('bukan-bulan')).toBe('bukan-bulan');
  });
});

describe('labelBulan', () => {
  it('menerjemahkan ke nama bulan Indonesia', () => {
    expect(labelBulan('202607')).toBe('Juli 2026');
    expect(labelBulan('202601')).toBe('Januari 2026');
    expect(labelBulan('202512')).toBe('Desember 2025');
  });

  it('mengembalikan bentuk asing APA ADANYA, bukan string kosong', () => {
    // Nilainya kita sendiri yang susun, jadi bentuk asing berarti ada yang salah
    // di kode ini -- mengosongkannya menghapus satu-satunya petunjuk ke arahnya.
    expect(labelBulan('bukan-bulan')).toBe('bukan-bulan');
    expect(labelBulan('202613')).toBe('202613');
    expect(labelBulan('202600')).toBe('202600');
  });
});

describe('bulanJatuhTempo', () => {
  const jam = JAM_REKAP_BULANAN_BAWAAN; // 08:00

  it('belum jatuh tempo sebelum tanggal kirim', () => {
    expect(bulanJatuhTempo(new Date(2026, 7, 2, 23, 59), 3, jam, '')).toBeNull();
  });

  it('belum jatuh tempo pada tanggal kirim sebelum jamnya', () => {
    expect(bulanJatuhTempo(new Date(2026, 7, 3, 7, 59), 3, jam, '')).toBeNull();
  });

  it('jatuh tempo tepat pada jamnya', () => {
    expect(bulanJatuhTempo(new Date(2026, 7, 3, 8, 0), 3, jam, '')).toBe('202607');
  });

  it('MENGEJAR rekap yang terlewat, tanpa menunggu jamnya lagi', () => {
    // Worker mati 3-20 Agustus lalu hidup pukul 02:00. Isinya bulan yang sudah
    // tutup, jadi angkanya sama persis -- menahannya sampai 08:00 cuma menunda
    // sesuatu yang sudah terlambat tujuh belas hari.
    expect(bulanJatuhTempo(new Date(2026, 7, 20, 2, 0), 3, jam, '202606')).toBe('202607');
  });

  it('diam bila bulan targetnya sudah tercatat', () => {
    expect(bulanJatuhTempo(new Date(2026, 7, 3, 8, 0), 3, jam, '202607')).toBeNull();
    expect(bulanJatuhTempo(new Date(2026, 7, 25, 12, 0), 3, jam, '202607')).toBeNull();
  });

  it('diam bila penandanya LEBIH BARU daripada target', () => {
    // Jam server yang mundur, atau app_setting yang dipulihkan dari cadangan yang
    // lebih baru. Dengan `!==` ini akan mengirim ulang rekap yang sudah berangkat.
    expect(bulanJatuhTempo(new Date(2026, 7, 5, 9, 0), 3, jam, '202608')).toBeNull();
  });

  it('penanda kosong tidak menahan apa pun', () => {
    expect(bulanJatuhTempo(new Date(2026, 7, 3, 8, 0), 3, jam, null)).toBe('202607');
    expect(bulanJatuhTempo(new Date(2026, 7, 3, 8, 0), 3, jam, '   ')).toBe('202607');
  });

  it('menyeberangi pergantian tahun', () => {
    expect(bulanJatuhTempo(new Date(2026, 0, 3, 8, 0), 3, jam, '202511')).toBe('202512');
  });

  it('tanggal kirim 28 tetap berbunyi di Februari', () => {
    // Alasan batas 28 ada. Tanggal 30 akan melewatkan Februari setiap tahun.
    expect(bulanJatuhTempo(new Date(2026, 1, 28, 8, 0), TANGGAL_KIRIM_MAKS, jam, '')).toBe('202601');
  });

  it('tanggal kirim 1 merekap bulan lalu, bukan dua bulan lalu', () => {
    expect(bulanJatuhTempo(new Date(2026, 7, 1, 8, 0), 1, jam, '')).toBe('202607');
  });
});
