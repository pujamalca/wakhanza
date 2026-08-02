import { inboundHealth, AMBANG_SUNYI_MENIT } from './inboundHealth';

describe('inboundHealth', () => {
  const dasar = { last24h: 0, minutesSinceLast: null, autoReplyEnabled: true };

  it('tidak menilai apa pun saat balasan otomatis mati', () => {
    // Pencatatannya sendiri ikut mati, jadi nol tidak berarti apa-apa.
    // Tanpa cabang ini, setiap RS yang belum menyalakan balasan otomatis
    // melihat peringatan permanen -- dan peringatan permanen sama saja dengan
    // tidak ada peringatan.
    expect(inboundHealth({ ...dasar, autoReplyEnabled: false })).toBe('tidak-terpantau');
    expect(inboundHealth({ last24h: 50, minutesSinceLast: 1, autoReplyEnabled: false })).toBe('tidak-terpantau');
  });

  it('normal selama ada pesan masuk dalam 24 jam terakhir', () => {
    expect(inboundHealth({ ...dasar, last24h: 1, minutesSinceLast: 5 })).toBe('normal');
  });

  /**
   * Inilah keadaan yang tidak bisa dibuat lewat database: `auto_reply_log`
   * sengaja tanpa grant UPDATE, jadi baris nyata tak bisa disembunyikan
   * sementara untuk mensimulasikan "belum pernah". Diuji di sini justru karena
   * di sanalah bug LID akan terlihat lebih dulu -- sistem yang sejak awal tidak
   * pernah menerima satu pun pesan.
   */
  it('belum pernah menerima apa pun dihitung SUNYI, bukan aman', () => {
    expect(inboundHealth({ ...dasar, last24h: 0, minutesSinceLast: null })).toBe('sunyi');
  });

  it('sunyi tepat pada ambang, masih normal sedetik sebelumnya', () => {
    expect(inboundHealth({ ...dasar, minutesSinceLast: AMBANG_SUNYI_MENIT })).toBe('sunyi');
    expect(inboundHealth({ ...dasar, minutesSinceLast: AMBANG_SUNYI_MENIT - 1 })).toBe('normal');
  });

  it('malam hari yang sepi tidak dianggap gangguan', () => {
    // 10 jam tanpa pesan masuk: wajar sepenuhnya, tidak boleh memicu apa pun.
    expect(inboundHealth({ ...dasar, minutesSinceLast: 10 * 60 })).toBe('normal');
  });
});
