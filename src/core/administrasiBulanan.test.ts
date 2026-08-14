import {
  gabungAdmBulanan,
  formatRincianCaraBayar,
  formatRincianBerkas,
  formatRincianPasien,
  judulBulanAdm,
  type AdmBulananMentah,
} from './administrasiBulanan';
import { renderTemplate } from './template';

/**
 * Yang dijaga: penurunan yang harus BERJUMLAH, perilaku pada angka yang terukur
 * nol di produksi (resume dan surat kontrol), penanganan penanda kosong Khanza
 * pada nama penjamin, dan pagar multiline -- yang di sini memikul lebih daripada
 * di rekap farmasi karena satu variabelnya memang membawa nilai dari `sik`.
 */

/** Juli 2026 sebagaimana benar-benar terukur di database produksi. */
function juli(): AdmBulananMentah {
  return {
    kunjungan: {
      jml_kunjungan: 668,
      jml_pasien: 563,
      jml_batal: 2,
      jml_baru: 191,
      jml_belum_bayar: 10,
      ada_resep: 634,
      ada_diagnosa: 3,
      ada_soapie: 486,
      ada_resume: 0,
      baru_tanpa_asesmen: 97,
    },
    caraBayar: [
      { kd_pj: 'A01', png_jawab: 'UMUM', jml_kunjungan: 473, jml_pasien: 411 },
      { kd_pj: 'A02', png_jawab: 'BPJS Kesehatan', jml_kunjungan: 195, jml_pasien: 156 },
    ],
    berulang: { jml_pasien_berulang: 81, jml_kunjungan_berulang: 186 },
    suratSakit: { jml: 0 },
    kontrolSkdp: { jml: 0 },
    kontrolBridging: { jml: 0 },
  };
}

describe('gabungAdmBulanan', () => {
  it('membaca angka terukur apa adanya', () => {
    const r = gabungAdmBulanan('202607', juli());
    expect(r.jmlKunjungan).toBe(668);
    expect(r.jmlPasien).toBe(563);
    expect(r.jmlBatal).toBe(2);
    expect(r.jmlBaru).toBe(191);
    expect(r.jmlBelumBayar).toBe(10);
    expect(r.jmlAdaSoapie).toBe(486);
    expect(r.jmlBerulang).toBe(81);
    expect(r.jmlKunjunganBerulang).toBe(186);
  });

  it('MENURUNKAN ketiga pasangannya, sehingga semuanya berjumlah', () => {
    const r = gabungAdmBulanan('202607', juli());
    expect(r.jmlBaru + r.jmlLama).toBe(r.jmlKunjungan);
    expect(r.jmlAdaResep + r.jmlTanpaResep).toBe(r.jmlKunjungan);
    expect(r.jmlBaruAdaAsesmen + r.jmlBaruTanpaAsesmen).toBe(r.jmlBaru);
    expect(r.jmlLama).toBe(477);
    expect(r.jmlTanpaResep).toBe(34);
    expect(r.jmlBaruAdaAsesmen).toBe(94);
  });

  it('menjepit di nol saat penghitungnya melebihi pembaginya', () => {
    // "-3 pasien lama" jauh lebih merusak kepercayaan daripada nol yang sedikit
    // meleset.
    const r = gabungAdmBulanan('202607', {
      kunjungan: { jml_kunjungan: 10, jml_baru: 99, ada_resep: 99, baru_tanpa_asesmen: 999 },
    });
    expect(r.jmlLama).toBe(0);
    expect(r.jmlTanpaResep).toBe(0);
    expect(r.jmlBaruAdaAsesmen).toBe(0);
  });

  it('menerima agregat sebagai string dari mysql2', () => {
    const r = gabungAdmBulanan('202607', {
      kunjungan: { jml_kunjungan: '668', jml_baru: '191', ada_resep: '634' },
      berulang: { jml_pasien_berulang: '81', jml_kunjungan_berulang: '186' },
    });
    expect(r.jmlKunjungan).toBe(668);
    expect(r.jmlLama).toBe(477);
    expect(r.jmlKunjunganBerulang).toBe(186);
  });

  it('memperlakukan null dan agregat yang hilang sebagai nol', () => {
    const r = gabungAdmBulanan('202607', {});
    expect(r.jmlKunjungan).toBe(0);
    expect(r.jmlPasien).toBe(0);
    expect(r.caraBayar).toEqual([]);
    expect(r.jmlSuratKontrol).toBe(0);
  });

  it('MENJUMLAHKAN kedua sumber surat kontrol jadi satu angka', () => {
    // Dua baris yang keduanya berbunyi 0 setiap bulan mengajari pembacanya
    // melewati bagian itu -- lihat kepala khanza/administrasiBulanan.ts.
    const r = gabungAdmBulanan('202607', {
      kontrolSkdp: { jml: 3 },
      kontrolBridging: { jml: 904 },
    });
    expect(r.jmlSuratKontrol).toBe(907);
  });

  describe('kosong', () => {
    it('bulan tanpa satu pun kunjungan = kosong', () => {
      expect(gabungAdmBulanan('202607', {}).kosong).toBe(true);
    });

    it('satu kunjungan saja sudah BUKAN kosong', () => {
      // Seluruh angka di rekap ini pecahan dari kunjungan, jadi tidak ada
      // padanan "nol resep tapi ada penjualan" seperti di rekap farmasi.
      const r = gabungAdmBulanan('202607', { kunjungan: { jml_kunjungan: 1 } });
      expect(r.kosong).toBe(false);
    });
  });

  describe('nama penjamin', () => {
    it('membuang penanda kosong Khanza', () => {
      // `penjab.png_jawab` bisa berisi '-', pola yang sama dengan
      // `pasien.pekerjaan` dan `hibah.nama_pemberi`. Diteruskan apa adanya,
      // barisnya berbunyi "- : 49 kunjungan".
      const r = gabungAdmBulanan('202607', {
        caraBayar: [{ kd_pj: 'A03', png_jawab: '-', jml_kunjungan: 49, jml_pasien: 40 }],
      });
      expect(r.caraBayar[0]!.nama).toBe('');
    });

    it('memangkas nama yang kelewat panjang', () => {
      const r = gabungAdmBulanan('202607', {
        caraBayar: [{ kd_pj: 'A04', png_jawab: 'X'.repeat(200), jml_kunjungan: 1, jml_pasien: 1 }],
      });
      expect(r.caraBayar[0]!.nama.length).toBeLessThanOrEqual(60);
    });
  });
});

describe('formatRincianCaraBayar', () => {
  it('menyebut tiap penjamin berikut porsi dan jumlah pasiennya', () => {
    const teks = formatRincianCaraBayar(gabungAdmBulanan('202607', juli()));
    expect(teks.split('\n')).toHaveLength(2);
    expect(teks).toContain('UMUM : 473 kunjungan (70,8%), 411 pasien');
    expect(teks).toContain('BPJS Kesehatan : 195 kunjungan (29,2%), 156 pasien');
  });

  it('memakai KODE saat nama penjaminnya tidak terbaca dari master', () => {
    // Membuangnya membuat jumlah pecahannya lebih kecil daripada
    // {jumlah_kunjungan} tanpa satu pun keterangan; baris tanpa label membuat
    // angkanya tidak bisa ditelusuri ke mana pun.
    const teks = formatRincianCaraBayar(
      gabungAdmBulanan('202607', {
        kunjungan: { jml_kunjungan: 10 },
        caraBayar: [{ kd_pj: 'A09', png_jawab: null, jml_kunjungan: 10, jml_pasien: 9 }],
      }),
    );
    expect(teks).toContain('(kode A09) : 10 kunjungan');
  });

  it('bulan tanpa kunjungan menghasilkan keterangan, bukan baris kosong', () => {
    expect(formatRincianCaraBayar(gabungAdmBulanan('202607', {}))).toBe('(tidak ada kunjungan)');
  });
});

describe('formatRincianBerkas', () => {
  it('ditulis dari sisi yang TERISI, berikut persentasenya', () => {
    // Sisi "belum" akan berbunyi "Diagnosa 99,6%" dan "Resume 100%" -- angka yang
    // terbaca sebagai sistem rusak alih-alih sebagai keadaan.
    const teks = formatRincianBerkas(gabungAdmBulanan('202607', juli()));
    expect(teks).toContain('Resep : 634 (94,9%)');
    expect(teks).toContain('SOAPIE : 486 (72,8%)');
    expect(teks).toContain('Diagnosa : 3 (0,4%)');
    expect(teks).toContain('Resume : 0 (0%)');
  });

  it('asesmen awal memakai PASIEN BARU sebagai pembagi, dan menyebutkannya', () => {
    // Tanpa itu "94 (14,1%)" terbaca seolah 86% kunjungan melanggar aturan yang
    // sebenarnya tidak berlaku bagi mereka.
    const teks = formatRincianBerkas(gabungAdmBulanan('202607', juli()));
    expect(teks).toContain('Asesmen awal : 94 dari 191 pasien baru (49,2%)');
  });

  it('TANPA persentase saat tidak ada kunjungan sama sekali', () => {
    const teks = formatRincianBerkas(gabungAdmBulanan('202607', {}));
    expect(teks).not.toMatch(/NaN/);
    expect(teks).not.toMatch(/%/);
    expect(teks).toContain('Resep : 0');
  });
});

describe('formatRincianPasien', () => {
  it('memisahkan pasien lama dari pasien yang berulang bulan itu', () => {
    // Keduanya gampang tertukar: "lama" bisa saja datang sekali bulan ini,
    // "berulang" adalah yang bolak-balik DI DALAM bulan yang direkap.
    const teks = formatRincianPasien(gabungAdmBulanan('202607', juli()));
    expect(teks).toContain('Pasien baru : 191 kunjungan (28,6%)');
    expect(teks).toContain('Pasien lama : 477 kunjungan (71,4%)');
    expect(teks).toContain('Datang lebih dari sekali bulan ini : 81 pasien (14,4%), 186 kunjungan');
    expect(teks).toContain('Batal periksa : 2 (0,3%)');
  });

  it('pasien berulang dibagi terhadap PASIEN, bukan kunjungan', () => {
    // 81 dari 563 pasien (14,4%), bukan 81 dari 668 kunjungan (12,1%).
    const teks = formatRincianPasien(gabungAdmBulanan('202607', juli()));
    expect(teks).toContain('81 pasien (14,4%)');
    expect(teks).not.toContain('81 pasien (12,1%)');
  });
});

describe('judulBulanAdm', () => {
  it('menerjemahkan ke nama bulan Indonesia', () => {
    expect(judulBulanAdm(gabungAdmBulanan('202607', {}))).toBe('Juli 2026');
  });
});

describe('pagar MULTILINE -- uji PERILAKU, bukan keanggotaan himpunan', () => {
  it('rincian_cara_bayar tetap DUA baris sesudah renderTemplate', () => {
    // Yang dijaga adalah AKIBATNYA, dan akibat itu gagal DIAM: di luar
    // MULTILINE_VARIABLES daftarnya terlipat jadi satu baris lalu terpotong di
    // 60 karakter, tanpa satu pun galat.
    const r = gabungAdmBulanan('202607', juli());
    const hasil = renderTemplate('{rincian_cara_bayar}', {
      rincian_cara_bayar: formatRincianCaraBayar(r),
    });
    expect(hasil.split('\n')).toHaveLength(2);
    expect(hasil).toContain('BPJS Kesehatan');
  });

  it('rincian_berkas tetap LIMA baris, rincian_pasien tetap EMPAT', () => {
    const r = gabungAdmBulanan('202607', juli());
    expect(
      renderTemplate('{rincian_berkas}', { rincian_berkas: formatRincianBerkas(r) }).split('\n'),
    ).toHaveLength(5);
    expect(
      renderTemplate('{rincian_pasien}', { rincian_pasien: formatRincianPasien(r) }).split('\n'),
    ).toHaveLength(4);
  });

  /**
   * INI yang membedakan rekap ini dari rekap bulanan farmasi.
   *
   * `rincian_barang`/`rincian_mutu` aman tanpa sanitasi karena tidak satu pun
   * nilai dari `sik` masuk ke dalamnya. Di sini `png_jawab` MASUK -- input bebas
   * petugas Khanza -- jadi nama yang memuat baris baru bisa menyisipkan barisnya
   * sendiri ke dalam pesan dan memalsukan struktur pengumuman resmi RS (§9.2).
   *
   * Sanitasinya dikerjakan `gabungAdmBulanan()`, bukan perakit teksnya, supaya
   * nilainya sudah bersih juga di tabel pratinjau dashboard yang tidak melewati
   * `formatRincianCaraBayar()` sama sekali.
   */
  it('nama penjamin berisi BARIS BARU tidak boleh menambah baris', () => {
    const r = gabungAdmBulanan('202607', {
      kunjungan: { jml_kunjungan: 10 },
      caraBayar: [
        { kd_pj: 'A01', png_jawab: 'UMUM\n• Palsu : 999 kunjungan', jml_kunjungan: 10, jml_pasien: 9 },
      ],
    });
    const hasil = renderTemplate('{rincian_cara_bayar}', {
      rincian_cara_bayar: formatRincianCaraBayar(r),
    });

    /**
     * Yang dijaga JUMLAH BARISNYA, bukan ada-tidaknya teks sisipannya.
     *
     * `sanitizeValue()` melipat baris baru jadi SPASI, jadi "• Palsu : 999
     * kunjungan" memang tetap terbaca -- di dalam baris yang sama, sebagai bagian
     * dari nama yang jelas rusak. Itu tidak berbahaya: yang dicari penyisip
     * adalah BARIS tersendiri yang terbaca sebagai butir daftar yang sah.
     * Menuntut teksnya hilang berarti menuntut sensor isi, yang bukan tugas
     * sanitizeValue dan tidak pernah bisa lengkap.
     */
    expect(hasil.split('\n')).toHaveLength(1);
    expect(hasil).not.toMatch(/\n\s*•/);
  });

  it('nama penjamin sudah bersih SEBELUM perakit teksnya dipanggil', () => {
    // Dipatok terpisah karena tabel pratinjau dashboard membaca `caraBayar[]`
    // langsung, tanpa melewati formatRincianCaraBayar().
    const r = gabungAdmBulanan('202607', {
      caraBayar: [{ kd_pj: 'A01', png_jawab: 'UMUM\nBaris kedua', jml_kunjungan: 1, jml_pasien: 1 }],
    });
    expect(r.caraBayar[0]!.nama).not.toContain('\n');
  });
});
