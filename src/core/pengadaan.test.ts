import {
  formatRupiah,
  formatTanggalBeli,
  formatDaftarBarang,
  pecahDaftarBarang,
  kelompokkanDetail,
  BATAS_KARAKTER_PENGADAAN,
  type BarisDetailPengadaan,
} from './pengadaan';

function item(nama: string, extra: Partial<BarisDetailPengadaan> = {}): BarisDetailPengadaan {
  return { no_faktur: 'PG20260807001', kode_brng: 'B000000001', nama_brng: nama, satuan: 'Botol', jumlah: 10, ...extra };
}

describe('formatRupiah', () => {
  it('memberi pemisah ribuan gaya Indonesia', () => {
    expect(formatRupiah(1405320)).toBe('Rp1.405.320');
    expect(formatRupiah(0)).toBe('Rp0');
  });

  it('menerima string, karena double MySQL bisa menyeberang sebagai string', () => {
    expect(formatRupiah('950000')).toBe('Rp950.000');
  });

  /**
   * Yang bukan angka WAJIB jadi string kosong, bukan "RpNaN". Pesan yang memuat
   * NaN terbaca sebagai sistem rusak, dan sejak itu angka yang benar pun tidak
   * dipercaya -- kegagalan yang sama jenisnya dengan penanda '0000-00-00' yang
   * diteruskan apa adanya.
   */
  it('mengembalikan kosong untuk nilai yang bukan angka', () => {
    expect(formatRupiah(null)).toBe('');
    expect(formatRupiah(undefined)).toBe('');
    expect(formatRupiah('')).toBe('');
    expect(formatRupiah('bukan angka')).toBe('');
  });
});

describe('formatTanggalBeli', () => {
  it('membalik YYYY-MM-DD jadi DD-MM-YYYY', () => {
    expect(formatTanggalBeli('2026-08-07')).toBe('07-08-2026');
  });

  it('membuang penanda kosong Khanza alih-alih meneruskannya', () => {
    expect(formatTanggalBeli('0000-00-00')).toBe('');
    expect(formatTanggalBeli(null)).toBe('');
    expect(formatTanggalBeli('')).toBe('');
  });
});

describe('formatDaftarBarang', () => {
  it('menyebut jumlah dan satuan', () => {
    expect(formatDaftarBarang([item('Spuit 3 cc')])).toBe('• Spuit 3 cc — 10 Botol');
  });

  /**
   * Harga muncul HANYA bila kolomnya ikut di-SELECT, dan itu diperiksa lewat
   * `undefined` -- bukan lewat flag terpisah. Dengan begitu "harga tidak
   * ditampilkan" dan "harga tidak pernah dibaca dari sik" adalah satu keadaan
   * yang sama, dan tidak mungkin salah satunya benar sementara yang lain tidak.
   */
  it('mencetak harga saat kolomnya ada', () => {
    expect(formatDaftarBarang([item('Spuit 3 cc', { h_beli: 2000, total: 20000 })])).toBe(
      '• Spuit 3 cc — 10 Botol @ Rp2.000 = Rp20.000',
    );
  });

  it('sama sekali tidak menyinggung harga saat kolomnya absen', () => {
    const teks = formatDaftarBarang([item('Spuit 3 cc')]);
    expect(teks).not.toContain('Rp');
    expect(teks).not.toContain('@');
  });

  /**
   * `{daftar_barang}` DIKECUALIKAN dari sanitasi (MULTILINE_VARIABLES), jadi
   * setiap baris baru pada hasil akhir wajib berasal dari kode kita. Nama barang
   * diketik bebas petugas gudang di Khanza; satu nama berisi baris baru bisa
   * menyisipkan barisnya sendiri ke dalam pesan -- persis lubang §9.2.
   */
  it('membuang baris baru dari nama barang yang diketik petugas', () => {
    const jahat = item('Paracetamol\n• Morfin — 999 Botol');
    const teks = formatDaftarBarang([jahat]);
    expect(teks.split('\n')).toHaveLength(1);
  });

  it('membuang baris baru dari satuan juga', () => {
    const teks = formatDaftarBarang([item('Spuit', { satuan: 'Box\nPalsu' })]);
    expect(teks.split('\n')).toHaveLength(1);
  });

  /** Barang tanpa nama tetap harus bisa dikenali; kodenya yang menggantikan. */
  it('jatuh ke kode barang saat namanya kosong', () => {
    expect(formatDaftarBarang([item('', { kode_brng: 'B000009999' })])).toContain('B000009999');
  });

  it('satu baris per barang', () => {
    const teks = formatDaftarBarang([item('A'), item('B'), item('C')]);
    expect(teks.split('\n')).toHaveLength(3);
  });
});

describe('pecahDaftarBarang', () => {
  it('tidak memecah daftar yang muat, dan tidak menandainya "bagian"', () => {
    const bagian = pecahDaftarBarang([item('A'), item('B')], BATAS_KARAKTER_PENGADAAN);
    expect(bagian).toHaveLength(1);
    expect(bagian[0]).not.toContain('bagian');
  });

  it('daftar kosong menghasilkan nol bagian, bukan satu bagian kosong', () => {
    expect(pecahDaftarBarang([], BATAS_KARAKTER_PENGADAAN)).toEqual([]);
  });

  it('memecah dan menandai tiap bagian saat melewati batas', () => {
    const rows = Array.from({ length: 40 }, (_, i) => item(`Barang nomor ${i} dengan nama yang cukup panjang`));
    const bagian = pecahDaftarBarang(rows, 400);
    expect(bagian.length).toBeGreaterThan(1);
    for (const [i, b] of bagian.entries()) {
      expect(b).toContain(`bagian ${i + 1} dari ${bagian.length}`);
    }
  });

  /**
   * Tidak boleh ada satu barang pun yang hilang saat terpecah. Daftar pengadaan
   * adalah catatan barang yang benar-benar dibeli; satu baris yang menguap saat
   * pemecahan tidak meninggalkan galat apa pun -- yang terlihat cuma nota yang
   * isinya kurang.
   */
  it('tidak pernah kehilangan satu barang pun saat terpecah', () => {
    const rows = Array.from({ length: 40 }, (_, i) => item(`Barang ke-${i}`));
    const gabung = pecahDaftarBarang(rows, 300).join('\n');
    for (let i = 0; i < 40; i++) expect(gabung).toContain(`Barang ke-${i}`);
  });

  /** Satu baris barang tidak boleh terbelah di tengah walau batasnya konyol. */
  it('berhenti walau batasnya lebih kecil daripada satu baris', () => {
    const rows = [item('Nama yang jauh lebih panjang daripada batasnya'), item('Kedua')];
    const bagian = pecahDaftarBarang(rows, 5);
    expect(bagian).toHaveLength(2);
    expect(bagian[0]).toContain('Nama yang jauh lebih panjang daripada batasnya');
  });
});

describe('kelompokkanDetail', () => {
  it('memisahkan rincian beberapa faktur yang datang dari satu query IN', () => {
    const rows = [
      item('A', { no_faktur: 'PG20260807001' }),
      item('B', { no_faktur: 'PG20260807002' }),
      item('C', { no_faktur: 'PG20260807001' }),
    ];
    const peta = kelompokkanDetail(rows);
    expect(peta.get('PG20260807001')?.map((r) => r.nama_brng)).toEqual(['A', 'C']);
    expect(peta.get('PG20260807002')?.map((r) => r.nama_brng)).toEqual(['B']);
  });

  /**
   * `Map`, bukan objek biasa. Nomor faktur datang dari database, dan objek biasa
   * punya kunci bawaan yang bisa bertabrakan dengannya -- `{}['constructor']`
   * menjawab sebuah fungsi, bukan undefined.
   */
  it('tidak bisa tertipu oleh kunci bawaan objek', () => {
    const peta = kelompokkanDetail([item('A', { no_faktur: 'constructor' })]);
    expect(peta.get('constructor')).toHaveLength(1);
    expect(peta.get('__proto__')).toBeUndefined();
    expect(peta.get('toString')).toBeUndefined();
  });

  it('daftar kosong menghasilkan peta kosong', () => {
    expect(kelompokkanDetail([]).size).toBe(0);
  });
});
