import {
  deteksiPermintaanStok,
  buangMention,
  parseStokKeywords,
  formatStokObat,
  formatRupiah,
  type BarisStokObat,
} from './stokObat';

const KUNCI = ['stok', 'harga'];
/** Bawaan migrations/039 -- kata tanya ketersediaan, yang boleh gugur diam-diam. */
const KUNCI_ADA = ['adakah', 'apotek', 'apotik', 'tersedia', 'ready', 'punya', 'jual', 'beli', 'obat'];

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

  /**
   * Bentuk pertanyaan yang benar-benar datang dari grup apotek, dan dulu
   * dijawab `Maaf, "115634008510549" tidak ditemukan`. Di dalam grup,
   * me-mention nomor rumah sakit adalah cara paling wajar memanggilnya.
   */
  it('sebutan @<id> tidak ikut jadi nama obat', () => {
    expect(deteksiPermintaanStok('@115634008510549 stok paracetamol', KUNCI).cari).toBe('paracetamol');
    expect(deteksiPermintaanStok('stok paracetamol @115634008510549', KUNCI).cari).toBe('paracetamol');
  });

  it('sebutan tanpa nama obat diperlakukan sebagai tidak menyebut nama', () => {
    const h = deteksiPermintaanStok('@115634008510549 sisa stok obat', KUNCI);
    expect(h.cocok).toBe(true);
    expect(h.cari).toBe('');
  });

  it('hanya @ diikuti angka yang dibuang', () => {
    expect(buangMention('@115634008510549 halo')).toBe('  halo');
    // Nama dagang yang kebetulan memuat '@' tidak boleh ikut hilang -- sebutan
    // WhatsApp selalu id numerik.
    expect(buangMention('stok vitamin@c')).toBe('stok vitamin@c');
  });

  it('golongan lama tetap KETAT saat golongan kedua tidak diserahkan', () => {
    // Parameter ketiga opsional: pemanggil lama menghasilkan perilaku yang
    // sama persis seperti sebelum migrations/039.
    expect(deteksiPermintaanStok('stok paracetamol', KUNCI).ketat).toBe(true);
  });
});

describe('deteksiPermintaanStok -- kata tanya ketersediaan (migrations/039)', () => {
  it('mengenali bentuk pertanyaan sehari-hari yang tidak memuat kata "stok"', () => {
    // Bentuk yang diminta pemilik sistem, dan yang sebelumnya tidak pernah
    // dijawab sama sekali.
    const h = deteksiPermintaanStok('apotek adakah obat paracetamol', KUNCI, KUNCI_ADA);
    expect(h.cocok).toBe(true);
    expect(h.ketat).toBe(false);
    expect(h.cari).toBe('paracetamol');
  });

  it('membuang kata kunci dari KEDUA golongan sekaligus', () => {
    // "apotek", "adakah", dan "obat" ketiganya harus lenyap dari pencarian --
    // yang tersisa satu pun di antaranya membuat LIKE-nya tidak pernah cocok.
    expect(deteksiPermintaanStok('apotek adakah obat amlodipin', KUNCI, KUNCI_ADA).cari).toBe('amlodipin');
  });

  it('kata ingkar di ekor kalimat ikut dibuang', () => {
    /**
     * "X ada tidak?" adalah cara paling wajar orang bertanya ketersediaan di
     * sini. Versi pertama meleset justru pada bentuk ini: sisanya "amlodipin
     * tidak" dipakai UTUH sebagai satu pola LIKE dan tidak pernah cocok --
     * ditemukan oleh uji ini, bukan diperkirakan.
     */
    expect(deteksiPermintaanStok('jual obat amlodipin tidak', KUNCI, KUNCI_ADA).cari).toBe('amlodipin');
    expect(deteksiPermintaanStok('ready paracetamol ga', KUNCI, KUNCI_ADA).cari).toBe('paracetamol');
    expect(deteksiPermintaanStok('punya salbutamol nggak ya', KUNCI, KUNCI_ADA).cari).toBe('salbutamol');
  });

  it('KETAT menang saat kedua golongan sama-sama cocok', () => {
    /**
     * "stok, adakah paracetamol?" maksudnya sudah jelas. Kalau golongan longgar
     * yang menang, pesannya boleh gugur diam-diam saat obatnya tidak ketemu --
     * padahal penanya justru sedang menanyakan persediaan dan berhak dijawab
     * "tidak ditemukan".
     */
    const h = deteksiPermintaanStok('stok, adakah paracetamol?', KUNCI, KUNCI_ADA);
    expect(h.cocok).toBe(true);
    expect(h.ketat).toBe(true);
  });

  it('"ada" polos sengaja TIDAK ikut -- ia menabrak aturan "ada poli apa"', () => {
    /**
     * Diukur, bukan dikira: katalog di mesin ini punya barang yang cocok
     * `nama_brng LIKE '%poli%'`, jadi "ada poli apa" akan menyisakan "poli",
     * menemukan barang, lalu MENGKLAIM pesannya -- dan aturan "daftar poli"
     * yang sudah aktif tidak pernah sempat menjawab. Pagar gugur-diam-diam
     * tidak menolong di sini justru karena obatnya ketemu.
     */
    expect(KUNCI_ADA).not.toContain('ada');
    expect(deteksiPermintaanStok('ada poli apa', KUNCI, KUNCI_ADA).cocok).toBe(false);
  });

  it('pertanyaan bukan-obat tetap tidak cocok bila tak satu pun kata tanya ada', () => {
    expect(deteksiPermintaanStok('jam praktik dokter anak', KUNCI, KUNCI_ADA).cocok).toBe(false);
  });

  it('cocok tapi tanpa nama obat ditandai sebagai tanpa nama, bukan dibuang di sini', () => {
    // Keputusan melepas atau menjawabnya milik worker/stokReply.ts; modul ini
    // hanya melaporkan apa yang terbaca.
    const h = deteksiPermintaanStok('apotek', KUNCI, KUNCI_ADA);
    expect(h.cocok).toBe(true);
    expect(h.ketat).toBe(false);
    expect(h.cari).toBe('');
  });

  it('sisa berbilang kata diserahkan UTUH -- itu penjaga alaminya', () => {
    /**
     * Sisa dipakai sebagai SATU pola `LIKE '%sisa%'`, jadi kalimat yang bukan
     * tentang obat hampir tidak pernah cocok dengan satu pun nama barang. Itu
     * yang membuat kata selonggar "obat" aman dipasang.
     */
    expect(deteksiPermintaanStok('obat saya kapan bisa diambil', KUNCI, KUNCI_ADA).cari).toBe('kapan bisa diambil');
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
    const teks = formatStokObat([baris()], { rincian: 'penuh', hargaDipakai: 'jualbebas' });
    expect(teks).toContain('sisa 231 Tablet');
    expect(teks).toContain('Rp500');
  });

  it('menandai stok yang menipis, hanya terhadap ambang Khanza sendiri', () => {
    expect(formatStokObat([baris({ stok: 10, stokminimal: 50 })], { rincian: 'penuh', hargaDipakai: 'ralan' })).toContain(
      '(menipis)',
    );
    // stokminimal 0 = apotek tidak menetapkan ambang; jangan mengarang sendiri.
    expect(formatStokObat([baris({ stok: 7, stokminimal: 0 })], { rincian: 'penuh', hargaDipakai: 'ralan' })).not.toContain(
      '(menipis)',
    );
  });

  it('NOL ditandai habis, bukan menipis', () => {
    // "sisa 0 (menipis)" terbaca seolah masih ada yang bisa diserahkan.
    // Ditemukan pada katalog sungguhan: beberapa obat berstok 0 sementara
    // stokminimal-nya di atas nol, jadi keduanya jatuh ke cabang yang sama.
    const teks = formatStokObat([baris({ stok: 0, stokminimal: 50 })], { rincian: 'penuh', hargaDipakai: 'ralan' });
    expect(teks).toContain('(habis)');
    expect(teks).not.toContain('(menipis)');
  });

  it('stok 0 tanpa ambang tetap ditandai habis', () => {
    expect(formatStokObat([baris({ stok: 0, stokminimal: 0 })], { rincian: 'penuh', hargaDipakai: 'ralan' })).toContain(
      '(habis)',
    );
  });

  it('MENYEMBUNYIKAN angka persediaan pada rincian "harga"', () => {
    const teks = formatStokObat([baris({ stok: 231 })], { rincian: 'harga', hargaDipakai: 'jualbebas' });
    expect(teks).toContain('tersedia');
    expect(teks).not.toContain('231');
  });

  it('membedakan kosong dari tersedia tanpa menyebut angka', () => {
    expect(formatStokObat([baris({ stok: 0 })], { rincian: 'harga', hargaDipakai: 'jualbebas' })).toContain('kosong');
  });

  it('rincian "ringkas": nama dan ketersediaan saja, tanpa harga maupun angka', () => {
    const teks = formatStokObat([baris({ stok: 231, ralan: 501, jualbebas: 500 })], {
      rincian: 'ringkas',
      hargaDipakai: 'jualbebas',
    });
    expect(teks).toBe('• Paracetamol 500 Mg — tersedia');
    expect(teks).not.toContain('Rp');
    expect(teks).not.toContain('231');
    expect(teks).not.toContain('Tablet');
  });

  it('rincian "ringkas": stok nol TETAP disebut, ditandai kosong', () => {
    /**
     * Membuang barisnya akan membuat "obat ini tidak dijual di sini" dan "obat
     * ini dijual, cuma sedang habis" terbaca persis sama oleh penanya --
     * keduanya menghasilkan daftar tanpa barisnya, padahal tindakan yang benar
     * berbeda (cari ke apotek lain vs tanyakan lagi besok).
     */
    const teks = formatStokObat([baris({ stok: 0 }), baris({ kode_brng: 'B002', nama_brng: 'Amlodipin', stok: 4 })], {
      rincian: 'ringkas',
      hargaDipakai: 'jualbebas',
    });
    expect(teks.split('\n')).toHaveLength(2);
    expect(teks).toContain('Paracetamol 500 Mg — kosong');
    expect(teks).toContain('Amlodipin — tersedia');
  });

  it('rincian "ringkas": tanda (menipis) tidak ikut bocor', () => {
    // (menipis) diturunkan dari `stokminimal`, yaitu ambang dagang apotek --
    // ia setara mengumumkan bahwa persediaannya sedang tipis.
    const teks = formatStokObat([baris({ stok: 3, stokminimal: 50 })], {
      rincian: 'ringkas',
      hargaDipakai: 'ralan',
    });
    expect(teks).toBe('• Paracetamol 500 Mg — tersedia');
  });

  it('rincian "ringkas": nama obat tetap lewat sanitizeValue', () => {
    // Cabang ini merakit barisnya sendiri, jadi pengecualian {stok_obat} dari
    // sanitasi harus tetap ditutup di SINI juga -- bukan cuma di cabang penuh.
    const teks = formatStokObat([baris({ nama_brng: 'Obat\nPalsu\nBaris' })], {
      rincian: 'ringkas',
      hargaDipakai: 'ralan',
    });
    expect(teks.split('\n')).toHaveLength(1);
  });

  it('memakai kolom harga yang diminta', () => {
    const rows = [baris({ ralan: 501, jualbebas: 500 })];
    expect(formatStokObat(rows, { rincian: 'penuh', hargaDipakai: 'ralan' })).toContain('Rp501');
    expect(formatStokObat(rows, { rincian: 'penuh', hargaDipakai: 'jualbebas' })).toContain('Rp500');
  });

  it('membuang baris baru dari nama obat -- sanitizeValue tetap berlaku per kolom', () => {
    // {stok_obat} dikecualikan dari sanitasi di renderTemplate, jadi SETIAP
    // baris baru pada hasil akhir harus berasal dari kode ini. Nama yang
    // diketik petugas gudang tidak boleh bisa menyisipkan barisnya sendiri.
    const teks = formatStokObat([baris({ nama_brng: 'Obat\nPalsu\nBaris' })], {
      rincian: 'penuh',
      hargaDipakai: 'ralan',
    });
    expect(teks.split('\n')).toHaveLength(1);
  });

  it('memberi catatan saat hasilnya terpotong, bukan diam', () => {
    const teks = formatStokObat([baris(), baris({ kode_brng: 'B002' })], {
      rincian: 'penuh',
      hargaDipakai: 'ralan',
      truncatedFrom: 9,
    });
    expect(teks).toContain('ditampilkan 2 dari 9');
  });

  it('tanpa catatan saat jumlahnya kebetulan pas', () => {
    const teks = formatStokObat([baris()], { rincian: 'penuh', hargaDipakai: 'ralan', truncatedFrom: 1 });
    expect(teks).not.toContain('ditampilkan');
  });

  it('daftar kosong menghasilkan string kosong, bukan baris hampa', () => {
    expect(formatStokObat([], { rincian: 'penuh', hargaDipakai: 'ralan' })).toBe('');
  });
});
