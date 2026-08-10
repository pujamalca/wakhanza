import { batasiWatermark, TOLERANSI_WATERMARK_MS } from './watermark';

const SEKARANG = new Date('2026-08-10T09:00:00+07:00');
const menit = (n: number) => n * 60 * 1000;
const geser = (ms: number) => new Date(SEKARANG.getTime() + ms);

describe('batasiWatermark', () => {
  it('meloloskan waktu kejadian yang sudah lewat apa adanya', () => {
    const diminta = geser(-menit(90));
    const hasil = batasiWatermark(diminta, SEKARANG);
    expect(hasil.nilai).toEqual(diminta);
    expect(hasil.lampauMs).toBe(0);
  });

  /**
   * Stempel waktunya ditulis workstation Khanza dan dibaca di sini, jadi kedua
   * jamnya tidak pernah persis sama. Tanpa toleransi, selisih beberapa detik
   * yang sepenuhnya normal dilaporkan sebagai anomali SETIAP hari -- dan
   * peringatan yang muncul setiap hari berhenti dibaca, persis alasan level log
   * dipisah `debug`/`warn` di `wa-client.ts`.
   */
  it('selisih jam antar mesin di dalam toleransi bukan anomali', () => {
    const diminta = geser(menit(3));
    const hasil = batasiWatermark(diminta, SEKARANG);
    expect(hasil.nilai).toEqual(diminta);
    expect(hasil.lampauMs).toBe(0);
  });

  it('tepat di batas toleransi masih dilewatkan', () => {
    const hasil = batasiWatermark(geser(TOLERANSI_WATERMARK_MS), SEKARANG);
    expect(hasil.lampauMs).toBe(0);
  });

  /**
   * Skenario yang melahirkan pagar ini: pendaftaran pukul 06:15 dengan `jam_reg`
   * terketik 19:59:46. Tanpa pagar, watermark melompat ke 19:59:46 dan SELURUH
   * pendaftaran hari itu jatuh di bawahnya lalu dilewati -- diam, tanpa galat.
   */
  it('memotong waktu kejadian yang belum terjadi', () => {
    const salahKetik = geser(menit(13 * 60));
    const hasil = batasiWatermark(salahKetik, SEKARANG);
    expect(hasil.nilai).toEqual(SEKARANG);
    expect(hasil.lampauMs).toBeGreaterThan(0);
  });

  /**
   * Mendarat di SEKARANG, bukan di batas toleransi. Toleransi ada untuk
   * memutuskan "ini anomali atau bukan", bukan untuk jadi tempat kursornya
   * mendarat -- kalau tidak, tiap pemotongan menggeser kursor lima menit ke
   * masa depan dan baris yang tiba di sela itu terlewat.
   */
  it('mendarat di sekarang, bukan di sekarang + toleransi', () => {
    const hasil = batasiWatermark(geser(menit(600)), SEKARANG);
    expect(hasil.nilai.getTime()).toBe(SEKARANG.getTime());
    expect(hasil.nilai.getTime()).toBeLessThan(SEKARANG.getTime() + TOLERANSI_WATERMARK_MS);
  });

  it('lampauMs diukur dari batas toleransi, bukan dari sekarang', () => {
    const lewat = menit(30);
    const hasil = batasiWatermark(geser(TOLERANSI_WATERMARK_MS + lewat), SEKARANG);
    expect(hasil.lampauMs).toBe(lewat);
  });

  /**
   * Boleh MUNDUR, dan itu disengaja. Kursor yang terlanjur melampaui waktu
   * berjalan harus bisa disembuhkan pada siklus berikutnya; menahannya di tempat
   * berarti pagar ini cuma mencegah dan tidak pernah memulihkan, sehingga
   * kerusakannya tetap berumur sehari penuh. Membaca ulang baris yang sudah
   * diproses aman karena kunci idempoten menolaknya di mesin database.
   */
  it('menarik mundur kursor yang sudah terlanjur melampaui waktu berjalan', () => {
    const kursorRusak = geser(menit(11 * 60));
    const hasil = batasiWatermark(kursorRusak, SEKARANG);
    expect(hasil.nilai.getTime()).toBeLessThan(kursorRusak.getTime());
    expect(hasil.nilai).toEqual(SEKARANG);
  });

  it('tidak pernah mengembalikan objek Date yang sama dengan masukannya', () => {
    const sekarang = new Date(SEKARANG);
    const hasil = batasiWatermark(geser(menit(600)), sekarang);
    hasil.nilai.setFullYear(1999);
    expect(sekarang.getTime()).toBe(SEKARANG.getTime());
  });

  /**
   * Toleransi negatif tidak boleh MENURUNKAN batasnya di bawah sekarang --
   * itu akan memotong stempel waktu yang sah dan membuat kursornya mandek.
   */
  it('toleransi negatif diperlakukan sebagai nol', () => {
    const hasil = batasiWatermark(geser(menit(1)), SEKARANG, -menit(60));
    expect(hasil.nilai).toEqual(SEKARANG);
    expect(hasil.lampauMs).toBe(menit(1));
  });
});
