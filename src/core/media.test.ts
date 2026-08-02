import {
  periksaBerkasLampiran,
  periksaPanjangKeterangan,
  namaBerkasSimpanan,
  jenisLampiranDari,
  formatUkuran,
  MAX_KETERANGAN,
} from './media';

describe('periksaBerkasLampiran', () => {
  it('menerima gambar dan dokumen yang didukung', () => {
    expect(periksaBerkasLampiran('poster.jpg', 'image/jpeg', 500_000).ok).toBe(true);
    expect(periksaBerkasLampiran('edaran.pdf', 'application/pdf', 2_000_000).ok).toBe(true);
  });

  it('menolak jenis di luar daftar-izin', () => {
    // Daftar-IZIN: nomor rumah sakit tidak boleh jadi saluran pengiriman
    // berkas sembarang jenis.
    for (const mime of ['application/x-msdownload', 'text/html', 'application/zip', 'video/mp4', '']) {
      const hasil = periksaBerkasLampiran('berkas', mime, 1000);
      expect(hasil.ok).toBe(false);
      expect(hasil.error).toContain('tidak didukung');
    }
  });

  it('menolak berkas kosong dan yang melebihi batas', () => {
    expect(periksaBerkasLampiran('a.pdf', 'application/pdf', 0).ok).toBe(false);
    const besar = periksaBerkasLampiran('a.pdf', 'application/pdf', 20 * 1024 * 1024);
    expect(besar.ok).toBe(false);
    expect(besar.error).toContain('16 MB');
  });

  it('menghormati batas yang diturunkan lewat pengaturan', () => {
    expect(periksaBerkasLampiran('a.pdf', 'application/pdf', 3 * 1024 * 1024, 2).ok).toBe(false);
    expect(periksaBerkasLampiran('a.pdf', 'application/pdf', 1 * 1024 * 1024, 2).ok).toBe(true);
  });
});

describe('periksaPanjangKeterangan', () => {
  it('menerima pesan yang muat sebagai keterangan', () => {
    expect(periksaPanjangKeterangan('x'.repeat(900), 50).ok).toBe(true);
  });

  it('menolak bila body + baris kode melewati batas WhatsApp', () => {
    // Jebakan yang tidak terlihat sampai pesan pertama gagal: pesan TEKS boleh
    // panjang, tapi begitu ada lampiran ia menjadi keterangan dan tunduk pada
    // batas yang jauh lebih pendek.
    const hasil = periksaPanjangKeterangan('x'.repeat(MAX_KETERANGAN), 45);
    expect(hasil.ok).toBe(false);
    expect(hasil.error).toContain('1024');
  });

  it('menghitung baris kode pengiriman, bukan hanya isi ketikan staf', () => {
    const nyaris = 'x'.repeat(MAX_KETERANGAN - 10);
    expect(periksaPanjangKeterangan(nyaris, 0).ok).toBe(true);
    expect(periksaPanjangKeterangan(nyaris, 50).ok).toBe(false);
  });
});

describe('namaBerkasSimpanan', () => {
  it('memakai ekstensi dari MIME, bukan dari nama unggahan', () => {
    expect(namaBerkasSimpanan('image/jpeg', 'a1b2c3')).toBe('a1b2c3.jpg');
    expect(namaBerkasSimpanan('application/pdf', 'a1b2c3')).toBe('a1b2c3.pdf');
  });

  it('menolak komponen acak yang bukan alfanumerik', () => {
    // Penjaga lintasan berkas: tidak ada jalur di mana masukan luar bisa
    // menentukan lokasi tulis.
    for (const jahat of ['../../.env', 'a/b', 'a.b', '', 'a b']) {
      expect(namaBerkasSimpanan('image/png', jahat)).toBeNull();
    }
  });

  it('menolak MIME yang tidak dikenal', () => {
    expect(namaBerkasSimpanan('application/x-msdownload', 'a1b2c3')).toBeNull();
  });
});

describe('jenisLampiranDari', () => {
  it('tidak peka huruf besar-kecil dan spasi', () => {
    expect(jenisLampiranDari('  IMAGE/JPEG ')?.ext).toBe('jpg');
  });

  it('menandai gambar terpisah dari dokumen', () => {
    expect(jenisLampiranDari('image/png')?.gambar).toBe(true);
    expect(jenisLampiranDari('application/pdf')?.gambar).toBe(false);
  });
});

describe('formatUkuran', () => {
  it('memakai koma sebagai desimal (id-ID)', () => {
    expect(formatUkuran(1_500_000)).toBe('1,4 MB');
    expect(formatUkuran(2048)).toBe('2 KB');
    expect(formatUkuran(500)).toBe('500 B');
  });
});
