import { pemicuSegmen, perluMuatSegmen } from './segmentGate';

const polos = { modePilih: false };

describe('pemicuSegmen', () => {
  it('halaman dibuka polos -> tidak membaca apa pun', () => {
    expect(pemicuSegmen(polos)).toBeNull();
    expect(perluMuatSegmen(polos)).toBe(false);
  });

  /**
   * Bentuk yang benar-benar dikirim form GET kedua halaman: seluruh kunci
   * filter ikut walau kosong. Kalau gerbangnya menyimpulkan "ada filter ->
   * baca", pemuatan pertama akan selalu lolos dan fiturnya mati diam.
   */
  it('kunci filter yang ada tapi KOSONG tetap bukan permintaan', () => {
    expect(pemicuSegmen({ ...polos, cari: '', tampil: '', preset: '' })).toBeNull();
    expect(pemicuSegmen({ ...polos, cari: '   ', tampil: [''], preset: [] })).toBeNull();
  });

  it('mengetik di kotak cari -> dibaca', () => {
    expect(pemicuSegmen({ ...polos, cari: 'Budi' })).toBe('cari');
  });

  it('menekan Terapkan -> dibaca', () => {
    expect(pemicuSegmen({ ...polos, tampil: '1' })).toBe('diminta');
  });

  // Tombol preset tanggal adalah permintaan yang sama tegasnya dengan Terapkan;
  // tanpa ini, menekan "3 bulan terakhir" tidak menampilkan apa pun dan
  // terbaca sebagai tombol yang rusak.
  it('menekan tombol preset -> dibaca', () => {
    expect(pemicuSegmen({ ...polos, preset: '3m' })).toBe('diminta');
    expect(pemicuSegmen({ ...polos, preset: ['semua'] })).toBe('diminta');
  });

  /**
   * Tabel mode pilih adalah DAFTAR PENERIMANYA. Tidak membacanya berarti
   * centang yang sudah ada tidak bisa dilepas dari satu-satunya layar tempat
   * ia terlihat.
   */
  it('mode pilih SELALU dibaca, walau tanpa pencarian maupun Terapkan', () => {
    expect(pemicuSegmen({ modePilih: true })).toBe('pilih');
  });

  it('mode pilih menang atas pencarian -- di sana query segmen memang tidak dipakai', () => {
    expect(pemicuSegmen({ modePilih: true, cari: 'Budi', tampil: '1' })).toBe('pilih');
  });

  it('pencarian menang atas Terapkan -- keduanya membaca, alasannya yang berbeda', () => {
    expect(pemicuSegmen({ ...polos, cari: 'Budi', tampil: '1' })).toBe('cari');
  });
});
