import {
  bacaRincian,
  isRincianTujuan,
  susunPemberitahuanFormulir,
  type IsiPemberitahuan,
} from './waFormulirTujuan';

/**
 * Nomor dan no. RM sintetis -- repo ini PUBLIK, jadi tidak ada satu pun nilai
 * sungguhan di berkas uji. Bentuknya tetap realistis supaya pemeriksaan
 * "bocor / tidak" benar-benar berarti.
 */
const NOMOR = '628000000001';
const NO_RM = '999888';

const WAKTU = new Date(2026, 7, 17, 14, 32);

function isi(patch: Partial<IsiPemberitahuan> = {}): IsiPemberitahuan {
  return {
    formNama: 'Permintaan obat rutin',
    waktu: WAKTU,
    phoneE164: NOMOR,
    dariGrup: false,
    jawaban: [
      { pertanyaan: 'Obat apa yang dibutuhkan?', jawaban: 'Amlodipine 10mg' },
      { pertanyaan: 'Berapa banyak?', jawaban: '30 tablet' },
    ],
    ...patch,
  };
}

describe('bacaRincian', () => {
  it('menerima kedua nilai yang sah', () => {
    expect(bacaRincian('ringkas')).toBe('ringkas');
    expect(bacaRincian('lengkap')).toBe('lengkap');
  });

  /**
   * Arah jatuhnya yang diuji, bukan sekadar "tidak melempar". Jatuh ke
   * `lengkap` berarti kolom yang belum termigrasi diam-diam menyiarkan seluruh
   * jawaban pasien ke grup -- kesalahan yang tidak bisa ditarik kembali.
   */
  it('menjatuhkan nilai tak dikenal ke ringkas, bukan lengkap', () => {
    for (const v of ['', 'LENGKAP', 'penuh', 'null', null, undefined]) {
      expect(bacaRincian(v as string | null | undefined)).toBe('ringkas');
    }
  });

  it('isRincianTujuan menolak yang bukan salah satu dari keduanya', () => {
    expect(isRincianTujuan('ringkas')).toBe(true);
    expect(isRincianTujuan('lengkap')).toBe(true);
    expect(isRincianTujuan('semua')).toBe(false);
  });
});

describe('susunPemberitahuanFormulir — ringkas', () => {
  it('menyebut nama formulir, waktu, dan berapa pertanyaan terisi', () => {
    const teks = susunPemberitahuanFormulir(isi(), 'ringkas');
    expect(teks).toContain('Permintaan obat rutin');
    expect(teks).toContain('17/08 14:32');
    expect(teks).toContain('2 pertanyaan terisi');
    expect(teks).toContain('dashboard');
  });

  /**
   * Inti mode ini: grup tahu ADA yang masuk, tidak tahu ISINYA. Kedua jawaban
   * diperiksa satu per satu -- memeriksa cuma yang pertama akan lolos walau
   * sisanya ikut.
   */
  it('TIDAK memuat satu pun teks jawaban pasien', () => {
    const teks = susunPemberitahuanFormulir(isi(), 'ringkas');
    expect(teks).not.toContain('Amlodipine');
    expect(teks).not.toContain('30 tablet');
  });

  it('TIDAK memuat nomor telepon, bahkan tidak sepotong pun', () => {
    const teks = susunPemberitahuanFormulir(isi(), 'ringkas');
    expect(teks).not.toContain(NOMOR);
    // Empat digit terakhir: bentuk penyamaran yang sengaja TIDAK dipakai.
    expect(teks).not.toContain(NOMOR.slice(-4));
  });

  it('menandai jawaban yang datang dari sebuah grup', () => {
    const teks = susunPemberitahuanFormulir(isi({ dariGrup: true, phoneE164: null }), 'ringkas');
    expect(teks).toContain('dari sebuah grup');
  });
});

describe('susunPemberitahuanFormulir — lengkap', () => {
  it('memuat seluruh pasangan pertanyaan dan jawaban, bernomor', () => {
    const teks = susunPemberitahuanFormulir(isi(), 'lengkap');
    expect(teks).toContain('1. Obat apa yang dibutuhkan?');
    expect(teks).toContain('Amlodipine 10mg');
    expect(teks).toContain('2. Berapa banyak?');
    expect(teks).toContain('30 tablet');
  });

  it('memuat nomor penanya — itulah yang membuat grup bisa bertindak tanpa dashboard', () => {
    expect(susunPemberitahuanFormulir(isi(), 'lengkap')).toContain(NOMOR);
  });

  it('menulis (dilewati) untuk jawaban kosong, bukan baris yang menggantung', () => {
    const teks = susunPemberitahuanFormulir(
      isi({ jawaban: [{ pertanyaan: 'Keterangan tambahan', jawaban: '   ' }] }),
      'lengkap',
    );
    expect(teks).toContain('(dilewati)');
  });

  it('tidak menyebut nomor untuk jawaban yang datang dari grup', () => {
    const teks = susunPemberitahuanFormulir(isi({ dariGrup: true, phoneE164: null }), 'lengkap');
    expect(teks).toContain('sebuah grup');
    expect(teks).not.toContain('null');
  });

  it('nomor yang gagal dipetakan dikatakan apa adanya, bukan dibiarkan null', () => {
    const teks = susunPemberitahuanFormulir(isi({ phoneE164: null }), 'lengkap');
    expect(teks).toContain('tidak terbaca');
    expect(teks).not.toContain('null');
  });

  it('formulir tanpa satu pun jawaban tersimpan tetap menghasilkan pesan yang jujur', () => {
    const teks = susunPemberitahuanFormulir(isi({ jawaban: [] }), 'lengkap');
    expect(teks).toContain('tidak ada satu pun jawaban');
  });

  /**
   * Kurung kurawal yang diketik pasien harus SELAMAT dari penyusunan di sini.
   * Yang menjaganya dari `renderTemplate()` di hilir adalah `varsApaAdanya()` di
   * `formulirReply.ts`; kalau builder ini sendiri sudah memakannya lebih dulu,
   * pagar itu tidak pernah kebagian apa pun untuk dijaga.
   */
  it('meneruskan kurung kurawal yang diketik pasien apa adanya', () => {
    const teks = susunPemberitahuanFormulir(
      isi({ jawaban: [{ pertanyaan: 'Obat apa?', jawaban: 'obat {kontak_rs} 10mg' }] }),
      'lengkap',
    );
    expect(teks).toContain('obat {kontak_rs} 10mg');
  });
});

/**
 * Dipisah dari kedua describe di atas karena ia berlaku untuk KEDUANYA, dan
 * itulah yang perlu tetap benar saat suatu saat ada mode ketiga.
 */
describe('no. rekam medis tidak pernah ikut, di mode mana pun', () => {
  it.each(['ringkas', 'lengkap'] as const)('%s', (rincian) => {
    /**
     * Objeknya sengaja dibentuk seperti BARIS `wa_form_entry`, yang memang
     * membawa `noRkmMedis` tepat di sebelah `phoneE164`. Itulah bentuk yang ada
     * di tangan pemanggil, dan itulah kenapa menambahkannya ke pesan adalah
     * kesalahan yang paling mudah dilakukan tanpa sadar.
     */
    const barisEntry = { ...isi(), noRkmMedis: NO_RM } as IsiPemberitahuan;
    const teks = susunPemberitahuanFormulir(barisEntry, rincian);
    expect(teks).not.toContain(NO_RM);
  });
});
