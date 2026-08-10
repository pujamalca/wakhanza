import { jelaskanKegagalanWebhook, jelaskanKegagalanJaringan, PANJANG_CUPLIKAN_MAKS } from './alertError';

describe('jelaskanKegagalanWebhook', () => {
  /**
   * Kasus yang melahirkan modul ini: URL bot Telegram telanjang, tanpa method.
   * Kalimatnya WAJIB menyebut "/sendMessage" -- itu satu-satunya isi yang
   * mengubah pesan galat menjadi tindakan.
   */
  it('404 menyuruh memeriksa URL dan menyebut method yang hilang', () => {
    const pesan = jelaskanKegagalanWebhook(404);
    expect(pesan).toContain('HTTP 404');
    expect(pesan).toContain('/sendMessage');
  });

  it('400 menunjuk chat_id, bukan URL', () => {
    const pesan = jelaskanKegagalanWebhook(400);
    expect(pesan).toContain('chat_id');
    expect(pesan).not.toContain('/sendMessage');
  });

  it.each([401, 403])('%i menunjuk kredensial', (status) => {
    expect(jelaskanKegagalanWebhook(status)).toMatch(/token|kredensial/i);
  });

  it('429 menyarankan menaikkan jeda, bukan mengubah URL', () => {
    expect(jelaskanKegagalanWebhook(429)).toMatch(/jeda/i);
  });

  /**
   * 5xx harus MEMBEBASKAN setelan dari kecurigaan. Tanpa itu, gangguan sesaat
   * di sisi penerima menghabiskan sore orang untuk membetulkan URL yang sudah
   * benar sejak awal.
   */
  it.each([500, 502, 503])('%i menyatakan masalahnya di penerima', (status) => {
    const pesan = jelaskanKegagalanWebhook(status);
    expect(pesan).toMatch(/penerima/i);
    expect(pesan).not.toContain('chat_id');
  });

  it('status di luar yang dikenali tetap menyebut angkanya', () => {
    expect(jelaskanKegagalanWebhook(418)).toContain('HTTP 418');
  });

  /**
   * Jawaban penerima sering lebih menjawab daripada kalimat kita sendiri --
   * Telegram membalas "chat not found", yang membedakan chat_id salah dari
   * chat_id kosong. Pembedaan itu mustahil diturunkan dari status 400 saja.
   */
  it('menyertakan jawaban penerima apa adanya', () => {
    const pesan = jelaskanKegagalanWebhook(400, '{"ok":false,"description":"Bad Request: chat not found"}');
    expect(pesan).toContain('chat not found');
  });

  it('jawaban kosong atau spasi belaka tidak meninggalkan label menggantung', () => {
    for (const jawaban of ['', '   ', '\n\n']) {
      expect(jelaskanKegagalanWebhook(400, jawaban)).not.toContain('Jawaban penerima:');
    }
  });

  /**
   * Teks pihak ketiga tak terbatas panjangnya -- proxy yang salah setel
   * menjawab satu halaman HTML utuh, dan panel hasil uji bukan tempatnya.
   */
  it('memotong jawaban yang kelewat panjang', () => {
    const panjang = 'x'.repeat(PANJANG_CUPLIKAN_MAKS * 3);
    const pesan = jelaskanKegagalanWebhook(500, panjang);
    expect(pesan).toContain('...');
    expect(pesan).not.toContain(panjang);
    expect(pesan.length).toBeLessThan(PANJANG_CUPLIKAN_MAKS + 250);
  });

  /**
   * Token bot ada DI DALAM URL, dan sebagian server memuntahkan URL permintaan
   * ke halaman galatnya. Cuplikan ini berakhir di berkas log, yang bertahan
   * jauh lebih lama daripada satu layar hasil uji.
   */
  it('menyensor token bot yang ikut terbawa jawaban penerima', () => {
    const bocor = 'Cannot POST https://api.telegram.org/bot123456789:AAF9jUGkMkZXH7eGkWA4PX80mSp68zSbus8/sendMessage';
    const pesan = jelaskanKegagalanWebhook(404, bocor);
    expect(pesan).not.toContain('AAF9jUGkMkZXH7eGkWA4PX80mSp68zSbus8');
    expect(pesan).toContain('disensor');
  });

  /**
   * Penyensoran WAJIB mendahului pemotongan -- kalau tidak, potongan bisa jatuh
   * di tengah token dan meloloskan separuhnya.
   */
  it('menyensor token yang letaknya persis di garis potong', () => {
    // Tokennya sengaja dimulai TEPAT sebelum batas, jadi pemotongan membelahnya
    // di tengah. Kalau potong dulu baru sensor, yang tersisa `bot987654321:RAHASI`
    // -- separuh rahasia, tidak lagi cocok dengan polanya, dan lolos.
    const bocor = `${'z'.repeat(PANJANG_CUPLIKAN_MAKS - 20)}bot987654321:RAHASIA_SANGAT_PANJANG_XYZ`;
    expect(jelaskanKegagalanWebhook(500, bocor)).not.toContain('RAHASI');
  });

  it('meratakan jawaban multi-baris jadi satu baris', () => {
    const pesan = jelaskanKegagalanWebhook(400, 'baris satu\nbaris dua\r\n\tbaris tiga');
    expect(pesan).not.toMatch(/[\n\r\t]/);
    expect(pesan).toContain('baris satu baris dua baris tiga');
  });
});

describe('jelaskanKegagalanJaringan', () => {
  /**
   * Dibedakan dari kegagalan ber-status karena TINDAKANNYA berbeda: yang ini
   * soal jaringan, dan membetulkan URL tidak akan mengubah apa pun. Karena itu
   * ia tidak boleh menyeret staf ke setelan URL/chat_id.
   */
  it('menunjuk jaringan, bukan isi URL', () => {
    const pesan = jelaskanKegagalanJaringan('');
    expect(pesan).toMatch(/firewall|domain|batas/i);
    expect(pesan).not.toContain('chat_id');
    expect(pesan).not.toContain('/sendMessage');
  });

  it('menyertakan galat aslinya bila ada, dan memotongnya', () => {
    expect(jelaskanKegagalanJaringan('getaddrinfo ENOTFOUND api.telegram.org')).toContain('ENOTFOUND');
    expect(jelaskanKegagalanJaringan('y'.repeat(PANJANG_CUPLIKAN_MAKS * 2))).toContain('...');
  });
});
