import {
  gabungRekap,
  formatRincianJenis,
  bacaJamRekap,
  tulisJamRekap,
  hariRekap,
  JAM_REKAP_BAWAAN,
  type BarisRekapHeader,
  type BarisRekapItem,
} from './penjualanRekap';

function header(jenis: string, ubah: Partial<BarisRekapHeader> = {}): BarisRekapHeader {
  return { jns_jual: jenis, jml_nota: 1, ppn: 0, penyesuaian: 0, ...ubah };
}

function item(jenis: string, ubah: Partial<BarisRekapItem> = {}): BarisRekapItem {
  return { jns_jual: jenis, jml_baris: 1, jml_barang: 1, subtotal: 0, ...ubah };
}

describe('gabungRekap', () => {
  it('menjumlahkan kedua sisi per jenis', () => {
    const r = gabungRekap(
      [header('Jual Bebas', { jml_nota: 31, ppn: 0, penyesuaian: -17336 })],
      [item('Jual Bebas', { jml_baris: 61, jml_barang: 459, subtotal: 747336 })],
    );
    expect(r.jmlNota).toBe(31);
    expect(r.jmlBaris).toBe(61);
    expect(r.jmlBarang).toBe(459);
    expect(r.subtotal).toBe(747336);
    expect(r.penyesuaian).toBe(-17336);
    expect(r.total).toBe(747336 - 17336);
    expect(r.kosong).toBe(false);
  });

  /**
   * REGRESI atas mode kegagalan yang membuat query ini sengaja DUA, bukan satu.
   *
   * Satu query yang menjoinkan `penjualan` dengan `detailjual` lalu menjumlahkan
   * semuanya akan menghitung `ppn` dan `ongkir` SEKALI PER BARANG, bukan sekali
   * per nota -- nota berisi 5 barang menyumbang penyesuaiannya lima kali. Tidak
   * ada galat yang muncul; cuma angka total yang keliru dan tidak akan pernah
   * cocok dengan layar Khanza.
   *
   * Di sini: satu nota, lima baris rincian. Penyesuaiannya harus tetap 1.000.
   */
  it('menghitung penyesuaian sekali per NOTA, bukan sekali per barang', () => {
    const r = gabungRekap(
      [header('Jual Bebas', { jml_nota: 1, penyesuaian: 1000, ppn: 500 })],
      [item('Jual Bebas', { jml_baris: 5, jml_barang: 12, subtotal: 50000 })],
    );
    expect(r.penyesuaian).toBe(1000);
    expect(r.ppn).toBe(500);
    expect(r.total).toBe(51500);
  });

  /**
   * Nota tanpa satu baris rincian pun benar-benar ada -- terukur 1 dari 16.787
   * di database ini. Membuangnya membuat `jumlah_nota` di rekap tidak cocok
   * dengan jumlah nota yang sungguhan, dan selisih satu nota pada angka yang
   * dipakai mencocokkan kas adalah selisih yang harus dicari orang.
   */
  it('mempertahankan jenis yang hanya muncul di sisi nota', () => {
    const r = gabungRekap([header('Karyawan', { jml_nota: 2 })], []);
    expect(r.jmlNota).toBe(2);
    expect(r.jmlBaris).toBe(0);
    expect(r.subtotal).toBe(0);
    expect(r.perJenis).toHaveLength(1);
    expect(r.kosong).toBe(false);
  });

  it('mempertahankan jenis yang hanya muncul di sisi barang', () => {
    const r = gabungRekap([], [item('Karyawan', { subtotal: 900 })]);
    expect(r.perJenis).toHaveLength(1);
    expect(r.subtotal).toBe(900);
  });

  it('hari tanpa satu nota pun dinyatakan kosong', () => {
    const r = gabungRekap([], []);
    expect(r.kosong).toBe(true);
    expect(r.jmlNota).toBe(0);
    expect(r.total).toBe(0);
    expect(r.perJenis).toEqual([]);
  });

  /**
   * `kosong` ditentukan JUMLAH NOTA, bukan totalnya. Hari yang notanya ada tapi
   * berjumlah nol rupiah (potongan yang menghabiskan nilainya) tetap hari yang
   * ada penjualannya -- dan mendiamkannya sebagai "tidak ada penjualan"
   * menyembunyikan justru keadaan yang paling perlu dilihat orang.
   */
  it('nota yang totalnya nol rupiah TIDAK dianggap hari kosong', () => {
    const r = gabungRekap(
      [header('Jual Bebas', { jml_nota: 1, penyesuaian: -5000 })],
      [item('Jual Bebas', { subtotal: 5000 })],
    );
    expect(r.total).toBe(0);
    expect(r.kosong).toBe(false);
  });

  /** mysql2 menyerahkan SUM() kadang sebagai string; keduanya harus diterima. */
  it('menerima angka yang datang sebagai string', () => {
    const r = gabungRekap(
      [header('Jual Bebas', { jml_nota: '3', ppn: '250', penyesuaian: '-100' })],
      [item('Jual Bebas', { jml_baris: '7', jml_barang: '20', subtotal: '10000' })],
    );
    expect(r.jmlNota).toBe(3);
    expect(r.ppn).toBe(250);
    expect(r.penyesuaian).toBe(-100);
    expect(r.total).toBe(10150);
  });

  it('memperlakukan null sebagai nol', () => {
    const r = gabungRekap(
      [header('Jual Bebas', { ppn: null, penyesuaian: null })],
      [item('Jual Bebas', { jml_barang: null, subtotal: null })],
    );
    expect(r.total).toBe(0);
    expect(r.jmlNota).toBe(1);
  });

  it('mengurutkan jenis menurut jumlah nota, lalu nama', () => {
    const r = gabungRekap(
      [header('VIP', { jml_nota: 5 }), header('Alfa', { jml_nota: 5 }), header('Jual Bebas', { jml_nota: 40 })],
      [],
    );
    expect(r.perJenis.map((b) => b.jenis)).toEqual(['Jual Bebas', 'Alfa', 'VIP']);
  });

  it('menjumlahkan seluruh jenis ke angka keseluruhan', () => {
    const r = gabungRekap(
      [header('Jual Bebas', { jml_nota: 31, penyesuaian: -17336 }), header('Karyawan', { jml_nota: 2, penyesuaian: 83 })],
      [item('Jual Bebas', { subtotal: 747336 }), item('Karyawan', { subtotal: 29517 })],
    );
    expect(r.jmlNota).toBe(33);
    expect(r.subtotal).toBe(776853);
    expect(r.penyesuaian).toBe(-17253);
  });
});

describe('formatRincianJenis', () => {
  /**
   * PATOKAN atas kewajiban MULTILINE_VARIABLES.
   *
   * `{rincian_jenis}` dikecualikan dari sanitasi `renderTemplate()`, jadi setiap
   * baris baru pada hasil akhir wajib berasal dari kode kita. `jns_jual` adalah
   * kolom Khanza; satu nilai berisi baris baru bisa menyisipkan barisnya sendiri
   * ke dalam pesan dan memalsukan strukturnya -- persis lubang §9.2.
   */
  it('membuang baris baru dari nama jenis', () => {
    const r = gabungRekap([header('Jual Bebas\n• Palsu : 999 nota, Rp0')], []);
    expect(formatRincianJenis(r.perJenis).split('\n')).toHaveLength(1);
  });

  it('satu baris per jenis', () => {
    const r = gabungRekap([header('A'), header('B'), header('C')], []);
    expect(formatRincianJenis(r.perJenis).split('\n')).toHaveLength(3);
  });

  /**
   * Baris yang dibuka tanda titik tanpa nama terbaca sebagai pesan rusak, dan
   * angkanya jadi tidak bisa dipertanggungjawabkan ke mana pun.
   */
  it('memberi nama pada jenis yang kosong', () => {
    const r = gabungRekap([header('')], []);
    expect(formatRincianJenis(r.perJenis)).toContain('(tanpa jenis)');
  });

  it('menyebut jumlah nota dan totalnya', () => {
    const r = gabungRekap([header('Karyawan', { jml_nota: 2 })], [item('Karyawan', { subtotal: 29517 })]);
    const teks = formatRincianJenis(r.perJenis);
    expect(teks).toContain('Karyawan');
    expect(teks).toContain('2 nota');
    expect(teks).toContain('Rp29.517');
  });

  it('mengosongkan diri saat tidak ada jenis sama sekali', () => {
    expect(formatRincianJenis([])).toBe('');
  });
});

describe('bacaJamRekap', () => {
  it('membaca HH:MM', () => {
    expect(bacaJamRekap('21:00')).toEqual({ jam: 21, menit: 0 });
    expect(bacaJamRekap('07:30')).toEqual({ jam: 7, menit: 30 });
  });

  it('menerima satu digit dan titik sebagai pemisah', () => {
    expect(bacaJamRekap('7:5')).toEqual({ jam: 7, menit: 5 });
    expect(bacaJamRekap('21.30')).toEqual({ jam: 21, menit: 30 });
  });

  it('memaafkan spasi di sekitarnya', () => {
    expect(bacaJamRekap('  21:00  ')).toEqual({ jam: 21, menit: 0 });
  });

  /**
   * `24:00` ditolak: tidak ada waktu seperti itu dalam sehari, dan menerimanya
   * berarti jadwal yang tidak pernah jatuh tempo -- fitur yang diam selamanya
   * tanpa satu pun galat.
   */
  it('menolak jam dan menit di luar rentang', () => {
    expect(bacaJamRekap('24:00')).toBeNull();
    expect(bacaJamRekap('21:60')).toBeNull();
    expect(bacaJamRekap('-1:00')).toBeNull();
  });

  it('menolak yang bukan jam', () => {
    expect(bacaJamRekap('')).toBeNull();
    expect(bacaJamRekap(null)).toBeNull();
    expect(bacaJamRekap(undefined)).toBeNull();
    expect(bacaJamRekap('malam')).toBeNull();
    expect(bacaJamRekap('21')).toBeNull();
    expect(bacaJamRekap('21:00:00')).toBeNull();
  });

  it('bolak-balik dengan tulisJamRekap tanpa berubah', () => {
    for (const teks of ['00:00', '07:05', '21:00', '23:59']) {
      expect(tulisJamRekap(bacaJamRekap(teks)!)).toBe(teks);
    }
  });

  it('jam bawaannya 21:00 -- diukur, lihat migrations/041', () => {
    expect(tulisJamRekap(JAM_REKAP_BAWAAN)).toBe('21:00');
  });
});

describe('hariRekap', () => {
  it('offset 0 berarti hari ini', () => {
    expect(hariRekap(new Date(2026, 7, 12, 21, 0), 0)).toBe('2026-08-12');
  });

  it('offset 1 berarti kemarin', () => {
    expect(hariRekap(new Date(2026, 7, 12, 7, 0), 1)).toBe('2026-08-11');
  });

  it('menyeberangi pergantian bulan', () => {
    expect(hariRekap(new Date(2026, 7, 1, 7, 0), 1)).toBe('2026-07-31');
  });

  it('menyeberangi pergantian tahun', () => {
    expect(hariRekap(new Date(2027, 0, 1, 7, 0), 1)).toBe('2026-12-31');
  });

  it('menangani tahun kabisat', () => {
    expect(hariRekap(new Date(2028, 2, 1, 7, 0), 1)).toBe('2028-02-29');
  });

  /**
   * "Merekap hari besok" tidak punya arti, dan membiarkannya lewat berarti rekap
   * yang selamanya kosong -- tanpa satu pun galat yang menyebutkan sebabnya.
   */
  it('menjepit offset negatif jadi hari ini', () => {
    expect(hariRekap(new Date(2026, 7, 12, 21, 0), -3)).toBe('2026-08-12');
  });

  it('mengabaikan offset yang bukan angka', () => {
    expect(hariRekap(new Date(2026, 7, 12, 21, 0), Number.NaN)).toBe('2026-08-12');
  });

  /** Jam berapa pun pada hari itu menghasilkan tanggal yang sama. */
  it('tidak terpengaruh jam', () => {
    expect(hariRekap(new Date(2026, 7, 12, 0, 1), 0)).toBe('2026-08-12');
    expect(hariRekap(new Date(2026, 7, 12, 23, 59), 0)).toBe('2026-08-12');
  });
});
