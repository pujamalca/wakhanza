import { putusanWatchdog, STATUS_MENUNGGU_MANUSIA, type KeadaanWatchdog } from './watchdog';

const BATAS_INIT = 180_000;
const BATAS_SIAP = 900_000;

function keadaan(p: Partial<KeadaanWatchdog> = {}): KeadaanWatchdog {
  return {
    initSelesai: true,
    msSejakInitMulai: 0,
    batasInitMs: BATAS_INIT,
    status: 'ready',
    msSejakSiapTerakhir: 0,
    batasTidakSiapMs: BATAS_SIAP,
    ...p,
  };
}

describe('fase MENAUTKAN -- celah yang tidak dijaga siapa pun sampai 14 Agustus 2026', () => {
  it('diam selama penautan masih di dalam batas', () => {
    const p = putusanWatchdog(keadaan({ initSelesai: false, msSejakInitMulai: 60_000, status: null }));
    expect(p).toEqual({ aksi: 'diam', fase: 'menautkan', diamMs: 60_000, setelUlangJamSiap: true });
  });

  /**
   * Inti perbaikannya: keluar SEBELUM `protocolTimeout` (300 dtk) sempat
   * membunuhnya, supaya matinya lewat `shutdown()` yang menutup Chromium rapi.
   * Dibiarkan sampai protocolTimeout, ia jatuh ke `main().catch()` ->
   * `process.exit(1)` dan state sesi ditinggalkan setengah tertulis.
   */
  it('keluar begitu penautan melewati batas', () => {
    const p = putusanWatchdog(keadaan({ initSelesai: false, msSejakInitMulai: BATAS_INIT, status: null }));
    expect(p).toEqual({ aksi: 'keluar', fase: 'menautkan', diamMs: BATAS_INIT });
  });

  it('batas penautan WAJIB lebih pendek daripada protocolTimeout 300 detik', () => {
    expect(BATAS_INIT).toBeLessThan(300_000);
  });

  /**
   * Yang paling gampang salah kalau cabang init tidak didahulukan: selama
   * penautan, `wa_session.status` masih milik proses SEBELUMNYA. Status `ready`
   * yang basi akan mengirim watchdog ke pemeriksaan kesehatan atas klien yang
   * belum jadi -- hasilnya bukan "sehat" atau "sakit" melainkan galat yang tidak
   * ada hubungannya dengan pertanyaannya.
   */
  it('TIDAK memeriksa kesehatan walau status basi berbunyi ready', () => {
    const p = putusanWatchdog(keadaan({ initSelesai: false, msSejakInitMulai: 1_000, status: 'ready' }));
    expect(p.aksi).toBe('diam');
  });

  /**
   * Dan sebaliknya: status basi `authenticating` tidak boleh membuat jam 15
   * menit berjalan seolah sesi sudah tertaut padahal belum satu detik pun.
   * `setelUlangJamSiap` yang menjaganya.
   */
  it('menyetel ulang jam kesiapan sepanjang penautan', () => {
    const p = putusanWatchdog(
      keadaan({ initSelesai: false, msSejakInitMulai: 1_000, status: 'authenticating', msSejakSiapTerakhir: BATAS_SIAP * 2 }),
    );
    expect(p).toMatchObject({ aksi: 'diam', setelUlangJamSiap: true });
  });
});

describe('fase sesudah penautan -- perilaku lama, tidak boleh bergeser', () => {
  it('status ready menghasilkan pemeriksaan kesehatan', () => {
    expect(putusanWatchdog(keadaan({ status: 'ready' }))).toEqual({ aksi: 'periksa-kesehatan' });
  });

  /**
   * `qr_pending` bukan macet melainkan sistem yang benar sedang menunggu manusia
   * memindai QR -- bisa berjam-jam saat pemasangan pertama, dan keluar di
   * tengahnya menerbitkan QR baru sehingga kode yang sedang dipindai petugas
   * jadi kedaluwarsa.
   */
  it('qr_pending tidak pernah kena batas waktu, seberapa lama pun', () => {
    const p = putusanWatchdog(keadaan({ status: 'qr_pending', msSejakSiapTerakhir: BATAS_SIAP * 10 }));
    expect(p).toMatchObject({ aksi: 'diam', fase: 'menunggu-manusia', setelUlangJamSiap: true });
  });

  it('diam selama masih di dalam batas, tanpa menyetel ulang jamnya', () => {
    const p = putusanWatchdog(keadaan({ status: 'authenticating', msSejakSiapTerakhir: 300_000 }));
    expect(p).toEqual({ aksi: 'diam', fase: 'belum-siap', diamMs: 300_000, setelUlangJamSiap: false });
  });

  it('keluar begitu sesi tidak siap melewati batas', () => {
    const p = putusanWatchdog(keadaan({ status: 'authenticating', msSejakSiapTerakhir: BATAS_SIAP }));
    expect(p).toEqual({ aksi: 'keluar', fase: 'belum-siap', diamMs: BATAS_SIAP });
  });

  /** Baris `wa_session` yang belum pernah ada bukan alasan menganggapnya sehat. */
  it('status null diperlakukan sebagai belum siap, bukan sebagai ready', () => {
    expect(putusanWatchdog(keadaan({ status: null })).aksi).toBe('diam');
    expect(putusanWatchdog(keadaan({ status: null, msSejakSiapTerakhir: BATAS_SIAP })).aksi).toBe('keluar');
  });
});

describe('daftar status yang menunggu manusia', () => {
  it('hanya qr_pending, dan itu keputusan bukan kebetulan', () => {
    expect([...STATUS_MENUNGGU_MANUSIA]).toEqual(['qr_pending']);
  });

  /**
   * `authenticating` TIDAK boleh masuk daftar ini. Ia terlihat seperti "sedang
   * berproses" dan justru itu jebakannya: gangguan yang berlangsung 14 jam
   * seluruhnya terjadi di status itu, dan mengecualikannya dari batas waktu
   * berarti mengembalikan keadaan sebelum watchdog ada.
   */
  it('authenticating tidak dikecualikan dari batas waktu', () => {
    expect(STATUS_MENUNGGU_MANUSIA.has('authenticating')).toBe(false);
  });
});
