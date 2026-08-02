import {
  OUTBOX_STATUSES,
  ACTIVE_OUTBOX_STATUSES,
  TERMINAL_OUTBOX_STATUSES,
  isTerminalOutboxStatus,
} from './outboxStatus';

describe('pembagian status outbox', () => {
  /**
   * Uji terpenting di berkas ini, dan alasannya bukan kerapian.
   *
   * Status baru yang ditambahkan ke ENUM tanpa didaftarkan ke salah satu sisi
   * akan jatuh ke celah paling mahal di proyek ini: tidak diambil dispatcher
   * (karena bukan `pending`), tidak dipangkas cleanup (karena bukan terminal),
   * dan tidak muncul di daftar "perlu ditinjau". Baris seperti itu diam
   * selamanya tanpa satu pun pesan error. Uji ini memaksa keputusannya diambil
   * sadar-sadar saat status barunya dibuat, bukan ditemukan berbulan-bulan
   * kemudian lewat tabel yang menggemuk tanpa sebab.
   */
  it('setiap status persis masuk satu golongan: aktif atau terminal', () => {
    const gabungan = [...ACTIVE_OUTBOX_STATUSES, ...TERMINAL_OUTBOX_STATUSES];
    expect([...gabungan].sort()).toEqual([...OUTBOX_STATUSES].sort());
    expect(new Set(gabungan).size).toBe(gabungan.length);
  });

  it('pending dan sending tidak terminal -- keduanya masih dipegang dispatcher', () => {
    expect(isTerminalOutboxStatus('pending')).toBe(false);
    expect(isTerminalOutboxStatus('sending')).toBe(false);
  });

  /**
   * `failed` ditulis dispatcher saat percobaan ulang HABIS, dan tidak ada kode
   * yang mengambilnya kembali -- label lamanya ("masih akan dicoba ulang
   * otomatis") keliru dan sempat membuatnya luput dari pemangkasan sekaligus
   * dari daftar "perlu ditinjau".
   */
  it('failed terminal, bukan "gagal sementara"', () => {
    expect(isTerminalOutboxStatus('failed')).toBe(true);
  });

  it('semua bentuk lewat/dilewati ikut terminal', () => {
    expect(isTerminalOutboxStatus('skipped_no_contact')).toBe(true);
    expect(isTerminalOutboxStatus('skipped_opt_out')).toBe(true);
    expect(isTerminalOutboxStatus('expired')).toBe(true);
    expect(isTerminalOutboxStatus('failed_permanent')).toBe(true);
    expect(isTerminalOutboxStatus('sent')).toBe(true);
  });

  it('status yang tidak dikenal tidak dianggap terminal', () => {
    // Konsisten dengan respectsOptOut(): default yang aman adalah "jangan
    // sentuh", karena yang dilakukan pemanggilnya terhadap status terminal
    // adalah MENGHAPUS barisnya.
    expect(isTerminalOutboxStatus('entah_apa')).toBe(false);
    expect(isTerminalOutboxStatus('')).toBe(false);
  });
});
