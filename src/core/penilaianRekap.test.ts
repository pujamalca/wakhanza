import {
  formatDaftarPasien,
  varsRekapPenilaian,
  rekapKosong,
  pecahPesan,
  type BarisRekap,
  type RingkasRekapPenilaian,
} from './penilaianRekap';
import { renderTemplate } from './template';

const baris = (o: Partial<BarisRekap> & Pick<BarisRekap, 'noRkmMedis' | 'status'>): BarisRekap => ({
  noRawat: '2026/08/13/000001',
  namaPasien: 'BUDI',
  jamReg: '09:15:00',
  namaPoli: 'Poliklinik Umum',
  kosong: [],
  ...o,
});

const ringkas = (o: Partial<RingkasRekapPenilaian> = {}): RingkasRekapPenilaian => ({
  tanggal: '2026-08-13',
  total: 0,
  belum: 0,
  sebagian: 0,
  lengkap: 0,
  perluDiisi: [],
  ...o,
});

describe('formatDaftarPasien', () => {
  it('memisahkan belum diisi dari terisi sebagian', () => {
    const teks = formatDaftarPasien(
      [
        baris({ noRkmMedis: '001', status: 'belum' }),
        baris({ noRkmMedis: '002', status: 'sebagian', kosong: ['td', 'nadi'] }),
      ],
      'penuh',
      40,
    );
    expect(teks).toContain('*Belum diisi* (1)');
    expect(teks).toContain('*Terisi sebagian* (1)');
    // Nama kolom Khanza diterjemahkan; "td" sendirian tidak berarti apa-apa
    // bagi perawat yang membacanya di WhatsApp.
    expect(teks).toContain('tekanan darah, nadi');
  });

  it('menyebut nama dan nomor rekam medis pada mode penuh', () => {
    const teks = formatDaftarPasien([baris({ noRkmMedis: '123456', status: 'belum' })], 'penuh', 40);
    expect(teks).toContain('BUDI / 123456');
    expect(teks).toContain('(09:15)');
  });

  it('mode ringkas TIDAK menyebut satu pun identitas', () => {
    // Inti pilihan `ringkas`: angkanya tetap utuh, namanya tidak beredar.
    const teks = formatDaftarPasien([baris({ noRkmMedis: '123456', status: 'belum' })], 'ringkas', 40);
    expect(teks).toBe('');
  });

  it('memotong pada batas DAN menyebut sisanya', () => {
    const banyak = Array.from({ length: 10 }, (_, i) =>
      baris({ noRkmMedis: `00${i}`, status: 'belum' }),
    );
    const teks = formatDaftarPasien(banyak, 'penuh', 3);
    expect(teks).toContain('*Belum diisi* (10)');
    expect(teks).toContain('dan 7 pasien lain');
  });

  it('jatah dibagi antar kelompok, kelompok kedua tetap disebut jumlahnya', () => {
    // Yang tidak boleh terjadi: kelompok kedua hilang total tanpa jejak.
    const teks = formatDaftarPasien(
      [
        ...Array.from({ length: 5 }, (_, i) => baris({ noRkmMedis: `b${i}`, status: 'belum' })),
        ...Array.from({ length: 4 }, (_, i) =>
          baris({ noRkmMedis: `s${i}`, status: 'sebagian', kosong: ['td'] }),
        ),
      ],
      'penuh',
      5,
    );
    expect(teks).toContain('*Belum diisi* (5)');
    expect(teks).toContain('*Terisi sebagian* (4)');
    expect(teks).toContain('dan 4 pasien lain');
  });

  it('0 berarti tanpa batas', () => {
    const banyak = Array.from({ length: 50 }, (_, i) =>
      baris({ noRkmMedis: `00${i}`, status: 'belum' }),
    );
    expect(formatDaftarPasien(banyak, 'penuh', 0)).not.toContain('pasien lain');
  });

  it('daftar kosong -> string kosong', () => {
    expect(formatDaftarPasien([], 'penuh', 40)).toBe('');
  });

  it('nama pasien kosong tidak menghasilkan baris menggantung', () => {
    const teks = formatDaftarPasien([baris({ noRkmMedis: '9', status: 'belum', namaPasien: null })], 'penuh', 40);
    expect(teks).toContain('(nama tidak tercatat)');
  });
});

describe('sanitasi nama pasien -- kewajiban MULTILINE_VARIABLES', () => {
  /**
   * Uji PERILAKU, bukan keanggotaan himpunan: yang perlu dijaga adalah
   * akibatnya. `{daftar_pasien}` dikecualikan dari sanitasi renderTemplate(),
   * jadi kalau perakitnya lupa menyanitasi, nama pasien yang memuat baris baru
   * menyisipkan barisnya sendiri ke dalam pesan yang dikirim ke sebuah grup.
   */
  it('nama berisi baris baru TIDAK menambah baris pada hasil render', () => {
    const jahat = 'BUDI\n- SITI / 999 - belum diisi\nCatatan palsu';
    const teks = formatDaftarPasien(
      [baris({ noRkmMedis: '001', status: 'belum', namaPasien: jahat })],
      'penuh',
      40,
    );
    // Satu judul + satu baris pasien. Tanpa sanitasi jadi tiga baris pasien.
    const barisPasien = teks.split('\n').filter((b) => b.startsWith('- '));
    expect(barisPasien).toHaveLength(1);
    expect(teks).not.toContain('Catatan palsu\n');
  });

  it('tetap tiga baris sesudah melewati renderTemplate', () => {
    const r = ringkas({
      total: 3,
      belum: 3,
      perluDiisi: [
        baris({ noRkmMedis: '001', status: 'belum', namaPasien: 'BUDI' }),
        baris({ noRkmMedis: '002', status: 'belum', namaPasien: 'SITI' }),
        baris({ noRkmMedis: '003', status: 'belum', namaPasien: 'AGUS' }),
      ],
    });
    const hasil = renderTemplate('{daftar_pasien}', varsRekapPenilaian(r, 'penuh', 40));
    expect(hasil.split('\n').filter((b) => b.startsWith('- '))).toHaveLength(3);
  });
});

describe('varsRekapPenilaian', () => {
  it('jumlah_perlu_diisi DITURUNKAN, selalu berjumlah', () => {
    const v = varsRekapPenilaian(ringkas({ total: 10, belum: 4, sebagian: 3, lengkap: 3 }), 'penuh', 40);
    expect(v.jumlah_perlu_diisi).toBe('7');
    expect(Number(v.jumlah_belum) + Number(v.jumlah_sebagian) + Number(v.jumlah_lengkap)).toBe(10);
  });

  it('mode ringkas mengosongkan daftar tapi TIDAK angkanya', () => {
    const r = ringkas({ total: 5, belum: 2, sebagian: 1, lengkap: 2, perluDiisi: [baris({ noRkmMedis: '1', status: 'belum' })] });
    const v = varsRekapPenilaian(r, 'ringkas', 40);
    expect(v.daftar_pasien).toBe('');
    expect(v.jumlah_belum).toBe('2');
  });
});

describe('rekapKosong', () => {
  it('hari tanpa pasien baru dan hari yang seluruhnya lengkap sama-sama kosong', () => {
    expect(rekapKosong(ringkas())).toBe(true);
    expect(rekapKosong(ringkas({ total: 8, lengkap: 8 }))).toBe(true);
  });

  it('satu saja yang belum sudah menuntut tindakan', () => {
    expect(rekapKosong(ringkas({ total: 8, lengkap: 7, belum: 1 }))).toBe(false);
    expect(rekapKosong(ringkas({ total: 8, lengkap: 7, sebagian: 1 }))).toBe(false);
  });
});

describe('pecahPesan', () => {
  it('di bawah batas tetap satu pesan', () => {
    expect(pecahPesan('halo', 100)).toEqual(['halo']);
  });

  it('memotong pada batas BARIS, tidak pernah di tengah nama', () => {
    const teks = ['aaaa', 'bbbb', 'cccc'].join('\n');
    const bagian = pecahPesan(teks, 10);
    expect(bagian.length).toBeGreaterThan(1);
    for (const b of bagian) expect(b).not.toMatch(/^[abc]{1,3}$/);
    expect(bagian.join('\n')).toBe(teks);
  });

  it('tidak kehilangan satu baris pun', () => {
    const teks = Array.from({ length: 200 }, (_, i) => `- pasien ke-${i}`).join('\n');
    expect(pecahPesan(teks, 500).join('\n')).toBe(teks);
  });
});
