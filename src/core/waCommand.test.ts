import {
  parsePerintah,
  mulaiPerintah,
  lanjutkanWizard,
  uraikanKataKunci,
  isLangkah,
  varsBalasanApaAdanya,
  susunBantuan,
  MAKS_LABEL,
  MAKS_ISI,
  type KemampuanAlamat,
  type KonteksPerintah,
  type RingkasanAturan,
  type HasilPerintah,
  type KeadaanWizard,
} from './waCommand';
import { AUTOREPLY_TEMPLATE_VARIABLES, renderTemplate } from './template';

const aturan = (over: Partial<RingkasanAturan> & { id: number; label: string }): RingkasanAturan => ({
  keywords: ['kunci' + over.id],
  matchMode: 'contains',
  priority: 100,
  isActive: true,
  ...over,
});

/** Alamat yang cuma boleh mengatur aturan -- keadaan paling sempit, dan bawaannya. */
const kemampuanDasar: KemampuanAlamat = {
  balasanOtomatisAktif: true,
  bolehTanyaStok: false,
  stokRinci: false,
  bolehTanyaDarurat: false,
  kataKunciStok: [],
  frasaDarurat: [],
  formulir: { aktif: false, daftar: [], adaKhususPribadi: false },
};

const ctxKosong: KonteksPerintah = {
  aturan: [],
  aktifLangsung: false,
  variabelDikenal: AUTOREPLY_TEMPLATE_VARIABLES,
  kemampuan: kemampuanDasar,
};

const ctxDengan = (
  list: RingkasanAturan[],
  aktifLangsung = false,
  kemampuan: Partial<KemampuanAlamat> = {},
): KonteksPerintah => ({
  aturan: list,
  aktifLangsung,
  variabelDikenal: AUTOREPLY_TEMPLATE_VARIABLES,
  kemampuan: { ...kemampuanDasar, ...kemampuan },
});

/** Menjalankan beberapa jawaban berturut-turut, seperti percakapan sungguhan. */
function jalankan(awal: HasilPerintah, jawaban: string[], ctx: KonteksPerintah): HasilPerintah {
  let hasil = awal;
  for (const j of jawaban) {
    if (hasil.aksi === 'selesai') throw new Error('wizard sudah selesai sebelum jawaban habis');
    hasil = lanjutkanWizard(hasil.keadaan, j, ctx);
  }
  return hasil;
}

const mulai = (teks: string, ctx: KonteksPerintah, adaSesi = false): HasilPerintah => {
  const p = parsePerintah(teks);
  if (!p) throw new Error(`bukan perintah: ${teks}`);
  return mulaiPerintah(p, ctx, adaSesi);
};

describe('parsePerintah', () => {
  it('mengenali nama panjang maupun singkatannya', () => {
    expect(parsePerintah('/tambah-jawaban-otomatis')?.jenis).toBe('tambah');
    expect(parsePerintah('/tambah')?.jenis).toBe('tambah');
    expect(parsePerintah('/daftar-jawaban-otomatis')?.jenis).toBe('daftar');
    expect(parsePerintah('/hapus')?.jenis).toBe('hapus');
    expect(parsePerintah('/ubah')?.jenis).toBe('ubah');
    expect(parsePerintah('/uji')?.jenis).toBe('uji');
    expect(parsePerintah('/batal')?.jenis).toBe('batal');
    expect(parsePerintah('/bantuan')?.jenis).toBe('bantuan');
  });

  it('memisahkan argumen sebaris', () => {
    expect(parsePerintah('/uji jadwal dokter jantung')).toEqual({
      jenis: 'uji',
      argumen: 'jadwal dokter jantung',
    });
    expect(parsePerintah('/tambah')?.argumen).toBe('');
  });

  it('tidak peduli huruf besar-kecil dan tanda baca di ekor', () => {
    expect(parsePerintah('/BATAL')?.jenis).toBe('batal');
    expect(parsePerintah('/batal.')?.jenis).toBe('batal');
  });

  /**
   * Ini pagar yang menjaga isi balasan tetap bisa diketik. Kalau setiap kata
   * bergaris miring dianggap perintah, balasan yang wajar seperti "/info
   * lengkap ada di ..." tidak akan pernah bisa disimpan -- ia akan diuraikan
   * sebagai perintah tak dikenal lalu menggantung.
   */
  it('kata bergaris miring yang BUKAN nama perintah bukan perintah', () => {
    expect(parsePerintah('/info lengkap ada di loket')).toBeNull();
    expect(parsePerintah('/2026')).toBeNull();
    expect(parsePerintah('/')).toBeNull();
  });

  it('teks biasa bukan perintah', () => {
    expect(parsePerintah('jadwal dokter')).toBeNull();
    expect(parsePerintah('')).toBeNull();
    expect(parsePerintah(null)).toBeNull();
    expect(parsePerintah('  ')).toBeNull();
  });

  it('spasi di depan tetap dikenali -- orang mengetik dari ponsel', () => {
    expect(parsePerintah('  /batal  ')?.jenis).toBe('batal');
  });
});

describe('uraikanKataKunci', () => {
  it('memisah koma dan baris baru, menormalisasi, membuang kembar', () => {
    expect(uraikanKataKunci('Jadwal, JADWAL\njam praktik')).toEqual(['jadwal', 'jam praktik']);
  });

  it('potongan kosong dibuang, bukan jadi kata kunci kosong', () => {
    expect(uraikanKataKunci('jadwal,,  ,\n')).toEqual(['jadwal']);
  });
});

describe('isLangkah', () => {
  it('menolak langkah yang tidak dikenal -- baris sesi bisa disunting lewat mysql', () => {
    expect(isLangkah('tambah:nama')).toBe(true);
    expect(isLangkah('tambah:entah')).toBe(false);
    expect(isLangkah('')).toBe(false);
  });
});

describe('/tambah -- alur lengkap', () => {
  it('tiga langkah lalu tersimpan NONAKTIF saat sakelarnya mati', () => {
    const hasil = jalankan(mulai('/tambah', ctxKosong), ['Jadwal Poli', 'jadwal, jam praktik', 'Halo dari {nama_rs}'], ctxKosong);

    expect(hasil.aksi).toBe('selesai');
    if (hasil.aksi !== 'selesai') return;
    expect(hasil.efek).toEqual({
      jenis: 'simpan_baru',
      label: 'Jadwal Poli',
      keywords: ['jadwal', 'jam praktik'],
      body: 'Halo dari {nama_rs}',
      aktif: false,
    });
    expect(hasil.balasan).toContain('BELUM AKTIF');
  });

  /**
   * Sakelar `autoreply.wa_tambah_aktif_langsung` adalah satu-satunya hal yang
   * membedakan keduanya, dan ia menentukan apakah pesan pasien berikutnya
   * sudah dijawab aturan yang belum ditinjau siapa pun. Dipatok berpasangan
   * dengan uji di atasnya supaya yang dijaga adalah PERBEDAANNYA.
   */
  it('tersimpan AKTIF saat sakelarnya menyala', () => {
    const ctx = ctxDengan([], true);
    const hasil = jalankan(mulai('/tambah', ctx), ['Jadwal Poli', 'jadwal', 'Halo'], ctx);
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(hasil.efek).toMatchObject({ jenis: 'simpan_baru', aktif: true });
    expect(hasil.balasan).toContain('SUDAH AKTIF');
  });

  it('argumen sebaris mengisi langkah pertama, bukan diabaikan', () => {
    const hasil = mulai('/tambah Jadwal Poli', ctxKosong);
    expect(hasil.aksi).toBe('tanya');
    if (hasil.aksi !== 'tanya') return;
    expect(hasil.keadaan.langkah).toBe('tambah:kata_kunci');
    expect(hasil.keadaan.data.label).toBe('Jadwal Poli');
  });
});

describe('/tambah -- masukan tidak sah MENGULANG langkah, bukan memajukannya', () => {
  const langkahDari = (h: HasilPerintah): KeadaanWizard => {
    if (h.aksi === 'selesai') throw new Error('tidak ada keadaan');
    return h.keadaan;
  };

  it('nama kosong', () => {
    const h = lanjutkanWizard(langkahDari(mulai('/tambah', ctxKosong)), '   ', ctxKosong);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.keadaan.langkah).toBe('tambah:nama');
  });

  /**
   * `label` adalah VARCHAR(80) dan MariaDB non-strict memotongnya DIAM-DIAM.
   * Dashboard tidak pernah kena karena kotaknya berbatas di peramban; WhatsApp
   * tidak punya kotak.
   */
  it('nama melebihi batas kolomnya', () => {
    const panjang = 'A'.repeat(MAKS_LABEL + 1);
    const h = lanjutkanWizard({ langkah: 'tambah:nama', data: {} }, panjang, ctxKosong);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.balasan).toContain('kepanjangan');
  });

  it('nama yang sudah dipakai aturan lain', () => {
    const ctx = ctxDengan([aturan({ id: 1, label: 'Jadwal Poli' })]);
    const h = lanjutkanWizard({ langkah: 'tambah:nama', data: {} }, 'jadwal poli', ctx);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.balasan).toContain('Sudah ada aturan');
  });

  it('kata kunci kosong dan kata kunci satu huruf', () => {
    const keadaan: KeadaanWizard = { langkah: 'tambah:kata_kunci', data: { label: 'X' } };
    expect(lanjutkanWizard(keadaan, '  ', ctxKosong).aksi).toBe('ulangi');

    const h = lanjutkanWizard(keadaan, 'a, jadwal', ctxKosong);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.balasan).toContain('terlalu pendek');
  });

  it('isi kosong dan isi melebihi batas', () => {
    const keadaan: KeadaanWizard = { langkah: 'tambah:isi', data: { label: 'X', keywords: ['jadwal'] } };
    expect(lanjutkanWizard(keadaan, '', ctxKosong).aksi).toBe('ulangi');
    expect(lanjutkanWizard(keadaan, 'B'.repeat(MAKS_ISI + 1), ctxKosong).aksi).toBe('ulangi');
  });

  /**
   * Tanpa pagar ini, WhatsApp jadi jalan pintas yang melewati pemeriksaan yang
   * ditegakkan dashboard. `{nama_pasien}` sengaja TIDAK ada di
   * AUTOREPLY_TEMPLATE_VARIABLES -- itu keputusan privasi, bukan kelalaian --
   * dan yang lolos akan dirender kosong ke setiap pasien selamanya, tanpa galat.
   */
  it('variabel tak dikenal ditolak, dan sebutkan yang mana', () => {
    const keadaan: KeadaanWizard = { langkah: 'tambah:isi', data: { label: 'X', keywords: ['jadwal'] } };
    const h = lanjutkanWizard(keadaan, 'Halo {nama_pasien}, salam dari {nama_rs}', ctxKosong);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.balasan).toContain('{nama_pasien}');
    expect(h.balasan).not.toContain('{nama_rs},');
  });
});

describe('peringatan tabrakan kata kunci', () => {
  it('memperingatkan kalau aturan AKTIF lain sudah menjaring kata kuncinya', () => {
    const ctx = ctxDengan([aturan({ id: 1, label: 'Jadwal Lama', keywords: ['jadwal'] })]);
    const h = lanjutkanWizard({ langkah: 'tambah:kata_kunci', data: { label: 'Baru' } }, 'jadwal', ctx);

    expect(h.aksi).toBe('tanya');
    if (h.aksi !== 'tanya') return;
    expect(h.balasan).toContain('Jadwal Lama');
    // Tetap MAJU -- staf boleh saja memang berniat menggantinya lewat urutan.
    expect(h.keadaan.langkah).toBe('tambah:isi');
  });

  it('aturan NONAKTIF tidak diperingatkan -- ia tidak menjawab apa pun', () => {
    const ctx = ctxDengan([aturan({ id: 1, label: 'Jadwal Lama', keywords: ['jadwal'], isActive: false })]);
    const h = lanjutkanWizard({ langkah: 'tambah:kata_kunci', data: { label: 'Baru' } }, 'jadwal', ctx);
    if (h.aksi !== 'tanya') throw new Error('harusnya tanya');
    expect(h.balasan).not.toContain('Jadwal Lama');
  });
});

describe('/daftar', () => {
  it('tabel kosong dijawab ajakan membuat yang pertama, bukan daftar kosong', () => {
    const h = mulai('/daftar', ctxKosong);
    expect(h.aksi).toBe('selesai');
    if (h.aksi !== 'selesai') return;
    expect(h.balasan).toContain('Belum ada');
    expect(h.efek).toBeUndefined();
  });

  it('menomori aturan berikut status aktifnya', () => {
    const ctx = ctxDengan([
      aturan({ id: 7, label: 'Jadwal Poli', keywords: ['jadwal'] }),
      aturan({ id: 9, label: 'Pendaftaran', keywords: ['daftar'], isActive: false }),
    ]);
    const h = mulai('/daftar', ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.balasan).toContain('1. *Jadwal Poli* (aktif)');
    expect(h.balasan).toContain('2. *Pendaftaran* (NONAKTIF)');
  });
});

describe('/hapus', () => {
  const ctx = ctxDengan([
    aturan({ id: 10, label: 'Satu' }),
    aturan({ id: 20, label: 'Dua' }),
    aturan({ id: 30, label: 'Tiga' }),
  ]);

  it('tabel kosong dijawab tanpa membuka wizard', () => {
    const h = mulai('/hapus', ctxKosong);
    expect(h.aksi).toBe('selesai');
  });

  it('pilih nomor lalu YA menghasilkan efek hapus', () => {
    const h = jalankan(mulai('/hapus', ctx), ['2', 'ya'], ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toEqual({ jenis: 'hapus', id: 20, label: 'Dua' });
  });

  it('jawaban selain YA membatalkan tanpa efek', () => {
    const h = jalankan(mulai('/hapus', ctx), ['2', 'nanti dulu'], ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toBeUndefined();
    expect(h.balasan).toContain('tetap ada');
  });

  it('nomor di luar jangkauan mengulang langkah yang sama', () => {
    const h = jalankan(mulai('/hapus', ctx), ['9'], ctx);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.keadaan.langkah).toBe('hapus:pilih');
  });

  it('bukan angka juga ditolak', () => {
    expect(jalankan(mulai('/hapus', ctx), ['dua'], ctx).aksi).toBe('ulangi');
    expect(jalankan(mulai('/hapus', ctx), ['1.5'], ctx).aksi).toBe('ulangi');
  });

  /**
   * Daftar bernomor DIBEKUKAN saat ditampilkan. Aturan bisa dihapus lewat
   * dashboard di sela dua pesan, dan nomor 2 yang berpindah arti antara "pilih"
   * dan "konfirmasi" berarti staf menghapus aturan yang bukan dilihatnya.
   */
  it('nomor menunjuk aturan yang DITAMPILKAN, bukan urutan terbaru', () => {
    const awal = mulai('/hapus', ctx);
    if (awal.aksi !== 'tanya') throw new Error('harusnya tanya');

    // Aturan pertama lenyap lewat dashboard; urutan "sekarang" jadi Dua, Tiga.
    const ctxBaru = ctxDengan([aturan({ id: 20, label: 'Dua' }), aturan({ id: 30, label: 'Tiga' })]);
    const h = lanjutkanWizard(awal.keadaan, '2', ctxBaru);

    if (h.aksi !== 'tanya') throw new Error('harusnya tanya');
    // Kalau nomornya dibaca ulang dari ctx baru, ini akan jadi id 30.
    expect(h.keadaan.data.targetId).toBe(20);
  });

  it('aturan yang lenyap sebelum konfirmasi dikatakan apa adanya, tanpa efek', () => {
    const awal = jalankan(mulai('/hapus', ctx), ['2'], ctx);
    if (awal.aksi !== 'tanya') throw new Error('harusnya tanya');
    const h = lanjutkanWizard(awal.keadaan, 'ya', ctxDengan([aturan({ id: 10, label: 'Satu' })]));
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toBeUndefined();
    expect(h.balasan).toContain('sudah tidak ada');
  });
});

describe('/ubah', () => {
  const ctx = ctxDengan([
    aturan({ id: 5, label: 'Jadwal Poli', keywords: ['jadwal'], isActive: true }),
    aturan({ id: 6, label: 'Pendaftaran', keywords: ['daftar'], isActive: false }),
  ]);

  it('pilihan 4 membalik status TANPA langkah nilai', () => {
    const h = jalankan(mulai('/ubah', ctx), ['1', '4'], ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toEqual({ jenis: 'ubah', id: 5, aktif: false });
    expect(h.balasan).toContain('NONAKTIF');
  });

  it('aturan nonaktif ditawari Aktifkan, bukan Nonaktifkan', () => {
    const h = jalankan(mulai('/ubah', ctx), ['2'], ctx);
    if (h.aksi !== 'tanya') throw new Error('harusnya tanya');
    expect(h.balasan).toContain('4. Aktifkan');

    const nyala = lanjutkanWizard(h.keadaan, '4', ctx);
    if (nyala.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(nyala.efek).toEqual({ jenis: 'ubah', id: 6, aktif: true });
  });

  it('mengubah nama', () => {
    const h = jalankan(mulai('/ubah', ctx), ['1', '1', 'Jadwal Praktik'], ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toEqual({ jenis: 'ubah', id: 5, label: 'Jadwal Praktik' });
  });

  it('nama yang sama persis dengan miliknya sendiri BUKAN tabrakan', () => {
    const h = jalankan(mulai('/ubah', ctx), ['1', '1', 'Jadwal Poli'], ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toEqual({ jenis: 'ubah', id: 5, label: 'Jadwal Poli' });
  });

  it('nama milik aturan LAIN tetap ditolak', () => {
    const h = jalankan(mulai('/ubah', ctx), ['1', '1', 'Pendaftaran'], ctx);
    expect(h.aksi).toBe('ulangi');
  });

  it('mengubah kata kunci mengganti seluruhnya', () => {
    const h = jalankan(mulai('/ubah', ctx), ['1', '2', 'jam praktik, jadwal dokter'], ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toEqual({ jenis: 'ubah', id: 5, keywords: ['jam praktik', 'jadwal dokter'] });
  });

  it('mengubah isi balasan, dan variabelnya tetap divalidasi', () => {
    const ok = jalankan(mulai('/ubah', ctx), ['1', '3', 'Halo {kontak_rs}'], ctx);
    if (ok.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(ok.efek).toEqual({ jenis: 'ubah', id: 5, body: 'Halo {kontak_rs}' });

    expect(jalankan(mulai('/ubah', ctx), ['1', '3', 'Halo {no_rm}'], ctx).aksi).toBe('ulangi');
  });

  it('nomor bagian di luar 1-4 mengulang langkah yang sama', () => {
    const h = jalankan(mulai('/ubah', ctx), ['1', '9'], ctx);
    expect(h.aksi).toBe('ulangi');
    if (h.aksi !== 'ulangi') return;
    expect(h.keadaan.langkah).toBe('ubah:bagian');
  });
});

describe('/uji', () => {
  it('argumen sebaris langsung menghasilkan efek uji', () => {
    const h = mulai('/uji jadwal dokter', ctxKosong);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(h.efek).toEqual({ jenis: 'uji', kalimat: 'jadwal dokter' });
  });

  it('tanpa argumen bertanya dulu', () => {
    const h = mulai('/uji', ctxKosong);
    expect(h.aksi).toBe('tanya');
    if (h.aksi !== 'tanya') return;
    expect(h.keadaan.langkah).toBe('uji:kalimat');
    expect(lanjutkanWizard(h.keadaan, 'jadwal', ctxKosong)).toMatchObject({
      aksi: 'selesai',
      efek: { jenis: 'uji', kalimat: 'jadwal' },
    });
  });
});

/**
 * Uji PERILAKU, bukan keanggotaan himpunan: yang perlu dijaga adalah balasan
 * wizard KELUAR UTUH dari `renderTemplate`, dan kegagalannya gagal DIAM.
 *
 * Ditemukan lewat uji end-to-end, bukan di sini -- uji mesin keadaan memeriksa
 * nilai balik fungsi murni, yaitu SEBELUM perenderan pernah terjadi. Karena itu
 * patokannya dipasang dengan benar-benar merender.
 */
describe('balasan wizard selamat dari perenderan template', () => {
  const render = (teks: string) => renderTemplate(teks, varsBalasanApaAdanya(teks));

  it('petunjuk variabel tidak berubah jadi nilai sungguhannya', () => {
    const h = lanjutkanWizard({ langkah: 'tambah:kata_kunci', data: { label: 'X' } }, 'jadwal', ctxKosong);
    if (h.aksi !== 'tanya') throw new Error('harusnya tanya');
    expect(h.balasan).toContain('{nama_rs}');
    expect(render(h.balasan)).toBe(h.balasan);
  });

  /**
   * Yang paling mahal dari keduanya. Variabel TAK DIKENAL dirender jadi string
   * kosong, jadi "Variabel tidak dikenal: {nama_pasien}" berubah menjadi
   * "Variabel tidak dikenal: ." -- kalimat yang ada justru untuk menyebutkan
   * kesalahannya menghapus kesalahannya sendiri.
   */
  it('nama variabel yang SALAH tetap tersebut sesudah dirender', () => {
    const keadaan: KeadaanWizard = { langkah: 'tambah:isi', data: { label: 'X', keywords: ['jadwal'] } };
    const h = lanjutkanWizard(keadaan, 'Halo {nama_pasien}', ctxKosong);
    if (h.aksi !== 'ulangi') throw new Error('harusnya ulangi');
    expect(render(h.balasan)).toContain('{nama_pasien}');
  });

  it('teks tanpa variabel tidak tersentuh', () => {
    expect(varsBalasanApaAdanya('Dibatalkan.')).toEqual({});
    expect(render('Dibatalkan.')).toBe('Dibatalkan.');
  });
});

describe('/batal dan /bantuan', () => {
  it('/batal saat ada sesi vs saat tidak ada -- kalimatnya berbeda', () => {
    const adaSesi = mulai('/batal', ctxKosong, true);
    const tanpaSesi = mulai('/batal', ctxKosong, false);
    if (adaSesi.aksi !== 'selesai' || tanpaSesi.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(adaSesi.balasan).toBe('Dibatalkan.');
    expect(tanpaSesi.balasan).toContain('Tidak ada');
    expect(adaSesi.efek).toBeUndefined();
  });

  it('/bantuan menyebut SETIAP perintah yang bisa dijalankan', () => {
    const h = mulai('/bantuan', ctxKosong);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    for (const nama of ['/tambah', '/daftar', '/ubah', '/hapus', '/uji', '/batal']) {
      expect(h.balasan).toContain(nama);
    }
  });
});

/**
 * `/bantuan` (juga `/help`) adalah satu-satunya tempat orang yang mengatur
 * balasan otomatis LEWAT WHATSAPP bisa melihat keadaan konfigurasinya. Yang
 * dijaga di bawah bukan susunan kalimatnya melainkan tiap fakta yang, kalau
 * hilang, membuat pembacanya menyimpulkan hal yang keliru.
 */
describe('/bantuan menerangkan keadaan, bukan cuma daftar perintah', () => {
  const bantuan = (ctx: KonteksPerintah): string => {
    const h = mulai('/bantuan', ctx);
    if (h.aksi !== 'selesai') throw new Error('harusnya selesai');
    return h.balasan;
  };

  it('/help dan /perintah menempuh jalur yang sama dengan /bantuan', () => {
    expect(bantuan(ctxKosong)).toBe(susunBantuan(ctxKosong));
    expect(parsePerintah('/help')?.jenis).toBe('bantuan');
    expect(parsePerintah('/perintah')?.jenis).toBe('bantuan');
  });

  it('menyebut aturan yang SUDAH ADA berikut status dan kata kuncinya', () => {
    const teks = bantuan(
      ctxDengan([
        aturan({ id: 1, label: 'Jadwal praktik', keywords: ['jadwal', 'jam praktik'] }),
        aturan({ id: 2, label: 'Alamat klinik', keywords: ['alamat'], isActive: false }),
      ]),
    );
    expect(teks).toContain('Jadwal praktik');
    expect(teks).toContain('jam praktik');
    expect(teks).toContain('Alamat klinik');
    // Status per aturan wajib ikut: aturan nonaktif tidak menjawab siapa pun,
    // dan daftar tanpa status membuat keduanya terbaca sama.
    expect(teks).toContain('NONAKTIF');
    // Dua aturan, satu di antaranya nonaktif -- angka aktifnya menghitung yang
    // benar-benar menjawab, bukan yang tersimpan.
    expect(teks).toContain('2 (1 aktif)');
  });

  it('mengatakan aturannya belum ada, bukan menampilkan daftar kosong', () => {
    expect(bantuan(ctxKosong)).toContain('Belum ada satu pun');
  });

  it('daftar panjang dipotong berikut cara melihat sisanya', () => {
    const banyak = Array.from({ length: 14 }, (_, i) => aturan({ id: i + 1, label: `Aturan ${i + 1}` }));
    const teks = bantuan(ctxDengan(banyak));
    expect(teks).toContain('Aturan 10');
    expect(teks).not.toContain('Aturan 11');
    expect(teks).toContain('dan 4 lagi');
    expect(teks).toContain('/daftar');
  });

  /**
   * Fakta paling mahal kalau hilang: sakelar `autoreply.enabled` yang mati
   * membuat SETIAP aturan diam, termasuk yang bertanda aktif. Tidak ada satu pun
   * jalan lain melihatnya dari WhatsApp, dan orang yang baru menulis aturan lalu
   * mengujinya akan menyimpulkan aturannyalah yang salah.
   */
  it('mengatakan saat balasan otomatis MATI, walau ada aturan bertanda aktif', () => {
    const teks = bantuan(ctxDengan([aturan({ id: 1, label: 'Jadwal' })], false, { balasanOtomatisAktif: false }));
    expect(teks).toContain('*MATI*');
    expect(teks).toContain('termasuk yang bertanda aktif');
  });

  it('mengatakan nasib aturan baru, dan kalimatnya berbeda per setelan', () => {
    expect(bantuan(ctxDengan([], false))).toContain('nonaktif');
    expect(bantuan(ctxDengan([], true))).toContain('langsung aktif');
  });

  /**
   * Wewenang perintah (`wa_command_admin`) dan wewenang bertanya stok
   * (`farmasi_target.boleh_tanya`) memang dua daftar terpisah. Bantuan yang
   * menyebut kemampuan yang tidak dimiliki pembacanya menghasilkan orang yang
   * mengetik apa yang disuruh lalu didiamkan -- tanpa satu pun galat, karena
   * tidak ada yang salah selain alamatnya.
   */
  it('TIDAK menawarkan tanya stok kepada alamat yang tidak berhak', () => {
    const teks = bantuan(ctxKosong);
    expect(teks).not.toContain('Stok & harga obat');
    expect(teks).not.toContain('Rekap barang di bawah stok minimal');
    // Diam saja tidak cukup -- sebabnya harus disebut, kalau tidak orangnya
    // mencoba, tidak dijawab, lalu menyimpulkan nomornya rusak.
    expect(teks).toContain('Boleh tanya');
  });

  it('menyebut kata kunci stok yang SUNGGUHAN kepada alamat yang berhak', () => {
    const teks = bantuan(ctxDengan([], false, {
      bolehTanyaStok: true,
      stokRinci: true,
      kataKunciStok: ['stok', 'harga', 'adakah'],
      bolehTanyaDarurat: true,
      frasaDarurat: ['rekap stok'],
    }));
    expect(teks).toContain('stok, harga, adakah');
    expect(teks).toContain('sisa stok, satuan, dan harga');
    expect(teks).toContain('rekap stok');
  });

  it('membedakan jawaban rinci dari jawaban ringkas', () => {
    const teks = bantuan(ctxDengan([], false, { bolehTanyaStok: true, stokRinci: false, kataKunciStok: ['stok'] }));
    expect(teks).toContain('tanpa angka sisa');
  });

  /**
   * Bantuan melewati `renderTemplate()` seperti setiap balasan wizard lain, dan
   * ia satu-satunya yang memuat teks dari DATABASE (nama aturan, kata kunci).
   * Nama aturan yang kebetulan berbentuk variabel karena itu harus selamat --
   * kalau tidak, aturan bernama "{nama_rs}" membuat bantuan menyebut nama rumah
   * sakit di tempat nama aturannya, dan staf tidak menemukannya di dashboard.
   */
  /**
   * `/bantuan` di tengah wizard MENUTUP wizardnya, sama seperti perintah lain --
   * `aksi: 'selesai'` membuat runner menghapus sesinya. Dipatok supaya ini tetap
   * keputusan, bukan kebetulan: orang yang bingung di langkah dua wajar mengetik
   * `/help` lalu ingin melanjutkan, dan kalau suatu saat itu yang dipilih,
   * perubahannya harus terlihat sebagai uji yang gagal -- bukan sebagai sesi yang
   * diam-diam bertahan lalu menelan pesan berikutnya.
   */
  it('/bantuan di tengah wizard menutup wizardnya, seperti perintah lain', () => {
    expect(mulai('/bantuan', ctxKosong, true).aksi).toBe('selesai');
  });

  it('nama aturan berbentuk variabel selamat dari perenderan', () => {
    const teks = bantuan(ctxDengan([aturan({ id: 1, label: '{nama_rs}', keywords: ['halo'] })]));
    expect(renderTemplate(teks, varsBalasanApaAdanya(teks))).toContain('{nama_rs}');
  });

  /**
   * Formulir (051) tidak dijaga daftar putih mana pun, jadi yang menentukan
   * apakah bantuan boleh menyebutnya adalah sakelar utamanya dan `boleh_grup`
   * per formulir -- bukan wewenang alamatnya.
   */
  describe('formulir', () => {
    const formulir = (over: Partial<KemampuanAlamat['formulir']>): Partial<KemampuanAlamat> => ({
      formulir: { aktif: true, daftar: [], adaKhususPribadi: false, ...over },
    });

    it('menyebut nama dan kata kunci formulir yang bisa diisi dari sini', () => {
      const teks = bantuan(
        ctxDengan([], false, formulir({ daftar: [{ nama: 'Permintaan obat', keywords: ['request obat', 'minta obat'] }] })),
      );
      expect(teks).toContain('Formulir yang bisa diisi dari sini');
      expect(teks).toContain('Permintaan obat');
      expect(teks).toContain('request obat, minta obat');
      // Jalan keluarnya harus ikut disebut: percakapan bertahap yang tidak bisa
      // dihentikan adalah percakapan yang menelan setiap pesan berikutnya.
      expect(teks).toContain('batal');
    });

    /**
     * Sakelarnya mati = tidak satu pun formulir menjawab di alamat MANA PUN,
     * jadi ini bukan soal wewenang alamat ini dan tidak boleh disebut sebagai
     * sesuatu yang "belum bisa dari sini". Diam adalah jawaban yang benar --
     * dan itu juga yang menjaga pesan tetap pendek bagi rumah sakit yang tidak
     * memakai fiturnya.
     */
    it('DIAM sama sekali saat fiturnya mati, walau ada formulir tersimpan', () => {
      const teks = bantuan(
        ctxDengan([], false, {
          formulir: { aktif: false, daftar: [{ nama: 'Permintaan obat', keywords: ['request obat'] }], adaKhususPribadi: true },
        }),
      );
      expect(teks).not.toContain('Formulir');
      expect(teks).not.toContain('Permintaan obat');
    });

    it('diam saat menyala tapi memang belum ada formulirnya', () => {
      expect(bantuan(ctxDengan([], false, formulir({})))).not.toContain('Formulir');
    });

    /**
     * Di grup, daftar kosong punya DUA sebab yang menuntut kalimat berbeda.
     * "Ada, tapi tidak dari sini" punya jalan keluar yang bisa ditempuh saat itu
     * juga; mendiamkannya membuat orangnya menyimpulkan formulirnya tidak ada.
     */
    it('menyebut jalan keluarnya saat semua formulir khusus chat pribadi', () => {
      const teks = bantuan(ctxDengan([], false, formulir({ adaKhususPribadi: true })));
      expect(teks).toContain('tidak dari dalam grup');
      expect(teks).toContain('chat pribadi');
    });

    it('menyebut adanya formulir lain yang khusus pribadi walau di sini ada juga', () => {
      const teks = bantuan(
        ctxDengan([], false, formulir({
          daftar: [{ nama: 'Lapor alat rusak', keywords: ['lapor alat'] }],
          adaKhususPribadi: true,
        })),
      );
      expect(teks).toContain('Lapor alat rusak');
      expect(teks).toContain('hanya bisa diisi dari chat pribadi');
    });

    /**
     * Kata kunci datang dari DATABASE, sama seperti nama aturan. Kata kunci yang
     * kebetulan berbentuk variabel harus selamat -- kalau tidak, bantuan
     * menghapus justru bagian yang harus diketik orangnya.
     */
    it('kata kunci berbentuk variabel selamat dari perenderan', () => {
      const teks = bantuan(ctxDengan([], false, formulir({ daftar: [{ nama: 'Uji', keywords: ['{nama_rs}'] }] })));
      expect(renderTemplate(teks, varsBalasanApaAdanya(teks))).toContain('{nama_rs}');
    });
  });
});
