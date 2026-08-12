import {
  gabungRekapResep,
  formatRincianDokter,
  JAM_REKAP_RESEP_BAWAAN,
  type BarisRekapResepHeader,
  type BarisRekapResepItem,
  type BarisRekapResepNilai,
  type BarisRekapResepRacikan,
} from './resepRekap';
import { renderTemplate } from './template';

function header(kd: string, ubah: Partial<BarisRekapResepHeader> = {}): BarisRekapResepHeader {
  return { kd_dokter: kd, nm_dokter: `dr ${kd}`, jml_resep: 1, jml_serah: 0, ...ubah };
}

function item(kd: string, ubah: Partial<BarisRekapResepItem> = {}): BarisRekapResepItem {
  return { kd_dokter: kd, jml_baris: 1, jml_obat: 1, ...ubah };
}

function racik(kd: string, jml: number): BarisRekapResepRacikan {
  return { kd_dokter: kd, jml_racikan: jml };
}

function nilai(kd: string, rupiah: number | string | null): BarisRekapResepNilai {
  return { kd_dokter: kd, nilai_obat: rupiah };
}

describe('gabungRekapResep', () => {
  it('menjumlahkan keempat sisi per dokter', () => {
    const r = gabungRekapResep(
      [header('D1', { jml_resep: 50, jml_serah: 36 })],
      [item('D1', { jml_baris: 235, jml_obat: 1435 })],
      [racik('D1', 2)],
      [nilai('D1', 1455477)],
    );
    expect(r.jmlResep).toBe(50);
    expect(r.jmlSerah).toBe(36);
    expect(r.jmlBelumSerah).toBe(14);
    expect(r.jmlBaris).toBe(235);
    expect(r.jmlObat).toBe(1435);
    expect(r.jmlRacikan).toBe(2);
    expect(r.nilaiObat).toBe(1455477);
    expect(r.kosong).toBe(false);
  });

  /**
   * REGRESI atas mode kegagalan yang membuat query ini sengaja EMPAT, bukan satu.
   *
   * Satu query yang menjoinkan `resep_obat` dengan `resep_dokter` lalu menghitung
   * COUNT(*) akan menghitung SATU RESEP SEBANYAK BARIS OBATNYA -- resep berisi 5
   * obat terhitung lima resep. Tidak ada galat yang muncul, dan hasilnya tetap
   * terlihat masuk akal, jadi ia bisa bertahan berbulan-bulan tanpa ada yang
   * mempertanyakannya.
   *
   * Di sini: satu resep, lima baris obat. Jumlah resepnya harus tetap SATU.
   */
  it('menghitung resep sekali per RESEP, bukan sekali per baris obat', () => {
    const r = gabungRekapResep(
      [header('D1', { jml_resep: 1, jml_serah: 1 })],
      [item('D1', { jml_baris: 5, jml_obat: 12 })],
      [],
      [nilai('D1', 90000)],
    );
    expect(r.jmlResep).toBe(1);
    expect(r.jmlSerah).toBe(1);
    expect(r.jmlBelumSerah).toBe(0);
    expect(r.jmlBaris).toBe(5);
    expect(r.nilaiObat).toBe(90000);
  });

  /**
   * Resep tanpa satu baris `resep_dokter` pun benar-benar ada -- terukur 135 dari
   * 12.422 di database ini, 66 di antaranya berisi racikan saja. Membuang sisi
   * yang kosong membuat resep racikan-saja lenyap dari hitungan, dan
   * `{jumlah_resep}` berhenti cocok dengan jumlah resep yang sungguhan.
   */
  it('mempertahankan resep yang tidak punya baris obat sama sekali', () => {
    const r = gabungRekapResep([header('D1', { jml_resep: 3 })], [], [], []);
    expect(r.jmlResep).toBe(3);
    expect(r.jmlBaris).toBe(0);
    expect(r.perDokter).toHaveLength(1);
  });

  it('mempertahankan resep racikan-saja', () => {
    const r = gabungRekapResep([header('D1', { jml_resep: 2 })], [], [racik('D1', 2)], []);
    expect(r.jmlResep).toBe(2);
    expect(r.jmlBaris).toBe(0);
    expect(r.jmlRacikan).toBe(2);
  });

  /**
   * Arah sebaliknya tidak bisa terjadi secara struktur -- `item` mengambil
   * `kd_dokter` dari `resep_obat` lewat join -- tapi ditoleransi alih-alih
   * dibuang diam-diam. Baris yang hilang tanpa suara adalah bentuk kegagalan
   * yang paling mahal di sini.
   */
  it('tidak membuang sisi item yang dokternya tidak ada di header', () => {
    const r = gabungRekapResep([], [item('D9', { jml_baris: 4, jml_obat: 9 })], [], []);
    expect(r.jmlBaris).toBe(4);
    expect(r.perDokter).toHaveLength(1);
    expect(r.perDokter[0]?.jmlResep).toBe(0);
  });

  /** Berlaku sama untuk sisi NILAI, dengan alasan yang sama persis. */
  it('tidak membuang sisi nilai yang dokternya tidak ada di header', () => {
    const r = gabungRekapResep([], [], [], [nilai('D9', 12500)]);
    expect(r.nilaiObat).toBe(12500);
    expect(r.perDokter).toHaveLength(1);
    expect(r.perDokter[0]?.jmlResep).toBe(0);
  });

  it('menerima angka yang datang sebagai string dari mysql2', () => {
    const r = gabungRekapResep(
      [header('D1', { jml_resep: '25', jml_serah: '20' })],
      [item('D1', { jml_baris: '61', jml_obat: '459' })],
      [racik('D1', 3)],
      [nilai('D1', '664360')],
    );
    expect(r.jmlResep).toBe(25);
    expect(r.jmlSerah).toBe(20);
    expect(r.jmlBelumSerah).toBe(5);
    expect(r.jmlBaris).toBe(61);
    expect(r.jmlObat).toBe(459);
    expect(r.nilaiObat).toBe(664360);
  });

  it('memperlakukan null sebagai nol, bukan NaN', () => {
    const r = gabungRekapResep(
      [header('D1', { jml_resep: 4, jml_serah: null })],
      [item('D1', { jml_baris: 2, jml_obat: null })],
      [],
      [nilai('D1', null)],
    );
    expect(r.jmlSerah).toBe(0);
    expect(r.jmlObat).toBe(0);
    expect(r.jmlBelumSerah).toBe(4);
    expect(r.nilaiObat).toBe(0);
  });

  /**
   * `diserahkan + belum = resep` adalah janji yang dibaca orang dari pesannya --
   * ia menjumlahkan dua angka di layar dan mengharapkan angka ketiga. Karena
   * `jmlBelumSerah` DITURUNKAN alih-alih di-query sendiri, janji itu aritmetika,
   * bukan kebetulan.
   */
  it('menjamin diserahkan + belum = jumlah resep', () => {
    const r = gabungRekapResep(
      [header('D1', { jml_resep: 30, jml_serah: 11 }), header('D2', { jml_resep: 7, jml_serah: 7 })],
      [],
      [],
      [],
    );
    expect(r.jmlSerah + r.jmlBelumSerah).toBe(r.jmlResep);
    for (const d of r.perDokter) expect(d.jmlSerah + d.jmlBelumSerah).toBe(d.jmlResep);
  });

  /**
   * JANJI YANG SAMA untuk rupiah, dan ia dibaca dengan cara yang persis sama:
   * pembaca melihat `{nilai_obat}` di kepala pesan lalu menjumlahkan kolom rupiah
   * pada `{rincian_dokter}` di bawahnya. Karena totalnya DIJUMLAHKAN dari baris
   * per dokter alih-alih di-query sendiri sebagai satu angka, keduanya tidak bisa
   * berbeda.
   *
   * Total dari query terpisah akan gagal DIAM di sini: rekapnya tetap tampil
   * wajar, cuma angkanya tidak berjumlah -- dan rekap yang tidak berjumlah
   * berhenti dipercaya seluruhnya, bukan sebagian.
   */
  it('menjamin total rupiah = jumlah rupiah seluruh dokter', () => {
    const r = gabungRekapResep(
      [header('D1', { jml_resep: 30 }), header('D2', { jml_resep: 7 })],
      [],
      [],
      [nilai('D1', 900000), nilai('D2', 555477)],
    );
    expect(r.nilaiObat).toBe(1455477);
    expect(r.perDokter.reduce((t, d) => t + d.nilaiObat, 0)).toBe(r.nilaiObat);
  });

  /** "-3 belum diserahkan" merusak kepercayaan jauh lebih dalam daripada nol. */
  it('tidak pernah menghasilkan sisa negatif', () => {
    const r = gabungRekapResep([header('D1', { jml_resep: 2, jml_serah: 5 })], [], [], []);
    expect(r.jmlBelumSerah).toBe(0);
    expect(r.perDokter[0]?.jmlBelumSerah).toBe(0);
  });

  it('menandai hari tanpa satu resep pun sebagai kosong', () => {
    const r = gabungRekapResep([], [], [], []);
    expect(r.kosong).toBe(true);
    expect(r.jmlResep).toBe(0);
    expect(r.nilaiObat).toBe(0);
    expect(r.perDokter).toHaveLength(0);
  });

  /**
   * Hari yang resepnya ada tapi tidak satu pun punya baris obat tetap hari yang
   * ada resepnya. Mendiamkannya menyembunyikan justru keadaan yang paling perlu
   * dilihat orang: resep masuk, isinya tidak tercatat.
   */
  it('TIDAK menandai kosong saat ada resep tanpa baris obat', () => {
    const r = gabungRekapResep([header('D1', { jml_resep: 2 })], [], [], []);
    expect(r.kosong).toBe(false);
  });

  /**
   * Resep yang belum divalidasi apotek belum punya baris penagihan sama sekali,
   * jadi ia menyumbang nol rupiah. Itu keadaan yang WAJAR (terukur 5 dari 9.038
   * resep dalam 90 hari), bukan kelainan -- dan ia tetap harus terhitung sebagai
   * resep.
   */
  it('menghitung resep yang belum punya nilai sama sekali', () => {
    const r = gabungRekapResep([header('D1', { jml_resep: 4 })], [], [], []);
    expect(r.jmlResep).toBe(4);
    expect(r.nilaiObat).toBe(0);
    expect(r.kosong).toBe(false);
  });

  it('mengurutkan dokter menurut jumlah resep, lalu nama', () => {
    const r = gabungRekapResep(
      [
        header('D1', { nm_dokter: 'Budi', jml_resep: 3 }),
        header('D2', { nm_dokter: 'Ani', jml_resep: 9 }),
        header('D3', { nm_dokter: 'Ali', jml_resep: 3 }),
      ],
      [],
      [],
      [],
    );
    expect(r.perDokter.map((d) => d.namaDokter)).toEqual(['Ani', 'Ali', 'Budi']);
  });
});

describe('formatRincianDokter', () => {
  it('menyebut resep, baris obat, dan rupiah', () => {
    const r = gabungRekapResep(
      [header('D1', { nm_dokter: 'Budi', jml_resep: 25 })],
      [item('D1', { jml_baris: 61 })],
      [],
      [nilai('D1', 664360)],
    );
    expect(formatRincianDokter(r.perDokter)).toBe('• Budi : 25 resep, 61 baris obat, Rp664.360');
  });

  /**
   * Racikan disebut HANYA bila ada. "0 racikan" di setiap baris pada apotek yang
   * meracik beberapa kali setahun mengajari pembacanya melewati bagian itu --
   * sehingga hari dengan lima racikan ikut terlewat.
   */
  it('menyebut racikan hanya bila ada', () => {
    const r = gabungRekapResep([header('D1', { nm_dokter: 'Budi' })], [], [racik('D1', 5)], []);
    expect(formatRincianDokter(r.perDokter)).toContain('5 racikan');

    const tanpa = gabungRekapResep([header('D1', { nm_dokter: 'Budi' })], [], [], []);
    expect(formatRincianDokter(tanpa.perDokter)).not.toContain('racikan');
  });

  /**
   * KEBALIKAN dari aturan racikan di atas, dan pembedaannya disengaja.
   *
   * Nol racikan adalah keadaan lazim yang tidak menuntut tindakan apa pun. Nol
   * rupiah berarti tidak satu sen pun masuk penagihan atas resep dokter itu --
   * entah apoteknya belum memvalidasi, entah ada yang salah -- dan itu persis
   * keadaan yang paling perlu terlihat. Menyembunyikannya membuat dokter yang
   * nol rupiah tidak bisa dibedakan dari dokter yang memang tidak ada di daftar.
   *
   * Ia juga syarat supaya `{nilai_obat}` di kepala pesan bisa dicocokkan dengan
   * menjumlahkan kolom rupiah di daftar ini.
   */
  it('SELALU menyebut rupiah, termasuk saat nol', () => {
    const r = gabungRekapResep([header('D1', { nm_dokter: 'Budi', jml_resep: 3 })], [], [], []);
    expect(formatRincianDokter(r.perDokter)).toContain('Rp0');
  });

  it('jatuh ke kode dokter saat namanya kosong, bukan ke baris tanpa nama', () => {
    const r = gabungRekapResep([header('D7', { nm_dokter: null })], [], [], []);
    expect(formatRincianDokter(r.perDokter)).toContain('D7');
  });

  it('memberi nama pengganti saat nama DAN kode sama-sama kosong', () => {
    const r = gabungRekapResep(
      [{ kd_dokter: '', nm_dokter: null, jml_resep: 1, jml_serah: 0 }],
      [],
      [],
      [],
    );
    expect(formatRincianDokter(r.perDokter)).toContain('(tanpa nama)');
  });

  /**
   * WAJIB, dan bukan kerapian: `{rincian_dokter}` ada di MULTILINE_VARIABLES,
   * yang artinya `renderTemplate()` TIDAK menyanitasinya lagi. Nama dokter adalah
   * input bebas petugas Khanza, jadi setiap baris baru pada hasil akhir harus
   * dipasang kode kita -- kalau tidak, satu nama yang memuat baris baru bisa
   * dipakai memalsukan struktur pesan (ARCHITECTURE §9.2).
   */
  it('menyanitasi nama dokter sendiri karena renderTemplate tidak akan', () => {
    const r = gabungRekapResep(
      [header('D1', { nm_dokter: 'Budi\n\n*Pengumuman resmi RS*' })],
      [],
      [],
      [],
    );
    const teks = formatRincianDokter(r.perDokter);
    expect(teks.split('\n')).toHaveLength(1);
    expect(teks).not.toContain('\n\n');
  });

  /**
   * SISI SEBALIKNYA dari patokan di atas, dan ia yang menjaga `{rincian_dokter}`
   * benar-benar terdaftar di MULTILINE_VARIABLES.
   *
   * Lupa mendaftarkannya tidak menghasilkan satu pun galat: `renderTemplate()`
   * akan menyanitasi nilainya, melipat seluruh daftar jadi SATU baris lalu
   * memotongnya di 60 karakter -- rekap dengan tiga dokter berubah jadi sepotong
   * kalimat tanpa ada yang tahu. Diperiksa lewat PERILAKU alih-alih keanggotaan
   * himpunannya, pola yang sama dipakai stokDarurat/pengadaan/hibah/pemesanan.
   */
  it('bertahan melewati renderTemplate tanpa dilipat atau dipotong', () => {
    const r = gabungRekapResep(
      [
        header('D1', { nm_dokter: 'Budi', jml_resep: 2 }),
        header('D2', { nm_dokter: 'Ani', jml_resep: 5 }),
        header('D3', { nm_dokter: 'Cakra', jml_resep: 1 }),
      ],
      [],
      [],
      [],
    );
    const teks = renderTemplate('Rincian:\n{rincian_dokter}', {
      rincian_dokter: formatRincianDokter(r.perDokter),
    });
    expect(teks.split('\n')).toHaveLength(4);
    expect(teks).toContain('Ani');
    expect(teks).toContain('Budi');
    expect(teks).toContain('Cakra');
  });
});

describe('JAM_REKAP_RESEP_BAWAAN', () => {
  /**
   * 22:00, dan sengaja BERBEDA dari 21:00 milik rekap penjualan. Diukur:
   * peresepan punya ekor tipis yang menembus tengah malam (jam 21 = 12, jam 22 =
   * 2, jam 23 = 1 sepanjang 2,5 tahun), sementara penjualan benar-benar nol
   * setelah pukul 20:00. Menyeragamkan keduanya berarti satu pengukuran dipakai
   * untuk membenarkan yang lain. Lihat migrations/042.
   */
  it('adalah 22:00', () => {
    expect(JAM_REKAP_RESEP_BAWAAN).toEqual({ jam: 22, menit: 0 });
  });
});
