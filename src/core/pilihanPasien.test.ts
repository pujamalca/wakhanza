import { bacaModePenerima, bacaPilihanRm, pilihanTersembunyi, MAX_PILIHAN_PASIEN } from './pilihanPasien';

describe('bacaModePenerima', () => {
  it('membaca mode pilih', () => {
    expect(bacaModePenerima('pilih')).toBe('pilih');
    expect(bacaModePenerima(['pilih'])).toBe('pilih');
  });

  // Bawaannya menentukan perilaku halaman yang dibuka polos DAN halaman lama
  // yang tautannya sudah tersimpan di mana-mana -- keduanya harus tetap
  // berperilaku persis seperti sebelum fitur ini ada.
  it('apa pun selain "pilih" jatuh ke semua', () => {
    expect(bacaModePenerima(undefined)).toBe('semua');
    expect(bacaModePenerima('')).toBe('semua');
    expect(bacaModePenerima('semua')).toBe('semua');
    expect(bacaModePenerima('PILIH')).toBe('semua');
    expect(bacaModePenerima('apa saja')).toBe('semua');
  });
});

describe('bacaPilihanRm', () => {
  it('kosong bila tidak ada yang dicentang', () => {
    expect(bacaPilihanRm(undefined)).toEqual({ daftar: [], terpotong: false });
    expect(bacaPilihanRm([])).toEqual({ daftar: [], terpotong: false });
  });

  it('menerima satu nilai tunggal maupun larik', () => {
    expect(bacaPilihanRm('000001').daftar).toEqual(['000001']);
    expect(bacaPilihanRm(['000001', '000002']).daftar).toEqual(['000001', '000002']);
  });

  it('memangkas spasi dan membuang yang kosong', () => {
    expect(bacaPilihanRm([' 000001 ', '', '   ', '000002']).daftar).toEqual(['000001', '000002']);
  });

  /**
   * Duplikat bukan kasus buatan: baris yang dicentang di tabel dan baris yang
   * sama dititipkan sebagai input tersembunyi akan mengirim nilainya dua kali
   * kalau halaman keliru merender keduanya. Tanpa dedup, pasien itu masuk dua
   * kali ke `IN (...)` -- tidak berbahaya di SQL, tapi angka "N pasien dipilih"
   * di layar jadi berbohong.
   */
  it('membuang duplikat tanpa mengubah urutan centang', () => {
    expect(bacaPilihanRm(['000002', '000001', '000002']).daftar).toEqual(['000002', '000001']);
  });

  it('memotong di MAX_PILIHAN_PASIEN dan MENGAKUINYA', () => {
    const banyak = Array.from({ length: MAX_PILIHAN_PASIEN + 3 }, (_, i) => `RM${i}`);
    const hasil = bacaPilihanRm(banyak);
    expect(hasil.daftar).toHaveLength(MAX_PILIHAN_PASIEN);
    expect(hasil.terpotong).toBe(true);
    // Yang bertahan adalah yang dicentang lebih dulu -- pemotongan dari ekor,
    // bukan pemilihan acak.
    expect(hasil.daftar[0]).toBe('RM0');
    expect(hasil.daftar.at(-1)).toBe(`RM${MAX_PILIHAN_PASIEN - 1}`);
  });

  it('tepat di batas TIDAK dilaporkan terpotong', () => {
    const pas = Array.from({ length: MAX_PILIHAN_PASIEN }, (_, i) => `RM${i}`);
    expect(bacaPilihanRm(pas).terpotong).toBe(false);
  });

  /**
   * Duplikat dihitung SESUDAH dedup, bukan sebelum -- kalau tidak, 600 centang
   * yang isinya cuma 3 pasien berbeda akan dilaporkan terpotong padahal tidak
   * satu pun hilang, dan peringatan yang muncul tanpa sebab adalah peringatan
   * yang berhenti dibaca.
   */
  it('dedup dulu, baru dihitung terhadap batas', () => {
    const berulang = Array.from({ length: MAX_PILIHAN_PASIEN + 50 }, () => '000001');
    expect(bacaPilihanRm(berulang)).toEqual({ daftar: ['000001'], terpotong: false });
  });
});

describe('pilihanTersembunyi', () => {
  /**
   * Inti aturannya, dan satu-satunya bagian fitur ini yang gagal DIAM: baris
   * yang sedang tampil sudah punya checkbox-nya sendiri, jadi menitipkannya
   * SEKALI LAGI sebagai input tersembunyi membuat centangnya mustahil dilepas.
   */
  it('membuang yang sedang tampil di tabel', () => {
    expect(pilihanTersembunyi(['A', 'B', 'C'], new Set(['B']))).toEqual(['A', 'C']);
  });

  it('seluruhnya tampil -> tidak ada yang dititipkan', () => {
    expect(pilihanTersembunyi(['A', 'B'], new Set(['A', 'B']))).toEqual([]);
  });

  it('tidak ada yang tampil -> seluruhnya dititipkan, urutannya utuh', () => {
    expect(pilihanTersembunyi(['B', 'A'], new Set())).toEqual(['B', 'A']);
  });

  // Baris tabel yang TIDAK dicentang tidak boleh ikut terbawa -- kalau ikut,
  // menjelajah tabel diam-diam menambah penerima yang tidak pernah dipilih.
  it('baris tampil yang tak dicentang tidak ditambahkan', () => {
    expect(pilihanTersembunyi([], new Set(['A', 'B']))).toEqual([]);
  });

  it('menerima Iterable apa pun, bukan cuma Set', () => {
    expect(pilihanTersembunyi(['A', 'B'], ['A'])).toEqual(['B']);
  });
});
