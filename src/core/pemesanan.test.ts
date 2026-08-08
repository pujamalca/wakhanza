import {
  formatDaftarBarangPemesanan,
  pecahDaftarBarangPemesanan,
  kelompokkanDetailPemesanan,
  type BarisDetailPemesanan,
} from './pemesanan';
import { BATAS_KARAKTER_NOTA } from './notaBarang';

function item(nama: string, extra: Partial<BarisDetailPemesanan> = {}): BarisDetailPemesanan {
  return {
    no_pemesanan: 'SPM260807001',
    kode_brng: 'B000000001',
    nama_brng: nama,
    satuan: 'Strip',
    jumlah: 10,
    ...extra,
  };
}

describe('daftar barang pemesanan', () => {
  test('tanpa harga saat kolomnya tidak di-SELECT', () => {
    expect(formatDaftarBarangPemesanan([item('Paracetamol 500 mg')])).toBe('• Paracetamol 500 mg — 10 Strip');
  });

  test('dengan harga saat kolomnya ikut di-SELECT', () => {
    expect(formatDaftarBarangPemesanan([item('Paracetamol 500 mg', { h_pesan: 787, total: 7870 })])).toBe(
      '• Paracetamol 500 mg — 10 Strip @ Rp787 = Rp7.870',
    );
  });

  /**
   * Inti keputusan modul ini, dan satu-satunya tempat `total` bisa berbeda dari
   * `subtotal`.
   *
   * Diukur atas 122 baris rincian sungguhan: diskon baris terpakai pada SATU
   * baris, dan pada baris itu pula keduanya berselisih. Yang dicetak wajib
   * `total` (sesudah diskon) supaya daftar barangnya menjumlah ke `{tagihan}` di
   * kepala nota; memilih `subtotal` tidak menghasilkan galat apa pun, cuma nota
   * yang angkanya tidak cocok pada pesanan yang kebetulan ada diskonnya.
   */
  test('memakai total sesudah diskon, bukan jumlah x harga', () => {
    // jumlah 10 x Rp787 = Rp7.870, tapi setelah diskon totalnya Rp7.000.
    const teks = formatDaftarBarangPemesanan([item('Paracetamol', { h_pesan: 787, total: 7000 })]);
    expect(teks).toBe('• Paracetamol — 10 Strip @ Rp787 = Rp7.000');
    expect(teks).not.toContain('7.870');
  });

  /**
   * `h_pesan` NULLABLE di Khanza. `Number(null)` menjawab 0 dan lolos
   * `Number.isFinite`, jadi tanpa penjaga di `keAngka()` harga yang tidak
   * tercatat dicetak "Rp0" -- bukan "tidak diketahui" melainkan "gratis", pada
   * angka yang dipakai gudang mencocokkan pesanan dengan penawaran pemasok.
   */
  test('harga yang tidak tercatat DIHILANGKAN, bukan dicetak Rp0', () => {
    const teks = formatDaftarBarangPemesanan([item('Paracetamol', { h_pesan: null, total: null })]);
    expect(teks).toBe('• Paracetamol — 10 Strip');
    expect(teks).not.toContain('Rp0');
  });

  test('nol yang SUNGGUHAN tetap dicetak Rp0', () => {
    expect(formatDaftarBarangPemesanan([item('Sampel gratis', { h_pesan: 0, total: 0 })])).toBe(
      '• Sampel gratis — 10 Strip @ Rp0 = Rp0',
    );
  });

  /** mysql2 menyerahkan `double` kadang sebagai string. */
  test('menerima angka yang datang sebagai string', () => {
    const baris = { ...item('Paracetamol'), h_pesan: '787' as unknown as number, total: '7870' as unknown as number };
    expect(formatDaftarBarangPemesanan([baris])).toBe('• Paracetamol — 10 Strip @ Rp787 = Rp7.870');
  });

  test('jatuh ke kode barang saat namanya kosong', () => {
    expect(formatDaftarBarangPemesanan([item('', { nama_brng: null })])).toBe('• B000000001 — 10 Strip');
  });

  /**
   * `{daftar_barang}` DIKECUALIKAN dari sanitizeValue (MULTILINE_VARIABLES),
   * jadi setiap baris baru pada hasil akhir wajib berasal dari kode di sini.
   * Nama barang diketik bebas petugas gudang -- persis lubang §9.2 kalau
   * sanitasinya dilewatkan.
   */
  test('nama barang tidak bisa menyisipkan barisnya sendiri', () => {
    const teks = formatDaftarBarangPemesanan([
      item('Paracetamol\n• Morfin 10 mg — 100 Ampul', { satuan: 'Strip\nBox' }),
    ]);
    expect(teks.split('\n')).toHaveLength(1);
    expect(teks).not.toContain('\n');
  });
});

describe('pemecahan daftar pemesanan', () => {
  test('satu pesan selama masih muat, tanpa penanda bagian', () => {
    const bagian = pecahDaftarBarangPemesanan([item('A'), item('B')], BATAS_KARAKTER_NOTA);
    expect(bagian).toHaveLength(1);
    expect(bagian[0]).not.toContain('bagian');
  });

  test('memecah dan menandai saat melewati batas', () => {
    const banyak = Array.from({ length: 40 }, (_, i) => item(`Barang nomor ${i} dengan nama yang panjang sekali`));
    const bagian = pecahDaftarBarangPemesanan(banyak, 300);
    expect(bagian.length).toBeGreaterThan(1);
    expect(bagian[0]).toContain(`bagian 1 dari ${bagian.length}`);
    // Tidak satu pun baris barang terbelah di tengah.
    for (const b of bagian) {
      for (const baris of b.split('\n')) {
        expect(baris === '' || baris.startsWith('•') || baris.startsWith('_(bagian')).toBe(true);
      }
    }
  });

  test('daftar kosong tidak menghasilkan bagian apa pun', () => {
    expect(pecahDaftarBarangPemesanan([], BATAS_KARAKTER_NOTA)).toEqual([]);
    expect(formatDaftarBarangPemesanan([])).toBe('');
  });
});

describe('kelompokkanDetailPemesanan', () => {
  test('memisahkan rincian menurut nomor pemesanannya', () => {
    const rows = [
      item('A'),
      item('B'),
      { ...item('C'), no_pemesanan: 'SPM260807002' },
    ];
    const per = kelompokkanDetailPemesanan(rows);
    expect(per.get('SPM260807001')).toHaveLength(2);
    expect(per.get('SPM260807002')).toHaveLength(1);
  });

  /**
   * `Map`, bukan objek biasa: nomornya datang dari database, dan objek biasa
   * punya kunci bawaan yang bisa bertabrakan dengannya.
   */
  test('nomor yang bertabrakan dengan kunci bawaan objek tetap aman', () => {
    const per = kelompokkanDetailPemesanan([{ ...item('A'), no_pemesanan: 'constructor' }]);
    expect(per.get('constructor')).toHaveLength(1);
    expect(per.get('__proto__')).toBeUndefined();
  });
});
