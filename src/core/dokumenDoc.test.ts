import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  susunHasilLab,
  susunHasilRadiologi,
  susunNota,
  namaBerkasDokumen,
  teksAsalUsulDokumen,
  PESAN_BAWAAN_DOKUMEN,
  type BarisIdentitasMasuk,
  type BarisNotaMasuk,
} from './dokumenDoc';
import { renderDokumenHtml } from './dokumenHtml';
import type { KopSurat } from './suratDoc';

/**
 * Nilai contoh SELURUHNYA karangan.
 *
 * Berkas uji ikut ter-commit, jadi tidak boleh ada satu pun nama, nomor rekam
 * medis, nomor telepon, atau nama dokter sungguhan di sini. Bentuk datanya
 * (penanda 'KELURAHAN', nilai negatif pada potongan, subtotal berupa teks
 * terformat) diambil dari pengamatan atas data produksi -- yang ditiru
 * BENTUKNYA, bukan isinya.
 */
const IDENTITAS: BarisIdentitasMasuk = {
  no_rawat: '2026/01/02/000001',
  tgl_registrasi: '2026-01-02',
  umurdaftar: 30,
  sttsumur: 'Th',
  no_rkm_medis: '000123',
  nm_poli: 'Poliklinik Contoh',
  nm_pasien: 'Pasien Contoh',
  jk: 'L',
  tgl_lahir: '1996-01-02',
  alamat: 'Jalan Contoh',
  // Penanda bawaan Khanza -- nama tabelnya sendiri, pada 89% pasien.
  nm_kel: 'KELURAHAN',
  nm_kec: 'Kecamatan Contoh',
  nm_kab: 'KABUPATEN',
  png_jawab: 'UMUM',
  nm_dokter: 'dr. Contoh',
  kd_dokter: 'D001',
};

const KOP: KopSurat = {
  namaRs: 'RS Contoh',
  alamatRs: 'Jalan RS 1',
  kotaRs: 'Kota Contoh',
  propinsiRs: 'Propinsi Contoh',
  kontakRs: '0800000000',
  emailRs: 'kontak@contoh.test',
  logoDataUri: '',
};

// ---------------------------------------------------------------------------
// Nama berkas & asal-usul
// ---------------------------------------------------------------------------

describe('namaBerkasDokumen', () => {
  /**
   * Nama berkas adalah bagian yang PALING kelihatan -- ia muncul di daftar chat
   * dan di pratinjau notifikasi layar kunci, sebelum siapa pun membuka isinya.
   * Berbeda dari `namaBerkasSurat()` yang sengaja memuat nama pasien.
   */
  it('tidak pernah memuat nama pasien', () => {
    for (const jenis of ['lab', 'radiologi', 'nota'] as const) {
      const nama = namaBerkasDokumen(jenis, '2026-01-02');
      expect(nama.toLowerCase()).not.toContain('pasien');
      expect(nama).toMatch(/^[A-Za-z-]+-\d{8}\.pdf$/);
    }
  });

  it('tetap menghasilkan nama sah saat tanggalnya tidak terbaca', () => {
    expect(namaBerkasDokumen('lab', '0000-00-00')).toBe('Hasil-Laboratorium.pdf');
    expect(namaBerkasDokumen('nota', null)).toBe('Rincian-Tagihan.pdf');
  });
});

describe('teksAsalUsulDokumen', () => {
  /**
   * QR mengesahkan SIAPA YANG MENERBITKAN, bukan siapa yang disebut. Bentuk
   * yang terbaca mesin membuat pemanenan borongan jadi murah, jadi tidak boleh
   * ada satu pun data pasien di dalamnya -- Khanza pun tidak memuatnya.
   */
  it('tidak memuat data pasien apa pun', () => {
    const isi = susunNota(IDENTITAS, [], [], 'N/1', '2026-01-02', { rincianObat: true });
    const teks = teksAsalUsulDokumen(KOP, isi.kepala);
    expect(teks).not.toContain('Pasien Contoh');
    expect(teks).not.toContain('000123');
    expect(teks).not.toContain('2026/01/02/000001');
    expect(teks).toContain('Dikeluarkan di RS Contoh');
    expect(teks).toContain('ID D001');
  });
});

// ---------------------------------------------------------------------------
// HASIL LABORATORIUM
// ---------------------------------------------------------------------------

describe('susunHasilLab', () => {
  const baris = [
    {
      panel: 'Panel Contoh',
      pemeriksaan: 'Parameter A',
      nilai: '134',
      satuan: 'mg/dl',
      nilai_rujukan: '70-110',
      keterangan: '',
      nm_petugas: 'Petugas Contoh',
      nm_dokter_pj: 'dr. Penanggung',
      kd_dokter_pj: 'D009',
    },
    {
      panel: 'Panel Contoh',
      pemeriksaan: 'Parameter B',
      nilai: '',
      satuan: '',
      nilai_rujukan: '1-2',
      keterangan: 'tinggi',
      nm_petugas: 'Petugas Contoh',
      nm_dokter_pj: 'dr. Penanggung',
      kd_dokter_pj: 'D009',
    },
    {
      panel: 'Panel Lain',
      pemeriksaan: 'Parameter C',
      nilai: '9',
      satuan: 'g',
      nilai_rujukan: '',
      keterangan: '',
      nm_petugas: 'Petugas Contoh',
      nm_dokter_pj: 'dr. Penanggung',
      kd_dokter_pj: 'D009',
    },
  ];

  it('mengelompokkan parameter per panel dalam urutan kedatangannya', () => {
    const isi = susunHasilLab(IDENTITAS, baris, '2026-01-03');
    expect(isi.kelompok.map((k) => k.panel)).toEqual(['Panel Contoh', 'Panel Lain']);
    expect(isi.kelompok[0]!.baris).toHaveLength(2);
    expect(isi.kelompok[1]!.baris).toHaveLength(1);
  });

  /**
   * Parameter yang diminta tapi hasilnya belum keluar HARUS tetap tampil.
   * Menghilangkannya membuat panel yang belum selesai terlihat persis seperti
   * panel yang sudah lengkap.
   */
  it('mempertahankan parameter yang hasilnya masih kosong', () => {
    const isi = susunHasilLab(IDENTITAS, baris, '2026-01-03');
    expect(isi.kelompok[0]!.baris[1]).toMatchObject({ pemeriksaan: 'Parameter B', hasil: '' });
  });

  it('memakai dokter PENANGGUNG JAWAB pemeriksaan, bukan dokter poli', () => {
    const isi = susunHasilLab(IDENTITAS, baris, '2026-01-03');
    expect(isi.kepala.namaDokter).toBe('dr. Penanggung');
    expect(isi.kepala.kdDokter).toBe('D009');
  });

  it('membuang penanda wilayah bawaan Khanza dari alamat', () => {
    const isi = susunHasilLab(IDENTITAS, baris, '2026-01-03');
    const alamat = isi.kepala.identitas.find((b) => b.label === 'Alamat')!.nilai;
    expect(alamat).toBe('Jalan Contoh, Kecamatan Contoh');
    expect(alamat).not.toContain('KELURAHAN');
    expect(alamat).not.toContain('KABUPATEN');
  });

  it('jatuh ke tanggal registrasi bila tanggal periksanya tidak ada', () => {
    const isi = susunHasilLab(IDENTITAS, baris, null);
    expect(isi.kepala.tanggalDokumen).toBe('2 Januari 2026');
  });
});

// ---------------------------------------------------------------------------
// HASIL RADIOLOGI
// ---------------------------------------------------------------------------

describe('susunHasilRadiologi', () => {
  it('meneruskan narasi apa adanya, hanya merapatkan baris kosong berlebih', () => {
    const isi = susunHasilRadiologi(
      IDENTITAS,
      [{ jam: '08:00:00', hasil: 'Baris satu\r\n\n\n\nBaris dua  ' }],
      [{ jam: '08:00:00', nm_perawatan: 'Pemeriksaan Contoh', nm_dokter_pj: 'dr. Radio', kd_dokter_pj: 'D077' }],
      '2026-01-03',
    );
    expect(isi.bacaan[0]!.teks).toBe('Baris satu\n\nBaris dua');
    expect(isi.pemeriksaan).toEqual(['Pemeriksaan Contoh']);
    expect(isi.kepala.namaDokter).toBe('dr. Radio');
  });

  it('membuang blok bacaan yang kosong dan menyaring nama pemeriksaan ganda', () => {
    const isi = susunHasilRadiologi(
      IDENTITAS,
      [
        { jam: '08:00:00', hasil: '   ' },
        { jam: '09:00:00', hasil: 'Ada isinya' },
      ],
      [
        { jam: '08:00:00', nm_perawatan: 'Sama', nm_dokter_pj: null, kd_dokter_pj: null },
        { jam: '09:00:00', nm_perawatan: 'Sama', nm_dokter_pj: null, kd_dokter_pj: null },
      ],
      '2026-01-03',
    );
    expect(isi.bacaan).toHaveLength(1);
    expect(isi.pemeriksaan).toEqual(['Sama']);
  });
});

// ---------------------------------------------------------------------------
// NOTA
// ---------------------------------------------------------------------------

/**
 * Bentuk baris yang ditiru dari `billing` produksi.
 *
 * Yang penting di sini dan gampang salah: LABEL kelompok ada di kolom `no`,
 * bukan `nm_perawatan`; baris subtotal (`Ttl*`) menaruh ANGKANYA sebagai teks
 * terformat di kolom nama; dan baris kepala (`status='-'`) mengulang identitas
 * pasien berikut alamat berpenanda.
 */
const NOTA: BarisNotaMasuk[] = [
  { no_baris: 'No.Nota', nm_perawatan: ': N/1', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: '-' },
  {
    no_baris: 'Alamat Pasien',
    nm_perawatan: ': Jalan Contoh, KELURAHAN, KECAMATAN, KABUPATEN',
    pemisah: '',
    biaya: 0,
    jumlah: 0,
    totalbiaya: 0,
    status: '-',
  },
  { no_baris: '', nm_perawatan: 'dr. Contoh', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Dokter' },
  { no_baris: 'Registrasi', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 10000, status: 'Registrasi' },
  { no_baris: 'Obat & BHP', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Obat' },
  { no_baris: '', nm_perawatan: 'Obat Contoh A', pemisah: ':', biaya: 260, jumlah: 10, totalbiaya: 2600, status: 'Obat' },
  { no_baris: '', nm_perawatan: 'Obat Contoh B', pemisah: ':', biaya: 500, jumlah: 2, totalbiaya: 1000, status: 'Obat' },
  { no_baris: '', nm_perawatan: '3,600', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'TtlObat' },
  { no_baris: 'Potongan Biaya', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Potongan' },
  { no_baris: '', nm_perawatan: 'Potongan Contoh', pemisah: ':', biaya: 5000, jumlah: 1, totalbiaya: -5000, status: 'Potongan' },
];

describe('susunNota', () => {
  it('mengambil label kelompok dari kolom `no`, bukan dari nama layanan', () => {
    const isi = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true });
    const seksi = isi.baris.filter((b) => b.jenis === 'seksi').map((b) => b.label);
    expect(seksi).toEqual(['Registrasi', 'Obat & BHP', 'Potongan Biaya']);
    // Bukti sebaliknya: ':' tidak pernah bocor sebagai label.
    expect(isi.baris.some((b) => b.label === ':')).toBe(false);
  });

  it('membuang baris kepala nota bawaan Khanza berikut alamat berpenandanya', () => {
    const isi = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true });
    expect(isi.baris.some((b) => b.label.includes('KELURAHAN'))).toBe(false);
    expect(isi.baris.some((b) => b.label === 'No.Nota')).toBe(false);
  });

  it('menghitung ulang subtotal dan total, bukan membaca teks terformat Khanza', () => {
    const isi = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true });
    const subtotal = isi.baris.find((b) => b.jenis === 'subtotal')!;
    expect(subtotal.total).toBe('Rp3.600');
    const total = isi.baris.find((b) => b.jenis === 'total')!;
    expect(total.total).toBe('Rp8.600'); // 10.000 + 2.600 + 1.000 - 5.000
  });

  /**
   * INTI sakelar `dokumen.nota_rincian_obat`: yang disembunyikan hanya NAMA
   * obatnya. Angkanya wajib tetap berjumlah sama persis -- nota yang tidak bisa
   * dicocokkan dengan yang dibayar di kasir menimbulkan telepon alih-alih
   * menjawabnya.
   */
  it('meringkas nama obat tanpa mengubah satu pun angka', () => {
    const penuh = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true });
    const ringkas = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: false });

    expect(ringkas.obatDiringkas).toBe(true);
    expect(penuh.obatDiringkas).toBe(false);

    expect(ringkas.baris.some((b) => b.label.includes('Obat Contoh'))).toBe(false);
    expect(penuh.baris.some((b) => b.label.includes('Obat Contoh'))).toBe(true);

    const ambil = (x: typeof penuh, j: string) => x.baris.find((b) => b.jenis === j)!.total;
    expect(ambil(ringkas, 'subtotal')).toBe(ambil(penuh, 'subtotal'));
    expect(ambil(ringkas, 'total')).toBe(ambil(penuh, 'total'));
  });

  it('menulis nilai negatif sebagai -Rp5.000, bukan Rp-5.000', () => {
    // Diuji lewat baris yang memang MEMBAWA rupiah -- baris item tidak lagi
    // membawanya sama sekali (uji berikutnya). Nota berisi potongan saja
    // menjadikan TOTAL-nya negatif.
    const hanyaPotongan: BarisNotaMasuk[] = [
      { no_baris: 'Potongan Biaya', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Potongan' },
      { no_baris: '', nm_perawatan: 'Potongan Contoh', pemisah: ':', biaya: 5000, jumlah: 1, totalbiaya: -5000, status: 'Potongan' },
    ];
    const isi = susunNota(IDENTITAS, hanyaPotongan, [], 'N/1', '2026-01-02', { rincianObat: true });
    expect(isi.baris.find((b) => b.jenis === 'total')!.total).toBe('-Rp5.000');
  });

  /**
   * Nota yang beredar lewat WhatsApp menjawab "berapa" dan "untuk apa saja",
   * BUKAN daftar harga satuan rumah sakit -- yang begitu berpindah tangan
   * berhenti bisa dijelaskan siapa pun dan berumur jauh lebih panjang daripada
   * tarif yang berlaku saat itu.
   *
   * Yang dijaga di sini bukan tampilannya melainkan DATANYA: baris item tidak
   * boleh membawa rupiah sama sekali, sehingga tidak ada yang bisa dirender
   * kembali tanpa perubahan yang disengaja.
   */
  it('tidak membawa satu pun rupiah pada baris item, sementara totalnya utuh', () => {
    const isi = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true });
    const item = isi.baris.filter((b) => b.jenis === 'item');
    expect(item.length).toBeGreaterThan(0);
    for (const b of item) {
      expect(b.total).toBe('');
      expect(JSON.stringify(b)).not.toContain('Rp');
    }
    // Hitungannya TIDAK ikut hilang -- ini yang membedakannya dari membuang baris.
    expect(isi.baris.find((b) => b.jenis === 'subtotal')!.total).toBe('Rp3.600');
    expect(isi.baris.find((b) => b.jenis === 'total')!.total).toBe('Rp8.600');
  });

  it('tidak menempelkan baris TOTAL pada nota yang memang kosong', () => {
    const isi = susunNota(IDENTITAS, [], [], null, null, { rincianObat: true });
    expect(isi.baris).toHaveLength(0);
  });

  it('menandai kasir sebagai penanda tangan nota, bukan dokter', () => {
    const isi = susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true });
    expect(isi.kepala.labelTandaTangan).toContain('Kasir');
  });
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

describe('renderDokumenHtml', () => {
  /**
   * `nm_perawatan` dan `nm_pasien` adalah ketikan bebas petugas di Khanza --
   * sumber yang sama yang membuat substitusi template harus satu lintasan.
   * Sejak pratinjau di layar ada, HTML ini sampai ke peramban petugas.
   */
  it('meloloskan HTML dari nilai yang berasal dari ketikan petugas', () => {
    const jahat: BarisNotaMasuk[] = [
      {
        no_baris: '',
        nm_perawatan: '<img src=x onerror=alert(1)>',
        pemisah: ':',
        biaya: 1,
        jumlah: 1,
        totalbiaya: 1,
        status: 'Tambahan',
      },
    ];
    const isi = susunNota({ ...IDENTITAS, nm_pasien: 'A & <b>B</b>' }, jahat, [], 'N/1', '2026-01-02', {
      rincianObat: true,
    });
    const html = renderDokumenHtml(isi, KOP, { catatanKaki: '', qrDataUri: '' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).not.toContain('<b>B</b>');
  });

  /**
   * Peringatan ini menempel pada HASIL, bukan pada nota -- angka di luar nilai
   * rujukan terbaca sebagai vonis oleh pasien yang membacanya sendirian, dan
   * sebelum fitur ini satu-satunya cara memegang hasilnya adalah datang ke
   * tempat yang ada orang bisa ditanyai.
   *
   * Dokumen yang KOSONG sengaja tidak membawanya: tidak ada angka yang bisa
   * disalahbaca, dan peringatan pada halaman yang isinya "belum ada parameter
   * tercatat" cuma kebisingan.
   */
  it('menyertakan peringatan pembacaan pada hasil pemeriksaan, tidak pada nota', () => {
    const isiLab = susunHasilLab(
      IDENTITAS,
      [
        {
          panel: 'Panel Contoh',
          pemeriksaan: 'Parameter A',
          nilai: '134',
          satuan: 'mg/dl',
          nilai_rujukan: '70-110',
          keterangan: '',
          nm_petugas: null,
          nm_dokter_pj: null,
          kd_dokter_pj: null,
        },
      ],
      '2026-01-03',
    );
    const lab = renderDokumenHtml(isiLab, KOP, { catatanKaki: '', qrDataUri: '' });
    const nota = renderDokumenHtml(susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true }), KOP, {
      catatanKaki: '',
      qrDataUri: '',
    });
    expect(lab).toContain('BUKAN diagnosis');
    expect(nota).not.toContain('BUKAN diagnosis');
  });

  /**
   * Tiga hal sekaligus, dan ketiganya soal apa yang DIBACA pasien pada nota:
   * judul kolomnya menyebut obat (bukan "Barang" yang tidak dipakai siapa pun),
   * tidak ada satu pun rupiah per item, dan halamannya MENGATAKAN kenapa.
   */
  it('mencetak nota tanpa harga per item, berikut kalimat yang menjelaskannya', () => {
    const html = renderDokumenHtml(susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: true }), KOP, {
      catatanKaki: '',
      qrDataUri: '',
    });
    expect(html).toContain('Layanan / Obat');
    expect(html).not.toContain('Layanan / Barang');
    expect(html).toContain('Harga per item sengaja tidak dicantumkan');

    // Tarif satuan "Rp260" milik OBAT CONTOH A tidak boleh muncul di mana pun,
    // sementara subtotal dan totalnya tetap ada.
    expect(html).not.toContain('Rp260');
    expect(html).toContain('Rp3.600');
    expect(html).toContain('Rp8.600');
  });

  it('memberi tahu pembacanya saat rincian obat sengaja diringkas', () => {
    const html = renderDokumenHtml(
      susunNota(IDENTITAS, NOTA, [], 'N/1', '2026-01-02', { rincianObat: false }),
      KOP,
      { catatanKaki: '', qrDataUri: '' },
    );
    expect(html).toContain('sengaja tidak dicantumkan');
  });
});

// ---------------------------------------------------------------------------
// Gerbang: migrasi dan kode harus menyebut kalimat yang SAMA
// ---------------------------------------------------------------------------

describe('PESAN_BAWAAN_DOKUMEN', () => {
  /**
   * `migrations/038` men-seed pesan pengantar supaya kotaknya di dashboard
   * langsung berisi teks yang bisa disunting, dan kode memegang salinan yang
   * sama sebagai cadangan bila barisnya hilang. Dua salinan yang menyimpang
   * menghasilkan dua pesan berbeda tergantung apakah barisnya pernah
   * disunting staf -- perbedaan yang tidak akan terlihat siapa pun sampai ada
   * yang membandingkan pesan dua pasien.
   *
   * Dibaca dari BERKAS migrasinya, bukan dari database: gerbangnya harus tetap
   * jalan tanpa MariaDB hidup, pola yang sama dengan `labels.test.ts`.
   */
  const sql = readFileSync(path.join(process.cwd(), 'migrations', '038_dokumen_hasil.sql'), 'utf8');

  const KUNCI = {
    lab: 'dokumen.pesan_lab',
    radiologi: 'dokumen.pesan_rad',
    nota: 'dokumen.pesan_nota',
  } as const;

  it.each(Object.entries(KUNCI))('%s: teks di migrasi sama dengan di kode', (jenis, kunci) => {
    const cocok = new RegExp(`\\('${kunci.replace('.', '\\.')}',\\s*'([^']*)'\\)`).exec(sql);
    expect(cocok).not.toBeNull();
    expect(cocok![1]).toBe(PESAN_BAWAAN_DOKUMEN[jenis as keyof typeof KUNCI]);
  });

  /**
   * Ketiga pemicunya terikat daftar tolak (`OPT_OUT_TRIGGERS`), jadi pesannya
   * WAJIB menyebut cara berhenti -- janji yang dibaca pasien tidak boleh lebih
   * sempit dari yang dijalankan mesin.
   */
  it('menyebut cara berhenti, karena ketiga pemicunya memang terikat daftar tolak', () => {
    for (const teks of Object.values(PESAN_BAWAAN_DOKUMEN)) {
      expect(teks).toContain('Berhenti Kirim Otomatis');
    }
  });

  /** Pesan berlampiran jadi *caption* dan dibatasi 1.024 karakter. */
  it('cukup pendek untuk jadi keterangan lampiran', () => {
    for (const teks of Object.values(PESAN_BAWAAN_DOKUMEN)) {
      expect(teks.length).toBeLessThan(900);
    }
  });
});
