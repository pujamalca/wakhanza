import {
  bacaHariSebelum,
  tulisHariSebelum,
  sasaranKontrol,
  labelSisaHari,
  jatuhTempoHarian,
  tanggalLokal,
  MAX_HARI_SEBELUM,
} from './bpjs';

describe('bacaHariSebelum', () => {
  it('membaca daftar biasa dan mengurutkannya menurun', () => {
    expect(bacaHariSebelum('1,7')).toEqual([7, 1]);
  });

  it('0 sah dan berarti hari-H', () => {
    expect(bacaHariSebelum('3,0')).toEqual([3, 0]);
  });

  it('membuang yang ganda', () => {
    expect(bacaHariSebelum('1,1,7,1')).toEqual([7, 1]);
  });

  it('mengabaikan spasi dan koma berlebih tanpa menggagalkan sisanya', () => {
    expect(bacaHariSebelum(' 7 , , 1 ,')).toEqual([7, 1]);
  });

  it('membuang yang bukan angka, bukan menggagalkan seluruhnya', () => {
    expect(bacaHariSebelum('7,besok,1')).toEqual([7, 1]);
  });

  it('menolak pecahan -- jadwalnya berbutir hari kalender', () => {
    expect(bacaHariSebelum('1.5,2')).toEqual([2]);
  });

  it('menolak negatif (tanda minus bukan digit)', () => {
    expect(bacaHariSebelum('-3,2')).toEqual([2]);
  });

  it('menolak yang melebihi batas', () => {
    expect(bacaHariSebelum(`${MAX_HARI_SEBELUM + 1},${MAX_HARI_SEBELUM}`)).toEqual([MAX_HARI_SEBELUM]);
  });

  it('kosong/null/undefined -> daftar kosong', () => {
    expect(bacaHariSebelum('')).toEqual([]);
    expect(bacaHariSebelum(null)).toEqual([]);
    expect(bacaHariSebelum(undefined)).toEqual([]);
  });

  it('bolak-balik lewat tulisHariSebelum tidak mengubah nilainya', () => {
    const asal = '7,1';
    expect(tulisHariSebelum(bacaHariSebelum(asal))).toBe(asal);
  });
});

describe('sasaranKontrol', () => {
  it('tanggalnya MAJU dari hari ini, bukan mundur', () => {
    const hasil = sasaranKontrol([7, 1], new Date(2026, 7, 5, 10, 0));
    expect(hasil).toEqual([
      { tanggal: '2026-08-12', hariSebelum: 7 },
      { tanggal: '2026-08-06', hariSebelum: 1 },
    ]);
  });

  it('0 menghasilkan hari ini sendiri', () => {
    expect(sasaranKontrol([0], new Date(2026, 7, 5, 23, 30))).toEqual([{ tanggal: '2026-08-05', hariSebelum: 0 }]);
  });

  it('melewati pergantian bulan', () => {
    expect(sasaranKontrol([3], new Date(2026, 7, 30, 9, 0))[0]?.tanggal).toBe('2026-09-02');
  });

  it('melewati pergantian tahun', () => {
    expect(sasaranKontrol([5], new Date(2026, 11, 29, 9, 0))[0]?.tanggal).toBe('2027-01-03');
  });

  it('menangani 29 Februari tahun kabisat', () => {
    // 2028 kabisat: 27 Feb + 2 hari = 29 Feb, bukan 1 Maret.
    expect(sasaranKontrol([2], new Date(2028, 1, 27, 9, 0))[0]?.tanggal).toBe('2028-02-29');
  });

  it('jam pada hari ini tidak menggeser tanggal hasilnya', () => {
    const pagi = sasaranKontrol([1], new Date(2026, 7, 5, 0, 1));
    const malam = sasaranKontrol([1], new Date(2026, 7, 5, 23, 59));
    expect(pagi).toEqual(malam);
  });
});

describe('labelSisaHari', () => {
  it('0 dibaca "hari ini", bukan "0 hari lagi"', () => {
    expect(labelSisaHari(0)).toBe('hari ini');
  });

  it('1 dibaca "besok"', () => {
    expect(labelSisaHari(1)).toBe('besok');
  });

  it('selebihnya berbentuk "N hari lagi"', () => {
    expect(labelSisaHari(7)).toBe('7 hari lagi');
  });
});

describe('jatuhTempoHarian', () => {
  const jam9 = new Date(2026, 7, 5, 9, 0);

  it('belum sampai jam kirim -> belum jatuh tempo', () => {
    expect(jatuhTempoHarian(new Date(2026, 7, 5, 8, 59), 9, null)).toBe(false);
  });

  it('sudah jam kirim dan belum pernah jalan -> jatuh tempo', () => {
    expect(jatuhTempoHarian(jam9, 9, null)).toBe(true);
  });

  it('sudah jalan hari ini -> tidak diulang', () => {
    expect(jatuhTempoHarian(jam9, 9, '2026-08-05')).toBe(false);
  });

  it('terakhir jalan kemarin -> jatuh tempo lagi', () => {
    expect(jatuhTempoHarian(jam9, 9, '2026-08-04')).toBe(true);
  });

  it('penanda menunjuk MASA DEPAN tetap dianggap jatuh tempo', () => {
    // Jam server sempat maju lalu dikoreksi. Memperlakukannya sebagai "sudah
    // jalan" akan mendiamkan pengingat sampai tanggal itu benar-benar tiba.
    expect(jatuhTempoHarian(jam9, 9, '2026-09-01')).toBe(true);
  });

  it('penanda kosong sama dengan belum pernah jalan', () => {
    expect(jatuhTempoHarian(jam9, 9, '')).toBe(true);
  });
});

describe('tanggalLokal', () => {
  it('memakai komponen lokal, bukan UTC', () => {
    // 1 Januari 2026 pukul 00:30 WIB masih 31 Desember 2025 dalam UTC.
    // Memakai toISOString() di sini akan menggeser tanggalnya satu hari.
    expect(tanggalLokal(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });

  it('memberi nol di depan untuk bulan dan tanggal satu digit', () => {
    expect(tanggalLokal(new Date(2026, 2, 7))).toBe('2026-03-07');
  });
});
