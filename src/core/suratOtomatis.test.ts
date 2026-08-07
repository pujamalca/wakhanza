import { putuskanSuratOtomatis, jendelaSuratOtomatis, type KandidatSurat } from './suratOtomatis';

function kandidat(no: string, extra: Partial<KandidatSurat<string>> = {}): KandidatSurat<string> {
  // Nomor karangan: fungsi ini menerima nomor yang SUDAH diselesaikan dan tidak
  // pernah menguraikannya, jadi bentuknya tidak perlu -- dan tidak boleh --
  // nomor seseorang yang sungguhan.
  return { baris: no, kdPoli: 'U0001', phoneE164: '628000000001', optOut: false, ...extra };
}

const LONGGAR = { poliSensitif: [], kuota: 100 };
const nomorSurat = (k: KandidatSurat<string>) => k.baris;

describe('putuskanSuratOtomatis', () => {
  it('mengirim surat yang polinya biasa dan nomornya terpakai', () => {
    const hasil = putuskanSuratOtomatis([kandidat('SKS20260807001'), kandidat('SKS20260807002')], LONGGAR);
    expect(hasil.kirim.map(nomorSurat)).toEqual(['SKS20260807001', 'SKS20260807002']);
    expect(hasil.lewat).toEqual([]);
  });

  it('menolak poli sensitif alih-alih menggantinya dengan pesan generik', () => {
    const hasil = putuskanSuratOtomatis([kandidat('SKS20260807001', { kdPoli: 'JIWA' })], {
      ...LONGGAR,
      poliSensitif: ['JIWA'],
    });
    expect(hasil.kirim).toEqual([]);
    expect(hasil.lewat.map((l) => l.alasan)).toEqual(['poli_sensitif']);
  });

  it('melewati nomor yang tidak bisa diselesaikan', () => {
    const hasil = putuskanSuratOtomatis([kandidat('SKS20260807001', { phoneE164: null })], LONGGAR);
    expect(hasil.kirim).toEqual([]);
    expect(hasil.lewat.map((l) => l.alasan)).toEqual(['nomor']);
  });

  it('melewati nomor yang sudah minta berhenti kirim otomatis', () => {
    const hasil = putuskanSuratOtomatis([kandidat('SKS20260807001', { optOut: true })], LONGGAR);
    expect(hasil.kirim).toEqual([]);
    expect(hasil.lewat.map((l) => l.alasan)).toEqual(['opt_out']);
  });

  /**
   * Nomor diperiksa SEBELUM daftar tolak, dan urutan itu bukan selera: pasien
   * tanpa nomor tidak punya apa pun untuk dicocokkan ke daftar tolak, jadi
   * melaporkannya sebagai "minta berhenti" akan menyesatkan petugas yang
   * mencari nomor mana yang perlu dibetulkan.
   */
  it('tanpa nomor dilaporkan sebagai nomor, bukan sebagai daftar tolak', () => {
    const hasil = putuskanSuratOtomatis([kandidat('SKS20260807001', { phoneE164: null, optOut: true })], LONGGAR);
    expect(hasil.lewat.map((l) => l.alasan)).toEqual(['nomor']);
  });

  it('menahan kelebihan kuota sebagai "kuota", bukan sebagai penolakan', () => {
    const baris = [kandidat('SKS20260807001'), kandidat('SKS20260807002'), kandidat('SKS20260807003')];
    const hasil = putuskanSuratOtomatis(baris, { poliSensitif: [], kuota: 2 });
    expect(hasil.kirim.map(nomorSurat)).toEqual(['SKS20260807001', 'SKS20260807002']);
    expect(hasil.lewat.map((l) => [nomorSurat(l.kandidat), l.alasan])).toEqual([['SKS20260807003', 'kuota']]);
  });

  it('kuota 0 tidak mengirim apa pun, dan tidak melempar', () => {
    const hasil = putuskanSuratOtomatis([kandidat('SKS20260807001')], { poliSensitif: [], kuota: 0 });
    expect(hasil.kirim).toEqual([]);
    expect(hasil.lewat.map((l) => l.alasan)).toEqual(['kuota']);
  });

  /**
   * Inti dari urutan pemeriksaannya. Surat yang toh ditolak tidak boleh memakan
   * jatah -- kalau ia memakannya, satu pasien poli sensitif di depan antrean
   * cukup untuk menunda surat pasien lain sampai siklus berikutnya, tanpa sebab
   * yang bisa dilihat siapa pun.
   */
  it('surat yang ditolak TIDAK memakan jatah kuota', () => {
    const baris = [
      kandidat('SKS20260807001', { kdPoli: 'JIWA' }),
      kandidat('SKS20260807002', { phoneE164: null }),
      kandidat('SKS20260807003', { optOut: true }),
      kandidat('SKS20260807004'),
      kandidat('SKS20260807005'),
    ];
    const hasil = putuskanSuratOtomatis(baris, { poliSensitif: ['JIWA'], kuota: 2 });
    expect(hasil.kirim.map(nomorSurat)).toEqual(['SKS20260807004', 'SKS20260807005']);
    expect(hasil.lewat.map((l) => l.alasan)).toEqual(['poli_sensitif', 'nomor', 'opt_out']);
  });

  it('tidak pernah kehilangan satu baris pun: masuk = kirim + lewat', () => {
    const baris = [
      kandidat('SKS20260807001', { kdPoli: 'JIWA' }),
      kandidat('SKS20260807002', { phoneE164: null }),
      kandidat('SKS20260807003'),
      kandidat('SKS20260807004'),
      kandidat('SKS20260807005'),
    ];
    const hasil = putuskanSuratOtomatis(baris, { poliSensitif: ['JIWA'], kuota: 1 });
    expect(hasil.kirim.length + hasil.lewat.length).toBe(baris.length);
  });
});

describe('jendelaSuratOtomatis', () => {
  const HARI = new Date(2026, 7, 7); // 7 Agustus 2026, waktu lokal

  it('merentang ke dua arah dari hari ini', () => {
    expect(jendelaSuratOtomatis(HARI, 7, null)).toEqual({ dari: '2026-07-31', sampai: '2026-08-14' });
  });

  /**
   * Batas ATASNYA yang paling gampang dikira salah. Surat yang ditulis hari ini
   * untuk istirahat mulai pekan depan bernomor lebih besar daripada prefiks hari
   * ini; jendela yang berhenti di hari ini membuangnya tanpa satu pun galat.
   */
  it('batas atasnya melewati hari ini, bukan berhenti padanya', () => {
    const { sampai } = jendelaSuratOtomatis(HARI, 7, null);
    expect(sampai > '2026-08-07').toBe(true);
  });

  it('lantai aktivasi menang bila lebih baru daripada lookback', () => {
    expect(jendelaSuratOtomatis(HARI, 7, '2026-08-05')).toEqual({ dari: '2026-08-05', sampai: '2026-08-14' });
  });

  it('lantai aktivasi yang sudah lampau tidak mempersempit apa pun', () => {
    expect(jendelaSuratOtomatis(HARI, 7, '2026-01-01').dari).toBe('2026-07-31');
  });

  it('menyeberangi pergantian bulan dan tahun', () => {
    expect(jendelaSuratOtomatis(new Date(2026, 0, 3), 7, null)).toEqual({
      dari: '2025-12-27',
      sampai: '2026-01-10',
    });
  });

  it('lookback 0 menyisakan hari ini saja', () => {
    expect(jendelaSuratOtomatis(HARI, 0, null)).toEqual({ dari: '2026-08-07', sampai: '2026-08-07' });
  });
});
