import {
  diagnosaKoneksi,
  tindakanKoneksi,
  AMBANG_MENAUTKAN_LAMA_DTK,
  AMBANG_PERCOBAAN_BERULANG,
  type DiagnosaInput,
} from './koneksiDiagnosa';

const dasar: DiagnosaInput = { status: 'authenticating', detikDiStatus: 0, percobaanMenautkan: 1 };

describe('diagnosaKoneksi', () => {
  it('sesi siap tidak pernah dilaporkan bermasalah', () => {
    expect(diagnosaKoneksi({ status: 'ready', detikDiStatus: 99999, percobaanMenautkan: 9 })).toBe('normal');
  });

  /**
   * `qr_pending` bukan macet melainkan sistem yang bekerja benar sambil menunggu
   * manusia -- bisa berjam-jam saat pemasangan pertama. Melaporkannya sebagai
   * gangguan akan membuat halaman berteriak justru saat petugas sedang berjalan
   * mengambil ponsel. Alasan yang sama membuat `sessionWatchdog()`
   * mengecualikannya dari batas waktu.
   */
  it('menunggu pindai QR tidak pernah dianggap gangguan, berapa lama pun', () => {
    expect(diagnosaKoneksi({ status: 'qr_pending', detikDiStatus: 6 * 3600, percobaanMenautkan: 8 })).toBe(
      'menunggu-pindai',
    );
  });

  it('penautan yang baru mulai belum dilaporkan apa-apa', () => {
    expect(diagnosaKoneksi({ ...dasar, detikDiStatus: 5 })).toBe('normal');
    expect(diagnosaKoneksi({ ...dasar, detikDiStatus: AMBANG_MENAUTKAN_LAMA_DTK - 1 })).toBe('normal');
  });

  it('melewati ambang durasi dilaporkan lama', () => {
    expect(diagnosaKoneksi({ ...dasar, detikDiStatus: AMBANG_MENAUTKAN_LAMA_DTK })).toBe('menautkan-lama');
  });

  /**
   * Inilah urutan yang gampang salah: percobaan yang berulang SELALU terlihat
   * "baru mulai" tepat sesudah restart, karena statusnya memang baru ditulis
   * ulang. Mendahulukan durasi membuat pola yang sudah satu jam berjalan tampil
   * sebagai penautan yang baru dimulai -- persis pada detik staf membuka
   * halamannya untuk mencari tahu kenapa.
   */
  it('pola berulang menang atas durasi yang baru direset restart', () => {
    expect(
      diagnosaKoneksi({ status: 'authenticating', detikDiStatus: 2, percobaanMenautkan: AMBANG_PERCOBAAN_BERULANG }),
    ).toBe('menautkan-berulang');
  });

  it('dua percobaan masih bisa kebetulan, tiga adalah pola', () => {
    expect(diagnosaKoneksi({ ...dasar, detikDiStatus: 2, percobaanMenautkan: 2 })).toBe('normal');
    expect(diagnosaKoneksi({ ...dasar, detikDiStatus: 2, percobaanMenautkan: 3 })).toBe('menautkan-berulang');
  });

  it('durasi tak diketahui tidak dipaksakan jadi kesimpulan', () => {
    expect(diagnosaKoneksi({ ...dasar, detikDiStatus: null, percobaanMenautkan: 1 })).toBe('normal');
  });

  it('ambang bicara jauh di bawah ambang bertindak', () => {
    // Batas worker menyerah 180 detik. Kalau ambang ini menyamainya, staf baru
    // diberi tahu pada detik worker menyerah -- tiga menit sesudah mereka mulai
    // bertanya-tanya.
    expect(AMBANG_MENAUTKAN_LAMA_DTK).toBeLessThan(180 / 2);
  });
});

describe('tindakanKoneksi', () => {
  /**
   * Inti keluhan 17 Agustus 2026: ketiga jalan keluar diam sekaligus, dan
   * halaman tidak mengatakan apa pun. Yang dipatok di sini bukan bunyi
   * kalimatnya melainkan KEPUTUSANNYA -- mana yang bisa ditekan, mana yang
   * tidak, dan apakah ada langkah yang diberikan.
   */
  it('penautan tersangkut: keluar sesi DIMATIKAN, karena ia menuntut halaman yang belum jadi', () => {
    for (const d of ['menautkan-lama', 'menautkan-berulang'] as const) {
      expect(tindakanKoneksi(d).keluarSesi.bisa).toBe(false);
      expect(tindakanKoneksi(d).keluarSesi.catatan).toBeTruthy();
    }
  });

  it('penautan tersangkut: sambung ulang TETAP bisa, tapi membawa peringatan akibatnya', () => {
    const t = tindakanKoneksi('menautkan-berulang');
    expect(t.sambungUlang.bisa).toBe(true);
    expect(t.sambungUlang.catatan).toMatch(/membatalkan/i);
  });

  /**
   * Tanpa langkah, halaman kembali jadi apa yang dikeluhkan: menyebutkan
   * masalahnya lalu berhenti di situ.
   */
  it('penautan tersangkut: memberi langkah yang berurutan, dan QR ulang yang TERAKHIR', () => {
    const l = tindakanKoneksi('menautkan-lama').langkah;
    expect(l.length).toBeGreaterThanOrEqual(3);
    expect(l[l.length - 1]).toMatch(/QR/i);
    // Langkah pertama tidak boleh menyuruh menekan apa pun -- itu justru yang
    // memperpanjang gangguannya.
    expect(l[0]).toMatch(/jangan tekan/i);
  });

  it('menunggu pindai: sambung ulang dimatikan, keluar sesi tetap boleh, tanpa langkah darurat', () => {
    const t = tindakanKoneksi('menunggu-pindai');
    expect(t.sambungUlang.bisa).toBe(false);
    expect(t.keluarSesi.bisa).toBe(true);
    expect(t.langkah).toHaveLength(0);
  });

  it('normal: tidak ada yang dimatikan dan tidak ada langkah yang ditawarkan', () => {
    const t = tindakanKoneksi('normal');
    expect(t.sambungUlang.bisa).toBe(true);
    expect(t.keluarSesi.bisa).toBe(true);
    expect(t.langkah).toHaveLength(0);
  });
});
