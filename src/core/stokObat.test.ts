import { deteksiPermintaanStok, parseStokKeywords, formatStokObat, formatRupiah, type BarisStokObat } from './stokObat';

const KUNCI = ['stok', 'harga'];

function baris(over: Partial<BarisStokObat> = {}): BarisStokObat {
  return {
    kode_brng: 'B001',
    nama_brng: 'Paracetamol 500 Mg',
    ralan: 501,
    jualbebas: 500,
    stokminimal: 50,
    satuan: 'Tablet',
    stok: 231,
    ...over,
  };
}

describe('deteksiPermintaanStok', () => {
  it('mengenali kata kunci dan menyisakan nama obatnya', () => {
    const h = deteksiPermintaanStok('stok paracetamol', KUNCI);
    expect(h.cocok).toBe(true);
    expect(h.cari).toBe('paracetamol');
  });

  it('membuang kata pengapit pertanyaan sehari-hari', () => {
    expect(deteksiPermintaanStok('berapa harga paramex ya kak?', KUNCI).cari).toBe('paramex');
    expect(deteksiPermintaanStok('Selamat pagi, mau tanya stok Ambeven', KUNCI).cari).toContain('ambeven');
  });

  it('membuang SEMUA kata kunci, bukan cuma yang cocok pertama', () => {
    // "stok dan harga paramex" harus menyisakan "paramex" saja -- kalau hanya
    // kata kunci pertama yang dibuang, pencariannya jadi "harga paramex" dan
    // tidak menemukan apa pun.
    expect(deteksiPermintaanStok('stok dan harga paramex', KUNCI).cari).toBe('paramex');
  });

  it('tidak cocok bila tidak ada kata kuncinya', () => {
    expect(deteksiPermintaanStok('jam praktik dokter anak', KUNCI).cocok).toBe(false);
  });

  it('cocok sebagai KATA UTUH, bukan potongan kata', () => {
    // Tanpa penyelubungan spasi, "stok" ikut cocok pada "stokis"/"restok".
    expect(deteksiPermintaanStok('saya stokis obat', KUNCI).cocok).toBe(false);
    expect(deteksiPermintaanStok('mau restok barang', KUNCI).cocok).toBe(false);
  });

  it('cari KOSONG saat penanya tidak menyebut obat apa pun', () => {
    // Pemanggil menjawabnya dengan meminta nama obatnya. Menebak di sini
    // menghasilkan jawaban percaya-diri-dan-keliru.
    const h = deteksiPermintaanStok('berapa harga obat?', KUNCI);
    expect(h.cocok).toBe(true);
    expect(h.cari).toBe('');
  });

  it('potongan terlalu pendek diperlakukan sebagai tanpa nama', () => {
    // LIKE '%a%' cocok dengan hampir seluruh katalog -- daftar acak yang tampak
    // seperti hasil pencarian sungguhan.
    expect(deteksiPermintaanStok('stok a', KUNCI).cari).toBe('');
  });

  it('tahan terhadap huruf besar, tanda baca, dan diakritik', () => {
    expect(deteksiPermintaanStok('STOK Paracetamol!!!', KUNCI).cari).toBe('paracetamol');
  });

  it('pesan kosong tidak pernah cocok', () => {
    expect(deteksiPermintaanStok('   ', KUNCI).cocok).toBe(false);
    expect(deteksiPermintaanStok('👍', KUNCI).cocok).toBe(false);
  });

  it('daftar kata kunci kosong tidak pernah cocok', () => {
    expect(deteksiPermintaanStok('stok paracetamol', []).cocok).toBe(false);
  });
});

describe('parseStokKeywords', () => {
  it('memecah per koma dan menormalkan', () => {
    expect(parseStokKeywords(' Stok , HARGA ,, ')).toEqual(['stok', 'harga']);
  });
});

describe('formatRupiah', () => {
  it('memakai pemisah ribuan Indonesia tanpa desimal', () => {
    expect(formatRupiah(22000)).toBe('Rp22.000');
    expect(formatRupiah(501.4)).toBe('Rp501');
  });
});

describe('formatStokObat', () => {
  it('menyebut angka sisa dan satuan untuk petugas', () => {
    const teks = formatStokObat([baris()], { tampilkanJumlah: true, hargaDipakai: 'jualbebas' });
    expect(teks).toContain('sisa 231 Tablet');
    expect(teks).toContain('Rp500');
  });

  it('menandai stok yang menipis, hanya terhadap ambang Khanza sendiri', () => {
    expect(formatStokObat([baris({ stok: 10, stokminimal: 50 })], { tampilkanJumlah: true, hargaDipakai: 'ralan' })).toContain(
      '(menipis)',
    );
    // stokminimal 0 = apotek tidak menetapkan ambang; jangan mengarang sendiri.
    expect(formatStokObat([baris({ stok: 7, stokminimal: 0 })], { tampilkanJumlah: true, hargaDipakai: 'ralan' })).not.toContain(
      '(menipis)',
    );
  });

  it('NOL ditandai habis, bukan menipis', () => {
    // "sisa 0 (menipis)" terbaca seolah masih ada yang bisa diserahkan.
    // Ditemukan pada katalog sungguhan: beberapa obat berstok 0 sementara
    // stokminimal-nya di atas nol, jadi keduanya jatuh ke cabang yang sama.
    const teks = formatStokObat([baris({ stok: 0, stokminimal: 50 })], { tampilkanJumlah: true, hargaDipakai: 'ralan' });
    expect(teks).toContain('(habis)');
    expect(teks).not.toContain('(menipis)');
  });

  it('stok 0 tanpa ambang tetap ditandai habis', () => {
    expect(formatStokObat([baris({ stok: 0, stokminimal: 0 })], { tampilkanJumlah: true, hargaDipakai: 'ralan' })).toContain(
      '(habis)',
    );
  });

  it('MENYEMBUNYIKAN angka persediaan untuk penanya umum', () => {
    const teks = formatStokObat([baris({ stok: 231 })], { tampilkanJumlah: false, hargaDipakai: 'jualbebas' });
    expect(teks).toContain('tersedia');
    expect(teks).not.toContain('231');
  });

  it('membedakan kosong dari tersedia tanpa menyebut angka', () => {
    expect(formatStokObat([baris({ stok: 0 })], { tampilkanJumlah: false, hargaDipakai: 'jualbebas' })).toContain('kosong');
  });

  it('memakai kolom harga yang diminta', () => {
    const rows = [baris({ ralan: 501, jualbebas: 500 })];
    expect(formatStokObat(rows, { tampilkanJumlah: true, hargaDipakai: 'ralan' })).toContain('Rp501');
    expect(formatStokObat(rows, { tampilkanJumlah: true, hargaDipakai: 'jualbebas' })).toContain('Rp500');
  });

  it('membuang baris baru dari nama obat -- sanitizeValue tetap berlaku per kolom', () => {
    // {stok_obat} dikecualikan dari sanitasi di renderTemplate, jadi SETIAP
    // baris baru pada hasil akhir harus berasal dari kode ini. Nama yang
    // diketik petugas gudang tidak boleh bisa menyisipkan barisnya sendiri.
    const teks = formatStokObat([baris({ nama_brng: 'Obat\nPalsu\nBaris' })], {
      tampilkanJumlah: true,
      hargaDipakai: 'ralan',
    });
    expect(teks.split('\n')).toHaveLength(1);
  });

  it('memberi catatan saat hasilnya terpotong, bukan diam', () => {
    const teks = formatStokObat([baris(), baris({ kode_brng: 'B002' })], {
      tampilkanJumlah: true,
      hargaDipakai: 'ralan',
      truncatedFrom: 9,
    });
    expect(teks).toContain('ditampilkan 2 dari 9');
  });

  it('tanpa catatan saat jumlahnya kebetulan pas', () => {
    const teks = formatStokObat([baris()], { tampilkanJumlah: true, hargaDipakai: 'ralan', truncatedFrom: 1 });
    expect(teks).not.toContain('ditampilkan');
  });

  it('daftar kosong menghasilkan string kosong, bukan baris hampa', () => {
    expect(formatStokObat([], { tampilkanJumlah: true, hargaDipakai: 'ralan' })).toBe('');
  });
});
