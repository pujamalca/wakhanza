import {
  cocokFormulir,
  formulirYangMenjawab,
  mulaiFormulir,
  lanjutkanFormulir,
  mintaBatal,
  isTipeField,
  MAKS_JAWABAN,
  type FieldFormulir,
  type KeadaanFormulir,
  type RingkasanFormulir,
} from './waFormulir';

function field(over: Partial<FieldFormulir> = {}): FieldFormulir {
  return { id: 1, label: 'Obat apa yang dibutuhkan?', tipe: 'teks', wajib: true, pilihan: [], maksPanjang: 0, ...over };
}

function form(over: Partial<RingkasanFormulir> = {}): RingkasanFormulir {
  return {
    id: 7,
    nama: 'Permintaan obat',
    keywords: ['request obat'],
    matchMode: 'contains',
    priority: 100,
    pesanPembuka: '',
    pesanPenutup: 'Petugas kami akan menghubungi Anda.',
    fields: [field()],
    ...over,
  };
}

/** Menjalankan seluruh percakapan sampai selesai; mengembalikan langkah terakhir. */
function isiSampaiSelesai(awal: KeadaanFormulir, jawaban: string[]) {
  let keadaan = awal;
  let hasil = lanjutkanFormulir(keadaan, jawaban[0]!);
  for (const j of jawaban.slice(1)) {
    if (hasil.aksi !== 'tanya') break;
    keadaan = hasil.keadaan;
    hasil = lanjutkanFormulir(keadaan, j);
  }
  return hasil;
}

describe('cocokFormulir', () => {
  /**
   * Yang dibuktikan bukan sekadar "cocok", melainkan bahwa bentuk bergaris
   * miring TIDAK butuh cabang kode sendiri: `normalizeInbound()` membuang garis
   * miringnya di kedua sisi, jadi keduanya menempuh `matchRule()` yang sama.
   */
  it('bentuk bergaris miring dan bentuk biasa sama-sama cocok', () => {
    const daftar = [form({ keywords: ['request obat'] })];
    expect(cocokFormulir('/request-obat', daftar)?.id).toBe(7);
    expect(cocokFormulir('request obat', daftar)?.id).toBe(7);
    expect(cocokFormulir('saya mau request obat dong', daftar)?.id).toBe(7);
  });

  it('kata kunci dicocokkan sebagai kata utuh, bukan potongan', () => {
    const daftar = [form({ keywords: ['lapor'] })];
    expect(cocokFormulir('lapor kerusakan', daftar)).not.toBeNull();
    expect(cocokFormulir('melaporkan kerusakan', daftar)).toBeNull();
  });

  it('urutan priority menentukan mana yang menang', () => {
    const daftar = [
      form({ id: 1, nama: 'Umum', keywords: ['lapor'], priority: 200 }),
      form({ id: 2, nama: 'Khusus', keywords: ['lapor'], priority: 10 }),
    ];
    expect(cocokFormulir('lapor', daftar)?.id).toBe(2);
  });

  /**
   * Formulir tanpa pertanyaan akan menggantungkan pasien pada sesi yang tidak
   * bisa dimajukan apa pun. Dashboard menolaknya saat disimpan; ini lapis kedua.
   */
  it('formulir tanpa pertanyaan tidak pernah cocok', () => {
    expect(cocokFormulir('request obat', [form({ fields: [] })])).toBeNull();
  });

  it('mode exact menuntut seluruh pesan sama persis', () => {
    const daftar = [form({ keywords: ['request obat'], matchMode: 'exact' })];
    expect(cocokFormulir('request obat', daftar)).not.toBeNull();
    expect(cocokFormulir('saya mau request obat dong', daftar)).toBeNull();
  });
});

/**
 * Penurunan yang DIPAKAI BERSAMA oleh pencocokan dan oleh `/bantuan` lewat
 * WhatsApp. Yang dijaga di sini bukan penyaringnya melainkan bahwa keduanya
 * memakai jawaban yang sama: bantuan yang menurunkan sendiri "formulir mana yang
 * berlaku" akan menyuruh orang mengetik kata kunci yang tidak dijawab apa pun.
 */
describe('formulirYangMenjawab', () => {
  it('menggugurkan formulir tanpa pertanyaan', () => {
    expect(formulirYangMenjawab([form({ fields: [] })])).toHaveLength(0);
  });

  /**
   * `matchRule()` melewati kata kunci kosong, jadi formulir seperti ini memang
   * sudah tidak pernah cocok -- yang berubah cuma bahwa bantuan tidak lagi
   * menyebutnya. Nol perubahan perilaku untuk pencocokannya.
   */
  it('menggugurkan formulir tanpa kata kunci yang berarti', () => {
    expect(formulirYangMenjawab([form({ keywords: [] })])).toHaveLength(0);
    expect(formulirYangMenjawab([form({ keywords: ['', '  '] })])).toHaveLength(0);
    expect(cocokFormulir('request obat', [form({ keywords: [] })])).toBeNull();
  });

  it('mempertahankan yang lengkap, apa adanya', () => {
    const daftar = [form({ id: 1 }), form({ id: 2, fields: [] }), form({ id: 3 })];
    expect(formulirYangMenjawab(daftar).map((f) => f.id)).toEqual([1, 3]);
  });

  /** Jawaban yang sama dipakai kedua pemakainya, dipatok supaya tetap satu penurunan. */
  it('yang digugurkan di sini juga tidak pernah cocok di cocokFormulir', () => {
    for (const rusak of [form({ fields: [] }), form({ keywords: [] })]) {
      expect(formulirYangMenjawab([rusak])).toHaveLength(0);
      expect(cocokFormulir('request obat', [rusak])).toBeNull();
    }
  });
});

describe('mulaiFormulir', () => {
  it('menanyakan pertanyaan pertama dan menyebut jalan keluarnya', () => {
    const hasil = mulaiFormulir(form());
    expect(hasil.aksi).toBe('tanya');
    if (hasil.aksi !== 'tanya') return;
    expect(hasil.balasan).toContain('Obat apa yang dibutuhkan?');
    expect(hasil.balasan).toContain('Pertanyaan 1 dari 1');
    expect(hasil.balasan).toContain('batal');
    expect(hasil.keadaan.jawaban).toHaveLength(0);
  });

  it('pesan pembuka dipakai bila diisi, nama formulir bila tidak', () => {
    const dengan = mulaiFormulir(form({ pesanPembuka: 'Selamat datang di layanan kami.' }));
    expect(dengan.aksi === 'tanya' && dengan.balasan.startsWith('Selamat datang')).toBe(true);
    const tanpa = mulaiFormulir(form({ pesanPembuka: '' }));
    expect(tanpa.aksi === 'tanya' && tanpa.balasan.startsWith('*Permintaan obat*')).toBe(true);
  });

  /**
   * Inti seluruh berkas: apa yang akan ditanyakan sudah ditentukan SEKARANG.
   * Kalau ini pecah, suntingan staf di tengah percakapan menggeser indeks dan
   * jawaban pasien berpasangan dengan pertanyaan yang salah -- tanpa satu pun
   * galat.
   */
  it('membekukan pertanyaan dan kalimat penutup ke dalam keadaan', () => {
    const asli = form({
      fields: [field({ id: 1, label: 'Pertama' }), field({ id: 2, label: 'Kedua' })],
      pesanPenutup: 'Terima kasih.',
    });
    const hasil = mulaiFormulir(asli);
    if (hasil.aksi !== 'tanya') throw new Error('harusnya tanya');

    // Formulirnya disunting staf sesudah percakapan dimulai.
    asli.fields.splice(0, 1);
    asli.pesanPenutup = 'DIGANTI';

    expect(hasil.keadaan.pertanyaan.map((f) => f.label)).toEqual(['Pertama', 'Kedua']);
    expect(hasil.keadaan.penutup).toBe('Terima kasih.');

    const lanjut = lanjutkanFormulir(hasil.keadaan, 'jawaban satu');
    expect(lanjut.aksi === 'tanya' && lanjut.balasan).toContain('Kedua');
  });
});

describe('lanjutkanFormulir', () => {
  function mulai(f: RingkasanFormulir): KeadaanFormulir {
    const hasil = mulaiFormulir(f);
    if (hasil.aksi !== 'tanya') throw new Error('harusnya tanya');
    return hasil.keadaan;
  }

  it('jawaban terakhir menghasilkan baris yang siap disimpan', () => {
    const hasil = lanjutkanFormulir(mulai(form()), 'Paracetamol 500mg');
    expect(hasil.aksi).toBe('selesai');
    if (hasil.aksi !== 'selesai') return;
    expect(hasil.simpan).toEqual({
      formId: 7,
      nama: 'Permintaan obat',
      jawaban: [{ pertanyaan: 'Obat apa yang dibutuhkan?', jawaban: 'Paracetamol 500mg' }],
    });
  });

  /**
   * Pasien menyerahkan keterangan yang akan ditindaklanjuti orang lain, dan
   * ini satu-satunya kesempatannya melihat apa yang benar-benar tercatat.
   */
  it('penutup selalu mengulang apa yang tercatat', () => {
    const hasil = lanjutkanFormulir(mulai(form()), 'Amlodipin');
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(hasil.balasan).toContain('Yang tercatat');
    expect(hasil.balasan).toContain('Amlodipin');
    expect(hasil.balasan).toContain('Petugas kami akan menghubungi Anda.');
  });

  it('pertanyaan berurutan dijawab satu per satu', () => {
    const f = form({
      fields: [field({ id: 1, label: 'Nama obat' }), field({ id: 2, label: 'Jumlah', tipe: 'angka' })],
    });
    const hasil = isiSampaiSelesai(mulai(f), ['Amlodipin', '30']);
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(hasil.simpan.jawaban).toEqual([
      { pertanyaan: 'Nama obat', jawaban: 'Amlodipin' },
      { pertanyaan: 'Jumlah', jawaban: '30' },
    ]);
  });

  // --- pembatalan ---------------------------------------------------------

  it('kata batal sendirian membatalkan, di tengah kalimat tidak', () => {
    expect(lanjutkanFormulir(mulai(form()), 'batal').aksi).toBe('batal');
    expect(lanjutkanFormulir(mulai(form()), 'BATAL').aksi).toBe('batal');
    // Jawaban sah yang kebetulan memuat kata itu tidak boleh membuang isian.
    expect(lanjutkanFormulir(mulai(form()), 'obat saya batal diambil kemarin').aksi).toBe('selesai');
  });

  it('mintaBatal hanya cocok pada seluruh pesan', () => {
    expect(mintaBatal('/batal')).toBe(true);
    expect(mintaBatal('  Batalkan  ')).toBe(true);
    expect(mintaBatal('jangan dibatalkan')).toBe(false);
  });

  // --- wajib / boleh kosong ----------------------------------------------

  it('pertanyaan wajib menolak jawaban kosong dan TIDAK memajukan keadaan', () => {
    const awal = mulai(form());
    const hasil = lanjutkanFormulir(awal, '-');
    expect(hasil.aksi).toBe('ulangi');
    if (hasil.aksi !== 'ulangi') return;
    expect(hasil.keadaan.indeks).toBe(awal.indeks);
    expect(hasil.balasan).toContain('wajib');
    // Pertanyaannya diulang, bukan cuma galatnya.
    expect(hasil.balasan).toContain('Obat apa yang dibutuhkan?');
  });

  it('pertanyaan tak wajib boleh dilewati dan tersimpan kosong', () => {
    const f = form({ fields: [field({ wajib: false, label: 'Keterangan tambahan' })] });
    const hasil = lanjutkanFormulir(mulai(f), '-');
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(hasil.simpan.jawaban).toEqual([{ pertanyaan: 'Keterangan tambahan', jawaban: '' }]);
    // Yang kosong tidak ikut diulang di ringkasan -- baris berlabel tanpa isi
    // terbaca sebagai sistem rusak.
    expect(hasil.balasan).not.toContain('Keterangan tambahan');
  });

  // --- tipe angka ---------------------------------------------------------

  it('angka menerima pemisah ribuan dan menyimpan teks aslinya', () => {
    const f = form({ fields: [field({ tipe: 'angka', label: 'Jumlah' })] });
    const hasil = lanjutkanFormulir(mulai(f), '50.000');
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(hasil.simpan.jawaban[0]!.jawaban).toBe('50.000');
  });

  it('angka menolak yang bukan angka', () => {
    const f = form({ fields: [field({ tipe: 'angka', label: 'Jumlah' })] });
    const hasil = lanjutkanFormulir(mulai(f), 'dua strip');
    expect(hasil.aksi).toBe('ulangi');
    expect(hasil.aksi === 'ulangi' && hasil.balasan).toContain('angka');
  });

  // --- tipe pilihan -------------------------------------------------------

  it('pilihan menyimpan ISI pilihannya, bukan nomornya', () => {
    const f = form({ fields: [field({ tipe: 'pilihan', label: 'Cara bayar', pilihan: ['Umum', 'BPJS'] })] });
    const hasil = lanjutkanFormulir(mulai(f), '2');
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    // Nomor 2 yang tersimpan telanjang berhenti punya arti pada hari staf
    // menyusun ulang daftar pilihannya.
    expect(hasil.simpan.jawaban[0]!.jawaban).toBe('BPJS');
  });

  it('pilihan juga menerima yang diketik apa adanya', () => {
    const f = form({ fields: [field({ tipe: 'pilihan', label: 'Cara bayar', pilihan: ['Umum', 'BPJS'] })] });
    const hasil = lanjutkanFormulir(mulai(f), 'bpjs');
    if (hasil.aksi !== 'selesai') throw new Error('harusnya selesai');
    expect(hasil.simpan.jawaban[0]!.jawaban).toBe('BPJS');
  });

  it('pilihan di luar daftar ditolak dan pilihannya ditampilkan lagi', () => {
    const f = form({ fields: [field({ tipe: 'pilihan', label: 'Cara bayar', pilihan: ['Umum', 'BPJS'] })] });
    const hasil = lanjutkanFormulir(mulai(f), '9');
    expect(hasil.aksi).toBe('ulangi');
    expect(hasil.aksi === 'ulangi' && hasil.balasan).toContain('BPJS');
  });

  // --- batas panjang ------------------------------------------------------

  it('jawaban kepanjangan ditolak, bukan dipotong diam-diam', () => {
    const hasil = lanjutkanFormulir(mulai(form()), 'x'.repeat(MAKS_JAWABAN + 1));
    expect(hasil.aksi).toBe('ulangi');
    expect(hasil.aksi === 'ulangi' && hasil.balasan).toContain('kepanjangan');
  });

  it('batas per pertanyaan mengalahkan batas bawaan', () => {
    const f = form({ fields: [field({ maksPanjang: 10 })] });
    expect(lanjutkanFormulir(mulai(f), 'x'.repeat(11)).aksi).toBe('ulangi');
    expect(lanjutkanFormulir(mulai(f), 'x'.repeat(10)).aksi).toBe('selesai');
  });

  // --- keadaan menyimpang -------------------------------------------------

  /**
   * Hanya lahir dari suntingan SQL langsung atau versi kode yang berbeda.
   * Menyimpan apa adanya lebih baik daripada menggantung: yang sudah diisi
   * pasien tetap sampai ke staf.
   */
  it('indeks di luar jangkauan menyelesaikan dengan apa yang sudah ada', () => {
    const keadaan: KeadaanFormulir = {
      formId: 7,
      nama: 'Permintaan obat',
      penutup: '',
      indeks: 99,
      pertanyaan: [field()],
      jawaban: [{ pertanyaan: 'Obat apa?', jawaban: 'Amlodipin' }],
    };
    const hasil = lanjutkanFormulir(keadaan, 'apa pun');
    expect(hasil.aksi).toBe('selesai');
    expect(hasil.aksi === 'selesai' && hasil.simpan.jawaban).toHaveLength(1);
  });
});

describe('isTipeField', () => {
  it('menjaring tipe yang tidak dikenal', () => {
    expect(isTipeField('teks')).toBe(true);
    expect(isTipeField('angka')).toBe(true);
    expect(isTipeField('pilihan')).toBe(true);
    expect(isTipeField('tanggal')).toBe(false);
  });
});
