import { bandingkanPantau, bagiKuota, type BarisPantau } from './pantauPenjualan';

const JENDELA = { awal: 'PJ20260805000', akhir: 'PJ20260819999' };

function pantau(nota: string, hapusAt: Date | null = null, generasi = 0): BarisPantau {
  return { notaJual: nota, generasi, hapusAt };
}

describe('bandingkanPantau', () => {
  it('nota yang belum pernah dicatat dianggap BARU, generasi 0', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260810001', 'PJ20260810002'],
      pantau: [],
      jendela: JENDELA,
    });
    expect(hasil.baru).toEqual([
      { notaJual: 'PJ20260810001', generasi: 0 },
      { notaJual: 'PJ20260810002', generasi: 0 },
    ]);
    expect(hasil.terhapus).toEqual([]);
  });

  it('nota yang sudah dicatat dan masih ada TIDAK dikabarkan lagi', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260810001'],
      pantau: [pantau('PJ20260810001')],
      jendela: JENDELA,
    });
    expect(hasil.baru).toEqual([]);
    expect(hasil.terhapus).toEqual([]);
  });

  it('nota yang dicatat tapi hilang dari jendela = TERHAPUS', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260810001'],
      pantau: [pantau('PJ20260810001'), pantau('PJ20260810002')],
      jendela: JENDELA,
    });
    expect(hasil.terhapus).toEqual(['PJ20260810002']);
    expect(hasil.baru).toEqual([]);
  });

  /**
   * Pagar terpenting di berkas ini. Tanpa syarat "di dalam jendela", setiap nota
   * yang menua keluar dari jendela lalu dilaporkan sebagai pembatalan -- kabar
   * SALAH atas penjualan yang masih hidup, bukan sekadar kabar yang hilang.
   */
  it('nota di LUAR jendela tidak pernah dilaporkan terhapus walau ada di buku pantau', () => {
    const hasil = bandingkanPantau({
      hadir: [],
      pantau: [pantau('PJ20260701001'), pantau('PJ20260901001')],
      jendela: JENDELA,
    });
    expect(hasil.terhapus).toEqual([]);
  });

  it('nota di LUAR jendela tidak pernah dilaporkan baru walau ada di penjualan', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260701001', 'PJ20260901001'],
      pantau: [],
      jendela: JENDELA,
    });
    expect(hasil.baru).toEqual([]);
  });

  it('penghapusan yang SUDAH dikabarkan tidak dikabarkan dua kali', () => {
    const hasil = bandingkanPantau({
      hadir: [],
      pantau: [pantau('PJ20260810002', new Date('2026-08-11T03:00:00Z'))],
      jendela: JENDELA,
    });
    expect(hasil.terhapus).toEqual([]);
    expect(hasil.baru).toEqual([]);
  });

  it('nomor yang dipakai ULANG sesudah dihapus jadi BARU dengan generasi naik', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260810002'],
      pantau: [pantau('PJ20260810002', new Date('2026-08-11T03:00:00Z'), 0)],
      jendela: JENDELA,
    });
    expect(hasil.baru).toEqual([{ notaJual: 'PJ20260810002', generasi: 1 }]);
    expect(hasil.terhapus).toEqual([]);
  });

  it('generasi terus naik pada pemakaian ulang berikutnya', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260810002'],
      pantau: [pantau('PJ20260810002', new Date('2026-08-11T03:00:00Z'), 3)],
      jendela: JENDELA,
    });
    expect(hasil.baru).toEqual([{ notaJual: 'PJ20260810002', generasi: 4 }]);
  });

  it('batas jendela inklusif di kedua ujungnya', () => {
    const hasil = bandingkanPantau({
      hadir: [JENDELA.awal, JENDELA.akhir],
      pantau: [],
      jendela: JENDELA,
    });
    expect(hasil.baru.map((b) => b.notaJual)).toEqual([JENDELA.awal, JENDELA.akhir]);
  });

  it('keduanya terurut menurut nomor, bukan urutan masukan', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260812003', 'PJ20260810001'],
      pantau: [pantau('PJ20260815009'), pantau('PJ20260811004')],
      jendela: JENDELA,
    });
    expect(hasil.baru.map((b) => b.notaJual)).toEqual(['PJ20260810001', 'PJ20260812003']);
    expect(hasil.terhapus).toEqual(['PJ20260811004', 'PJ20260815009']);
  });

  it('baris pantau ganda untuk nomor yang sama tidak menghasilkan kabar ganda', () => {
    const hasil = bandingkanPantau({
      hadir: [],
      pantau: [pantau('PJ20260810002'), pantau('PJ20260810002')],
      jendela: JENDELA,
    });
    expect(hasil.terhapus).toEqual(['PJ20260810002']);
  });

  it('nota yang muncul dua kali di penjualan tidak dikabarkan dua kali', () => {
    const hasil = bandingkanPantau({
      hadir: ['PJ20260810001', 'PJ20260810001'],
      pantau: [],
      jendela: JENDELA,
    });
    expect(hasil.baru).toEqual([{ notaJual: 'PJ20260810001', generasi: 0 }]);
  });
});

describe('bagiKuota', () => {
  const hasil = {
    baru: [
      { notaJual: 'PJ20260810001', generasi: 0 },
      { notaJual: 'PJ20260810002', generasi: 0 },
      { notaJual: 'PJ20260810003', generasi: 0 },
    ],
    terhapus: ['PJ20260809001', 'PJ20260809002'],
  };

  it('penghapusan didahulukan, sisanya untuk yang baru', () => {
    expect(bagiKuota(hasil, 3)).toEqual({
      terhapus: ['PJ20260809001', 'PJ20260809002'],
      baru: [{ notaJual: 'PJ20260810001', generasi: 0 }],
    });
  });

  it('kuota yang habis di penghapusan menyisakan nol untuk yang baru', () => {
    expect(bagiKuota(hasil, 2)).toEqual({
      terhapus: ['PJ20260809001', 'PJ20260809002'],
      baru: [],
    });
  });

  it('kuota lebih kecil daripada jumlah penghapusan memotong penghapusannya juga', () => {
    expect(bagiKuota(hasil, 1)).toEqual({ terhapus: ['PJ20260809001'], baru: [] });
  });

  it('kuota nol atau negatif tidak meloloskan apa pun', () => {
    expect(bagiKuota(hasil, 0)).toEqual({ terhapus: [], baru: [] });
    expect(bagiKuota(hasil, -5)).toEqual({ terhapus: [], baru: [] });
  });

  it('kuota berlebih meloloskan seluruhnya', () => {
    expect(bagiKuota(hasil, 99)).toEqual(hasil);
  });
});
