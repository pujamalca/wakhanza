import { hitungKataTakTerjawab } from './pertanyaanTakTerjawab';

describe('hitungKataTakTerjawab', () => {
  it('menghitung berapa PESAN yang memuatnya, bukan berapa kemunculan', () => {
    // Satu orang yang mengetik "obat obat obat" tidak boleh terlihat seperti
    // tiga orang yang menanyakan obat. Yang menentukan apakah sebuah aturan
    // layak ditulis adalah berapa ORANG bertanya, bukan berapa kali kata muncul.
    const hasil = hitungKataTakTerjawab(['obat obat obat obat', 'obat sudah siap?']);
    expect(hasil).toEqual([{ kata: 'obat', jumlahPesan: 2 }]);
  });

  it('MEMBUANG kata yang sudah punya aturan', () => {
    // Tanpa ini, daftar teratas dikuasai kata yang justru sudah tertangani dan
    // yang benar-benar belum punya jawaban tenggelam di bawahnya.
    const pesan = ['jadwal dokter apa', 'jadwal dokter kapan', 'biaya operasi berapa', 'biaya operasi mahal'];
    const hasil = hitungKataTakTerjawab(pesan, ['jadwal dokter']);
    expect(hasil.map((k) => k.kata)).not.toContain('jadwal');
    expect(hasil.map((k) => k.kata)).not.toContain('dokter');
    expect(hasil.map((k) => k.kata)).toContain('biaya');
  });

  it('kata kunci berfrasa dipecah jadi kata-katanya', () => {
    const hasil = hitungKataTakTerjawab(['jadwal praktik dokter', 'jadwal praktik lagi'], ['jadwal praktik']);
    expect(hasil.map((k) => k.kata)).not.toContain('praktik');
  });

  it('membuang sapaan dan kata fungsi', () => {
    const pesan = ['selamat pagi pak admin', 'selamat pagi bu admin'];
    expect(hitungKataTakTerjawab(pesan)).toEqual([]);
  });

  it('TIDAK membuang kata pokok yang sering, walau seringnya itu yang bikin curiga', () => {
    // "obat", "dokter", "daftar" sengaja TIDAK masuk daftar kata umum: seringnya
    // itulah yang menjadikannya kandidat aturan terbaik.
    const hasil = hitungKataTakTerjawab(['daftar online bisa?', 'daftar online caranya']);
    expect(hasil.map((k) => k.kata)).toEqual(expect.arrayContaining(['daftar', 'online']));
  });

  it('membuang angka murni dan kata terlalu pendek', () => {
    const hasil = hitungKataTakTerjawab(['rm 12345 atas nama', 'rm 12345 punya siapa']);
    expect(hasil.map((k) => k.kata)).not.toContain('12345');
    expect(hasil.map((k) => k.kata)).not.toContain('rm');
  });

  it('yang cuma muncul sekali tidak ditampilkan', () => {
    // Satu pesan bukan pola. Menampilkannya membuat daftar penuh kata yang tidak
    // pernah akan jadi aturan, dan yang berpola tenggelam.
    expect(hitungKataTakTerjawab(['pertanyaan unik sekali'])).toEqual([]);
  });

  it('memakai normalisasi yang SAMA dengan pencocokan aturan', () => {
    // Kalau berbeda, kata yang ditampilkan bukan kata yang dilihat mesin saat
    // mencocokkan -- staf menulis aturan yang tidak pernah cocok lalu
    // menyimpulkan fiturnya rusak.
    const hasil = hitungKataTakTerjawab(['BIAYA, operasi!', 'biaya... OPERASI?']);
    expect(hasil.map((k) => k.kata)).toEqual(expect.arrayContaining(['biaya', 'operasi']));
  });

  it('urutannya stabil saat jumlahnya seri', () => {
    const a = hitungKataTakTerjawab(['biaya operasi', 'biaya operasi']);
    const b = hitungKataTakTerjawab(['biaya operasi', 'biaya operasi']);
    expect(a).toEqual(b);
    expect(a.map((k) => k.kata)).toEqual(['biaya', 'operasi']);
  });

  it('menghormati batas', () => {
    const pesan = ['alfa beta gama delta epsilon', 'alfa beta gama delta epsilon'];
    expect(hitungKataTakTerjawab(pesan, [], 2)).toHaveLength(2);
  });

  it('teks kosong dan null dilewati tanpa menjatuhkan hitungan', () => {
    expect(hitungKataTakTerjawab([null, undefined, '', '   '])).toEqual([]);
  });
});

describe('penyaring kebisingan (dari data produksi sungguhan)', () => {
  it('membuang potongan alamat web', () => {
    // Nomor RS menerima pesan promosi berisi tautan. Tanpa ini daftar teratas
    // dikuasai "https"/"bit"/"com" -- terlihat langsung pada data 30 hari.
    const pesan = ['cek https bit ly promo', 'lihat https bit ly diskon'];
    const hasil = hitungKataTakTerjawab(pesan).map((k) => k.kata);
    expect(hasil).not.toContain('https');
    expect(hasil).not.toContain('bit');
    expect(hasil).not.toContain('com');
  });

  it('membuang token yang mencampur huruf dan angka', () => {
    // Kode promo dan id transaksi seperti "40y4th4" / "cd260781880" muncul di
    // data sungguhan. Kata Indonesia tidak pernah berbentuk begitu, dan tiap
    // token semacam itu praktis unik sehingga tak pernah menandai pola.
    const pesan = ['kode 40y4th4 dipakai', 'kode 40y4th4 lagi'];
    expect(hitungKataTakTerjawab(pesan).map((k) => k.kata)).not.toContain('40y4th4');
  });

  it('kata pokok tetap lolos walau berdampingan dengan kebisingan', () => {
    // Yang benar-benar ditemukan di produksi: "apotik" dan "harga".
    const pesan = ['apotik buka jam berapa https bit ly', 'harga obat di apotik berapa'];
    const hasil = hitungKataTakTerjawab(pesan).map((k) => k.kata);
    expect(hasil).toContain('apotik');
  });
});
