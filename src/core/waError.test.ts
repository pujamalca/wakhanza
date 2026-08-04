import { galatHalamanBelumSiap } from './waError';

describe('galatHalamanBelumSiap', () => {
  /**
   * Bunyi galat yang BENAR-BENAR tercatat di `send_log` pada kirim pertama
   * sesudah worker menyala -- `window.WWebJS` belum tersuntik ulang sesudah
   * halaman bernavigasi, sementara `Client.sendMessage()` memanggil
   * `window.WWebJS.getChat(...)` di dalam halaman.
   */
  it('mengenali window.WWebJS yang belum tersuntik ulang', () => {
    expect(galatHalamanBelumSiap(new Error("Cannot read properties of undefined (reading 'getChat')"))).toBe(true);
    expect(galatHalamanBelumSiap(new Error('WWebJS is not defined'))).toBe(true);
  });

  it('mengenali navigasi yang menghancurkan konteks evaluate', () => {
    expect(
      galatHalamanBelumSiap(new Error('Execution context was destroyed, most likely because of a navigation.')),
    ).toBe(true);
    expect(galatHalamanBelumSiap(new Error('Cannot find context with specified id'))).toBe(true);
  });

  it('mengenali Chromium yang sedang ditutup atau dimulai ulang', () => {
    expect(galatHalamanBelumSiap(new Error('Protocol error (Runtime.callFunctionOn): Target closed'))).toBe(true);
    expect(galatHalamanBelumSiap(new Error('Session closed. Most likely the page has been closed.'))).toBe(true);
  });

  /**
   * Sisi sebaliknya justru yang paling penting dijaga. Daftar yang terlalu
   * longgar membuat kegagalan SUNGGUHAN dicoba ulang tanpa batas tanpa pernah
   * muncul di panel "perlu ditinjau" -- baris yang tidak dikerjakan siapa pun
   * dan tidak ditampilkan di mana pun, persis kelas kegagalan yang sudah
   * dibayar di core/outboxStatus.ts.
   */
  it('TIDAK mengenali kegagalan kirim yang sungguhan', () => {
    expect(galatHalamanBelumSiap(new Error('nomor tidak terdaftar di WhatsApp'))).toBe(false);
    expect(galatHalamanBelumSiap(new Error('Evaluation failed: chat not found'))).toBe(false);
    expect(galatHalamanBelumSiap(new Error('lintasan lampiran ditolak: ../.env'))).toBe(false);
    expect(galatHalamanBelumSiap(new Error('ENOENT: no such file or directory'))).toBe(false);
  });

  it('tahan terhadap nilai yang bukan Error', () => {
    expect(galatHalamanBelumSiap('Target closed')).toBe(true);
    expect(galatHalamanBelumSiap('galat lain')).toBe(false);
    expect(galatHalamanBelumSiap(null)).toBe(false);
    expect(galatHalamanBelumSiap(undefined)).toBe(false);
    expect(galatHalamanBelumSiap('')).toBe(false);
  });
});
