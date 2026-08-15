import { ackHealth, AMBANG_BUNTU_MENIT, JENDELA_PANTAU_MENIT, MIN_JATUH_TEMPO } from './ackHealth';

describe('ackHealth', () => {
  const dasar = { jatuhTempo: 0, berkabar: 0, sesiReady: true };

  it('tidak menilai apa pun saat sesi belum siap', () => {
    // Sesi yang belum tertaut sudah punya penjaganya sendiri
    // (`sessionWatchdog`); mengalarmkannya dua kali cuma menggandakan
    // kebisingan. Berlaku bahkan saat angkanya tampak paling buruk.
    expect(ackHealth({ jatuhTempo: 99, berkabar: 0, sesiReady: false })).toBe('tidak-terpantau');
  });

  it('sepi selama belum cukup pesan jatuh tempo', () => {
    expect(ackHealth({ ...dasar, jatuhTempo: 0 })).toBe('sepi');
    expect(ackHealth({ ...dasar, jatuhTempo: MIN_JATUH_TEMPO - 1 })).toBe('sepi');
  });

  /**
   * Satu pesan tersangkut bisa kebetulan (ponsel penerima mati, nomor tidak
   * aktif). Yang membedakan gangguan sungguhan adalah TIDAK SATU PUN sampai.
   */
  it('satu pesan tersangkut sendirian tidak cukup untuk menuduh', () => {
    expect(ackHealth({ ...dasar, jatuhTempo: 1, berkabar: 0 })).toBe('sepi');
  });

  it('satu kabar saja sudah membantah pipa mati', () => {
    // Sengaja: yang dijaga fungsi ini satu mode kegagalan, yaitu pipa yang mati
    // SELURUHNYA. Sembilan tersangkut dari sepuluh punya sebab per-penerima
    // yang tidak bisa dibedakan dari sini, dan tidak dipulihkan oleh tindakan
    // apa pun yang disarankan peringatannya.
    expect(ackHealth({ ...dasar, jatuhTempo: 10, berkabar: 1 })).toBe('normal');
    expect(ackHealth({ ...dasar, jatuhTempo: 2, berkabar: 2 })).toBe('normal');
  });

  /**
   * Replika insiden 15 Agustus 2026, angkanya apa adanya.
   *
   * Pukul 07:52 sudah ada dua pesan jatuh tempo tanpa satu pun kabar (terkirim
   * 07:37 dan 07:41), sementara `wa_session` tetap berbunyi `ready` dan setiap
   * indikator lain hijau. Inilah satu-satunya kombinasi yang membedakannya dari
   * pagi yang normal.
   */
  it('dua jatuh tempo tanpa satu pun kabar = BUNTU (replika insiden)', () => {
    expect(ackHealth({ jatuhTempo: 2, berkabar: 0, sesiReady: true })).toBe('buntu');
    expect(ackHealth({ jatuhTempo: 3, berkabar: 0, sesiReady: true })).toBe('buntu');
  });

  it('ambangnya masuk akal terhadap yang terukur', () => {
    // Ack tingkat 1 paling lambat terukur 44 detik; ambangnya wajib jauh di
    // atas itu supaya jaringan yang berkedip tidak jadi peringatan palsu.
    expect(AMBANG_BUNTU_MENIT * 60).toBeGreaterThan(44 * 5);
    // Jendelanya wajib lebih lebar dari ambangnya, kalau tidak tidak akan
    // pernah ada satu pun pesan yang jatuh tempo DI DALAM jendela -- detektor
    // yang diam selamanya, tanpa satu pun galat.
    expect(JENDELA_PANTAU_MENIT).toBeGreaterThan(AMBANG_BUNTU_MENIT);
  });
});
