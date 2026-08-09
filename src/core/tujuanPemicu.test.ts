import { kunciYangDitulis, sasaranPemicuPasien } from './tujuanPemicu';
import { turunkanKunciTujuan } from './idempotency';

const DASAR = 'a'.repeat(40);
const GRUP_A = '120363000000000001@g.us';
const GRUP_B = '120363000000000002@g.us';

describe('sasaranPemicuPasien', () => {
  it('pasien: hanya pasien', () => {
    expect(sasaranPemicuPasien('pasien')).toEqual({ kePasien: true, keTujuan: false });
  });

  it('pasien_dan_tujuan: keduanya', () => {
    expect(sasaranPemicuPasien('pasien_dan_tujuan')).toEqual({ kePasien: true, keTujuan: true });
  });

  it('tujuan: pasien TIDAK ikut', () => {
    // Nilai inilah yang membuat seluruh berkas ini perlu ada: pada mode ini
    // kunci dasarnya tidak pernah tertulis ke outbox.
    expect(sasaranPemicuPasien('tujuan')).toEqual({ kePasien: false, keTujuan: true });
  });
});

describe('kunciYangDitulis', () => {
  it('mode pasien: tepat kunci dasarnya, tujuan diabaikan', () => {
    // Tujuan yang terpasang TIDAK dipakai selama modenya `pasien` -- kalau ikut
    // terhitung, penyaring akan menganggap baris sudah selesai padahal salinan
    // ke grup memang tidak pernah dimaksudkan untuk dibuat.
    expect(kunciYangDitulis(DASAR, 'pasien', [GRUP_A, GRUP_B])).toEqual([DASAR]);
  });

  it('mode pasien_dan_tujuan: kunci dasar DITAMBAH satu turunan per tujuan', () => {
    expect(kunciYangDitulis(DASAR, 'pasien_dan_tujuan', [GRUP_A, GRUP_B])).toEqual([
      DASAR,
      turunkanKunciTujuan(DASAR, GRUP_A),
      turunkanKunciTujuan(DASAR, GRUP_B),
    ]);
  });

  /**
   * INI regresi yang sebenarnya, dan asersi terakhirnya yang paling penting.
   *
   * Siklus KONTROL_TERBIT di produksi menyaring memakai kunci DASAR sementara
   * mode `tujuan` cuma menulis turunannya. Kunci dasar itu tidak pernah ada di
   * `outbox`, jadi penyaringnya tidak pernah menyaring apa pun: jendela pindai
   * diproses ulang tiap 60 detik selamanya, kuota per siklus dimakan baris yang
   * sudah dikabarkan, dan lognya melaporkan pesan yang tidak pernah dibuat.
   */
  it('mode tujuan: kunci dasar TIDAK ikut ditulis', () => {
    const kunci = kunciYangDitulis(DASAR, 'tujuan', [GRUP_A, GRUP_B]);
    expect(kunci).toEqual([turunkanKunciTujuan(DASAR, GRUP_A), turunkanKunciTujuan(DASAR, GRUP_B)]);
    expect(kunci).not.toContain(DASAR);
  });

  it('tiap tujuan mendapat kunci yang BERBEDA', () => {
    // Kalau keduanya sama, tujuan kedua ditolak uq_idem sebagai duplikat dan
    // hanya grup pertama yang pernah menerima apa pun -- tanpa satu pun galat,
    // karena INSERT-nya memang ignoreDuplicates.
    const [a, b] = kunciYangDitulis(DASAR, 'tujuan', [GRUP_A, GRUP_B]);
    expect(a).not.toBe(b);
  });

  it('mode tujuan tanpa tujuan aktif: KOSONG, bukan kunci dasar', () => {
    // Kosong adalah sinyal "pesan ini tidak pergi ke mana pun". Memulangkan
    // kunci dasar di sini akan membuat penyaring menyimpan barisnya sebagai
    // pekerjaan biasa, dan salah setelnya berhenti terlihat.
    expect(kunciYangDitulis(DASAR, 'tujuan', [])).toEqual([]);
  });

  it('kunci dasar yang berbeda tidak pernah bertabrakan di tujuan yang sama', () => {
    const lain = 'b'.repeat(40);
    expect(kunciYangDitulis(DASAR, 'tujuan', [GRUP_A])[0]).not.toBe(kunciYangDitulis(lain, 'tujuan', [GRUP_A])[0]);
  });
});
