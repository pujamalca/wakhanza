import {
  namaPemberiHibah,
  formatDaftarBarangHibah,
  pecahDaftarBarangHibah,
  kelompokkanDetailHibah,
  type BarisDetailHibah,
} from './hibah';
import { BATAS_KARAKTER_NOTA, nilaiSama } from './notaBarang';

function item(nama: string, extra: Partial<BarisDetailHibah> = {}): BarisDetailHibah {
  return { no_hibah: 'HO20260807001', kode_brng: 'B000000001', nama_brng: nama, satuan: 'Botol', jumlah: 10, ...extra };
}

describe('namaPemberiHibah', () => {
  test('meneruskan nama pemberi yang sungguhan', () => {
    expect(namaPemberiHibah('DINKES PROPINSI')).toBe('DINKES PROPINSI');
  });

  /**
   * `pemberihibah.nama_pemberi = '-'` benar-benar ada di database uji (baris
   * H0001). Diteruskan apa adanya, notanya berbunyi "Asal hibah : -".
   */
  test('penanda "tidak diisi" jadi kosong, bukan tanda hubung', () => {
    expect(namaPemberiHibah('-')).toBe('');
    expect(namaPemberiHibah('--')).toBe('');
    expect(namaPemberiHibah('   ')).toBe('');
    expect(namaPemberiHibah(null)).toBe('');
    expect(namaPemberiHibah(undefined)).toBe('');
  });
});

describe('daftar barang hibah', () => {
  test('tanpa nilai saat kolomnya tidak di-SELECT', () => {
    expect(formatDaftarBarangHibah([item('Spuit 3 cc')])).toBe('• Spuit 3 cc — 10 Botol');
  });

  test('memakai nilai DIAKUI sebagai angka utama', () => {
    expect(formatDaftarBarangHibah([item('Spuit 3 cc', { h_hibah: 2000, h_diakui: 2000, subtotaldiakui: 20000 })])).toBe(
      '• Spuit 3 cc — 10 Botol @ Rp2.000 = Rp20.000',
    );
  });

  /**
   * Inti keputusan modul ini: pada seluruh 14 baris rincian yang ada di database
   * uji, nilai yang disebut pemberi sama persis dengan yang diakui. Mencetak
   * keduanya di tiap baris menggandakan panjang pesan untuk informasi nol.
   */
  test('tidak menyebut nilai pemberi saat sama dengan yang diakui', () => {
    const teks = formatDaftarBarangHibah([item('Spuit', { h_hibah: 2000, h_diakui: 2000, subtotaldiakui: 20000 })]);
    expect(teks).not.toContain('disebut pemberi');
  });

  test('menyebut nilai pemberi saat BERBEDA dari yang diakui', () => {
    const teks = formatDaftarBarangHibah([item('Spuit', { h_hibah: 3000, h_diakui: 2000, subtotaldiakui: 20000 })]);
    expect(teks).toBe('• Spuit — 10 Botol @ Rp2.000 = Rp20.000 (disebut pemberi Rp3.000)');
  });

  /**
   * mysql2 menyerahkan `double` kadang sebagai string dan kadang sebagai number,
   * jadi perbandingan `===` mentah akan melaporkan selisih pada dua angka yang
   * sebenarnya sama -- dan seluruh notanya lalu terbaca seperti ada yang salah.
   */
  test('angka yang sama tetap sama walau salah satunya string', () => {
    const teks = formatDaftarBarangHibah([
      item('Spuit', { h_hibah: '2000' as unknown as number, h_diakui: 2000, subtotaldiakui: 20000 }),
    ]);
    expect(teks).not.toContain('disebut pemberi');
  });

  /**
   * `null` bukan "kebetulan cocok". Nilai pemberi yang tidak tercatat sementara
   * yang diakui ada adalah keadaan yang berbeda dari keduanya sama, tapi tidak
   * ada angka yang bisa disebut -- jadi keterangannya dilewati, bukan dicetak
   * "(disebut pemberi )".
   */
  test('nilai pemberi yang kosong tidak menghasilkan keterangan hampa', () => {
    const teks = formatDaftarBarangHibah([item('Spuit', { h_hibah: null, h_diakui: 2000, subtotaldiakui: 20000 })]);
    expect(teks).toBe('• Spuit — 10 Botol @ Rp2.000 = Rp20.000');
  });

  test('nilai nol TIDAK sama dengan nilai yang tidak tercatat', () => {
    expect(nilaiSama(0, null)).toBe(false);
    expect(nilaiSama(0, 0)).toBe(true);
  });

  /**
   * `{daftar_barang}` dikecualikan dari sanitizeValue (MULTILINE_VARIABLES), jadi
   * setiap baris baru pada hasil akhir WAJIB berasal dari kode kita. Persis
   * lubang ARCHITECTURE §9.2.
   */
  test('membuang baris baru dari nama barang yang diketik petugas', () => {
    const jahat = item('Spuit\n• Barang palsu — 999 Box');
    const teks = formatDaftarBarangHibah([jahat]);
    // Yang dijaga adalah BARIS BARUNYA, bukan katanya. `sanitizeValue` mengubah
    // baris baru jadi spasi, jadi teks sisipannya memang masih terbaca -- tapi
    // sebagai bagian dari nama barang yang sama, bukan sebagai butir tersendiri.
    // Itu tepat yang dibutuhkan: yang berbahaya adalah butir palsu yang tampak
    // setara dengan butir sungguhan, bukan nama barang yang aneh.
    expect(teks.split('\n')).toHaveLength(1);
    expect(teks.startsWith('• ')).toBe(true);
  });

  test('membuang baris baru dari satuan juga', () => {
    const teks = formatDaftarBarangHibah([item('Spuit', { satuan: 'Box\nPalsu' })]);
    expect(teks.split('\n')).toHaveLength(1);
  });

  test('jatuh ke kode barang saat namanya kosong', () => {
    expect(formatDaftarBarangHibah([item('', { kode_brng: 'B000009999' })])).toContain('B000009999');
  });

  test('satu baris per barang', () => {
    const teks = formatDaftarBarangHibah([item('A'), item('B'), item('C')]);
    expect(teks.split('\n')).toHaveLength(3);
  });
});

describe('pecahDaftarBarangHibah', () => {
  test('tidak memecah daftar yang muat, dan tidak menandainya "bagian"', () => {
    const bagian = pecahDaftarBarangHibah([item('A'), item('B')], BATAS_KARAKTER_NOTA);
    expect(bagian).toHaveLength(1);
    expect(bagian[0]).not.toContain('bagian');
  });

  test('tidak pernah kehilangan satu barang pun saat terpecah', () => {
    const rows = Array.from({ length: 60 }, (_, i) => item(`Barang nomor ${i}`));
    const bagian = pecahDaftarBarangHibah(rows, 400);
    expect(bagian.length).toBeGreaterThan(1);
    const gabung = bagian.join('\n');
    for (let i = 0; i < 60; i++) expect(gabung).toContain(`Barang nomor ${i}`);
  });

  test('daftar kosong menghasilkan nol bagian, bukan satu bagian kosong', () => {
    expect(pecahDaftarBarangHibah([], BATAS_KARAKTER_NOTA)).toEqual([]);
  });
});

describe('kelompokkanDetailHibah', () => {
  test('memisahkan rincian beberapa hibah yang datang dari satu query IN', () => {
    const peta = kelompokkanDetailHibah([
      item('A'),
      item('B', { no_hibah: 'HO20260807002' }),
      item('C'),
    ]);
    expect(peta.get('HO20260807001')).toHaveLength(2);
    expect(peta.get('HO20260807002')).toHaveLength(1);
  });

  test('tidak bisa tertipu oleh kunci bawaan objek', () => {
    const peta = kelompokkanDetailHibah([item('A', { no_hibah: 'constructor' })]);
    expect(peta.get('constructor')).toHaveLength(1);
    expect(peta.get('HO20260807001')).toBeUndefined();
  });
});
