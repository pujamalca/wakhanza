import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from './pagination';

describe('bacaHalaman', () => {
  it('membaca nomor halaman yang wajar', () => {
    expect(bacaHalaman('1')).toBe(1);
    expect(bacaHalaman('7')).toBe(7);
    expect(bacaHalaman(' 3 ')).toBe(3);
  });

  it('jatuh ke halaman 1 untuk masukan yang tidak berarti', () => {
    expect(bacaHalaman(undefined)).toBe(1);
    expect(bacaHalaman('')).toBe(1);
    expect(bacaHalaman('abc')).toBe(1);
    expect(bacaHalaman('0')).toBe(1);
    expect(bacaHalaman('-5')).toBe(1);
    expect(bacaHalaman('NaN')).toBe(1);
    expect(bacaHalaman('Infinity')).toBe(1);
  });

  /**
   * `Number()` menerima ketiganya tanpa mengeluh, dan ketiganya berujung pada
   * `OFFSET` yang tidak masuk akal kalau diteruskan apa adanya ke Sequelize.
   */
  it('membulatkan pecahan ke bawah alih-alih meneruskannya ke OFFSET', () => {
    expect(bacaHalaman('2.7')).toBe(2);
    expect(bacaHalaman('1.999')).toBe(1);
  });

  it('menerima larik dari searchParams dan memakai nilai pertama', () => {
    expect(bacaHalaman(['4', '9'])).toBe(4);
  });
});

describe('hitungPaginasi', () => {
  it('menghitung offset dan total halaman', () => {
    const p = hitungPaginasi(1, 120, 50);
    expect(p).toEqual({ halaman: 1, totalHalaman: 3, jumlah: 120, limit: 50, offset: 0 });
  });

  it('offset mengikuti halaman', () => {
    expect(hitungPaginasi(3, 120, 50).offset).toBe(100);
    expect(hitungPaginasi(2, 60, 25).offset).toBe(25);
  });

  /**
   * INTI perbaikannya. Sebelum berkas ini ada, tiga halaman menghitung `page`
   * tanpa batas atas: `?page=999` menampilkan tabel kosong berikut tombol
   * "Sebelumnya" yang menuju 998 -- juga kosong, dan seterusnya. Tidak ada
   * jalan kembali selain menyunting URL sendiri.
   */
  it('MENJEPIT halaman di luar rentang ke halaman terakhir', () => {
    const p = hitungPaginasi(999, 120, 50);
    expect(p.halaman).toBe(3);
    expect(p.totalHalaman).toBe(3);
    expect(p.offset).toBe(100);
  });

  it('nol baris tetap "halaman 1 dari 1", bukan dari 0', () => {
    const p = hitungPaginasi(1, 0, 50);
    expect(p.halaman).toBe(1);
    expect(p.totalHalaman).toBe(1);
    expect(p.offset).toBe(0);
    expect(p.jumlah).toBe(0);
  });

  it('halaman di luar rentang saat tabel kosong tetap jatuh ke 1', () => {
    expect(hitungPaginasi(42, 0, 50).halaman).toBe(1);
    expect(hitungPaginasi(42, 0, 50).offset).toBe(0);
  });

  it('jumlah tepat sekelipatan ukuran tidak menghasilkan halaman kosong di ekor', () => {
    expect(hitungPaginasi(1, 50, 50).totalHalaman).toBe(1);
    expect(hitungPaginasi(1, 100, 50).totalHalaman).toBe(2);
    expect(hitungPaginasi(1, 51, 50).totalHalaman).toBe(2);
  });

  it('tahan terhadap ukuran atau jumlah yang tidak masuk akal', () => {
    expect(hitungPaginasi(1, 10, 0).limit).toBe(1);
    expect(hitungPaginasi(1, -5, 50).jumlah).toBe(0);
    expect(hitungPaginasi(-3, 100, 50).halaman).toBe(1);
  });

  it('kedua ukuran bawaan berbeda dan keduanya bilangan bulat positif', () => {
    expect(UKURAN_HALAMAN.riwayat).toBe(50);
    expect(UKURAN_HALAMAN.konfigurasi).toBe(25);
  });
});

describe('hrefHalaman', () => {
  it('merakit URL dengan nomor halaman', () => {
    expect(hrefHalaman('/audit', {}, 2)).toBe('/audit?page=2');
  });

  /**
   * Parameter saringan yang terlewat membuat tombol "Berikutnya" membuang
   * pencarian yang sedang aktif -- dan yang terlihat petugas bukan "saringan
   * hilang" melainkan "pasien ini punya puluhan pesan gagal".
   */
  it('MEMPERTAHANKAN saringan yang aktif', () => {
    expect(hrefHalaman('/antrean', { status: 'failed', q: '628123' }, 3)).toBe(
      '/antrean?status=failed&q=628123&page=3',
    );
  });

  it('membuang nilai kosong, null, dan undefined', () => {
    expect(hrefHalaman('/antrean', { status: null, q: '', saring: undefined }, 1)).toBe('/antrean?page=1');
  });

  it('meng-encode nilai yang mengandung karakter khusus', () => {
    const href = hrefHalaman('/nomor-bermasalah', { q: 'budi & ani' }, 2);
    expect(href).toBe('/nomor-bermasalah?q=budi+%26+ani&page=2');
    // Bolak-balik: yang dibaca kembali harus sama persis dengan yang dikirim.
    expect(new URLSearchParams(href.split('?')[1]).get('q')).toBe('budi & ani');
  });

  it('menerima angka sebagai nilai saringan', () => {
    expect(hrefHalaman('/log', { id: 12 }, 1)).toBe('/log?id=12&page=1');
  });

  /** `page` ditulis TERAKHIR, jadi ia menang atas `page` yang tak sengaja ikut di saringan. */
  it('nomor halaman tidak bisa ditimpa oleh isi saringan', () => {
    expect(hrefHalaman('/audit', { page: 99 }, 2)).toBe('/audit?page=2');
  });

  /**
   * Bentuk yang dihasilkan checkbox/`<select multiple>` dan yang dibaca kembali
   * `searchParams`. Digabung jadi satu nilai berkoma, pilihannya pulih sebagai
   * SATU wilayah bernama "3374,3375" yang tidak cocok dengan apa pun.
   */
  it('larik dipertahankan sebagai kunci berulang', () => {
    expect(hrefHalaman('/broadcast-terjadwal', { kab: ['3374', '3375'] }, 2)).toBe(
      '/broadcast-terjadwal?kab=3374&kab=3375&page=2',
    );
  });

  it('larik kosong dan nilai kosong di dalam larik tidak meninggalkan parameter hampa', () => {
    expect(hrefHalaman('/broadcast-terjadwal', { kab: [], pj: ['', 'BPJ'] }, 1)).toBe(
      '/broadcast-terjadwal?pj=BPJ&page=1',
    );
  });

  /**
   * `/pesan-masuk` memuat dua tabel yang berdiri sendiri. Kalau keduanya
   * bernama `page`, tombol di tabel grup ikut menggeser tabel pesan -- dan yang
   * terlihat petugas adalah baris yang hilang tanpa sebab.
   */
  it('nama parameter bisa diganti untuk tabel kedua di halaman yang sama', () => {
    expect(hrefHalaman('/pesan-masuk', { saring: 'grup', page: 4 }, 2, 'gpage')).toBe(
      '/pesan-masuk?saring=grup&page=4&gpage=2',
    );
  });

  it('nama parameter pengganti juga menang atas nilai senama di saringan', () => {
    expect(hrefHalaman('/pesan-masuk', { gpage: 9, page: 4 }, 2, 'gpage')).toBe('/pesan-masuk?gpage=2&page=4');
  });

  it('larik terbaca kembali utuh lewat searchParams', () => {
    const href = hrefHalaman('/broadcast-terjadwal', { kec: ['A B', 'C&D'] }, 3);
    expect(new URLSearchParams(href.split('?')[1]).getAll('kec')).toEqual(['A B', 'C&D']);
  });
});
