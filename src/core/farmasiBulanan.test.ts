import {
  gabungBulanan,
  formatRincianBarang,
  formatRincianMutu,
  judulBulan,
  type BulananMentah,
} from './farmasiBulanan';
import { renderTemplate } from './template';

/**
 * Yang dijaga: perilaku pada bulan yang sebagian besarnya KOSONG (keadaan
 * sungguhan di instalasi ini -- pemesanan dan hibah nol pada setiap bulan),
 * penurunan yang harus berjumlah, dan pagar multiline.
 */

/** Bulan Juli 2026 sebagaimana benar-benar terukur di database produksi. */
function juli(): BulananMentah {
  return {
    resep: {
      jml_resep: 685,
      jml_kunjungan: 634,
      belum_validasi: 0,
      belum_serah: 175,
      tanpa_telaah: 145,
    },
    item: { jml_baris: 3046, jml_obat: 19161 },
    racikan: { jml_racikan: 24 },
    nilai: { nilai_obat: 17539001 },
    pasien: { jml_pasien: 541 },
    pengadaan: { jml: 26, nilai: 23832476 },
    pemesanan: { jml: 0, nilai: 0 },
    hibah: { jml: 0, nilai: 0 },
    penjualan: { jml: 716, nilai: 3820 },
    penjualanNilai: { nilai: 15026058 },
  };
}

describe('gabungBulanan', () => {
  it('membaca angka terukur apa adanya', () => {
    const r = gabungBulanan('202607', juli());
    expect(r.jmlResep).toBe(685);
    expect(r.jmlPasien).toBe(541);
    expect(r.jmlKunjungan).toBe(634);
    expect(r.jmlBaris).toBe(3046);
    expect(r.jmlRacikan).toBe(24);
    expect(r.nilaiObat).toBe(17539001);
  });

  it('mengambil nilai penjualan dari query TERPISAH, bukan kolom nilainya sendiri', () => {
    // `penjualan.ongkir` (3.820) adalah PENYESUAIAN, bukan total. Totalnya hidup
    // di `detailjual` dan datang lewat query kedua -- menjoinkannya akan
    // menghitung ongkir sekali per BARANG.
    const r = gabungBulanan('202607', juli());
    expect(r.penjualan.jml).toBe(716);
    expect(r.penjualan.nilai).toBe(15026058);
  });

  it('MENURUNKAN diserahkan dan ditelaah, sehingga keduanya berjumlah', () => {
    const r = gabungBulanan('202607', juli());
    expect(r.jmlDiserahkan + r.jmlBelumSerah).toBe(r.jmlResep);
    expect(r.jmlAdaTelaah + r.jmlTanpaTelaah).toBe(r.jmlResep);
    expect(r.jmlDiserahkan).toBe(510);
    expect(r.jmlAdaTelaah).toBe(540);
  });

  it('menjepit di nol saat penghitungnya melebihi jumlah resep', () => {
    // "-3 sudah ditelaah" jauh lebih merusak kepercayaan daripada nol yang
    // sedikit meleset.
    const r = gabungBulanan('202607', {
      resep: { jml_resep: 10, belum_serah: 99, tanpa_telaah: 99 },
    });
    expect(r.jmlDiserahkan).toBe(0);
    expect(r.jmlAdaTelaah).toBe(0);
  });

  it('menerima agregat sebagai string dari mysql2', () => {
    const r = gabungBulanan('202607', {
      resep: { jml_resep: '685', belum_serah: '175', tanpa_telaah: '145' },
      nilai: { nilai_obat: '17539001' },
    });
    expect(r.jmlResep).toBe(685);
    expect(r.nilaiObat).toBe(17539001);
  });

  it('memperlakukan null dan agregat yang hilang sebagai nol', () => {
    const r = gabungBulanan('202607', {});
    expect(r.jmlResep).toBe(0);
    expect(r.nilaiObat).toBe(0);
    expect(r.pengadaan.jml).toBe(0);
    expect(r.penjualan.nilai).toBe(0);
  });

  describe('kosong', () => {
    it('bulan tanpa satu pun kegiatan farmasi = kosong', () => {
      expect(gabungBulanan('202607', {}).kosong).toBe(true);
    });

    it('bulan tanpa resep TAPI ada penjualan BUKAN kosong', () => {
      // Rekap harian resep memakai `jmlResep === 0` dan itu benar di sana. Di
      // sini mendiamkannya menyembunyikan keadaan yang paling perlu dilihat:
      // peresepan berhenti sementara loket tetap berjalan.
      const r = gabungBulanan('202607', { penjualan: { jml: 716, nilai: 0 } });
      expect(r.kosong).toBe(false);
    });

    it('bulan tanpa resep TAPI ada pengadaan BUKAN kosong', () => {
      const r = gabungBulanan('202607', { pengadaan: { jml: 26, nilai: 1 } });
      expect(r.kosong).toBe(false);
    });

    it('bulan berisi resep saja BUKAN kosong', () => {
      const r = gabungBulanan('202607', { resep: { jml_resep: 1 } });
      expect(r.kosong).toBe(false);
    });
  });
});

describe('formatRincianBarang', () => {
  it('menyebut KEEMPAT jalur, termasuk yang nol', () => {
    // Permintaan eksplisit pemilik sistem. Menyembunyikan yang nol membuat
    // "tidak ada pesanan" tidak bisa dibedakan dari "fiturnya tidak membacanya".
    const teks = formatRincianBarang(gabungBulanan('202607', juli()));
    const baris = teks.split('\n');
    expect(baris).toHaveLength(4);
    expect(teks).toContain('Pengadaan : 26 faktur');
    expect(teks).toContain('Pemesanan : 0 surat, Rp0');
    expect(teks).toContain('Hibah : 0 penerimaan, Rp0');
    expect(teks).toContain('Penjualan : 716 nota');
  });

  it('selalu menyertakan rupiah, supaya kolomnya bisa dijumlahkan', () => {
    const teks = formatRincianBarang(gabungBulanan('202607', juli()));
    for (const baris of teks.split('\n')) expect(baris).toMatch(/Rp/);
  });

  it('bulan yang seluruhnya kosong tetap menghasilkan empat baris', () => {
    expect(formatRincianBarang(gabungBulanan('202607', {})).split('\n')).toHaveLength(4);
  });
});

describe('formatRincianMutu', () => {
  it('menyebut ketiga angka "yang tidak" berikut persentasenya', () => {
    const teks = formatRincianMutu(gabungBulanan('202607', juli()));
    expect(teks).toContain('Belum divalidasi : 0 (0%)');
    expect(teks).toContain('Belum diserahkan : 175 (25,5%)');
    expect(teks).toContain('Belum ditelaah : 145 (21,2%)');
  });

  it('TANPA persentase saat tidak ada resep sama sekali', () => {
    // "NaN%" terbaca sebagai sistem rusak; "0%" terbaca sebagai kabar baik.
    // Keduanya berbohong ke arah yang berbeda.
    const teks = formatRincianMutu(gabungBulanan('202607', {}));
    expect(teks).not.toMatch(/NaN/);
    expect(teks).not.toMatch(/%/);
    expect(teks).toContain('Belum diserahkan : 0');
  });
});

describe('judulBulan', () => {
  it('menerjemahkan ke nama bulan Indonesia', () => {
    expect(judulBulan(gabungBulanan('202607', {}))).toBe('Juli 2026');
  });
});

describe('pagar MULTILINE -- uji PERILAKU, bukan keanggotaan himpunan', () => {
  it('rincian_barang tetap EMPAT baris sesudah renderTemplate', () => {
    // Yang dijaga adalah AKIBATNYA, dan akibat itu gagal DIAM: di luar
    // MULTILINE_VARIABLES daftarnya terlipat jadi satu baris lalu terpotong di
    // 60 karakter, tanpa satu pun galat.
    const r = gabungBulanan('202607', juli());
    const hasil = renderTemplate('{rincian_barang}', { rincian_barang: formatRincianBarang(r) });
    expect(hasil.split('\n')).toHaveLength(4);
    expect(hasil).toContain('Penjualan');
  });

  it('rincian_mutu tetap TIGA baris sesudah renderTemplate', () => {
    const r = gabungBulanan('202607', juli());
    const hasil = renderTemplate('{rincian_mutu}', { rincian_mutu: formatRincianMutu(r) });
    expect(hasil.split('\n')).toHaveLength(3);
    expect(hasil).toContain('Belum ditelaah');
  });

  it('keduanya hanya berisi literal dan angka -- tanpa nilai dari sik', () => {
    // Inilah syarat yang membuat keduanya aman TANPA sanitizeValue, dan yang
    // akan gugur begitu ada yang menambahkan nama pemasok atau nama petugas.
    const r = gabungBulanan('202607', juli());
    const gabung = `${formatRincianBarang(r)}\n${formatRincianMutu(r)}`;
    // Setiap baris: "• <Kata Latin> : <angka/rupiah/persen>". Tidak ada tempat
    // bagi teks bebas untuk muncul.
    for (const baris of gabung.split('\n')) {
      expect(baris).toMatch(/^• [A-Za-z ]+ : [0-9.,]+( [a-z]+)?(, Rp[0-9.,]+)?( \([0-9,]+%\))?$/);
    }
  });
});
