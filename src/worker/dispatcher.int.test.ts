import { Op } from 'sequelize';
import { Outbox, SendLog } from '@/models';
import { db } from '@/db/wakhanza';

/**
 * Uji integrasi cabang "halaman WhatsApp belum siap" di `dispatchTick()`.
 *
 * Yang perlu dibuktikan di sini BUKAN pengklasifikasi galatnya -- itu fungsi
 * murni dan sudah diuji unit (`core/waError.test.ts`). Yang perlu dibuktikan
 * adalah bahwa dispatcher benar-benar MEMAKAINYA dan tidak menaikkan
 * `attempts`: sepuluh baris pembungkus yang, kalau salah, mengembalikan
 * kerugian aslinya secara utuh -- gangguan halaman beberapa detik menandai
 * notifikasi pasien `failed_permanent`, dan sejak itu ia hanya bergerak kalau
 * ada manusia menekan "Kirim ulang".
 *
 * Dibuat justru karena balapan aslinya TIDAK BISA DIPESAN: penyuntikan ulang
 * `window.WWebJS` terjadi kapan WhatsApp Web memutuskan bernavigasi. Menunggu
 * kebetulan itu berarti cabangnya tidak pernah terbukti, dan "terlalu kecil
 * untuk salah" adalah persis kalimat yang mendahului bug `@lid` maupun bug
 * `_serialized` di proyek ini.
 *
 * `wa-client` dipalsukan seluruhnya -- ia menarik whatsapp-web.js dan Chromium
 * sungguhan. Database `wakhanza`-nya tetap SUNGGUHAN, sesuai alasan di
 * `jest.integration.config.js`: yang diuji termasuk apa yang benar-benar
 * tersimpan di kolomnya.
 */

const TANDA = 'INTTEST-DISPATCH';

const kirim = jest.fn<Promise<void>, [string, string, unknown]>();

jest.mock('./wa-client', () => ({
  isWaReady: async () => true,
  tungguHalamanSiap: async () => true,
  isRegisteredOnWhatsApp: async () => true,
  sendWhatsAppMessage: (chatId: string, body: string, lampiran?: unknown) => kirim(chatId, body, lampiran),
}));

// Diimpor SESUDAH jest.mock supaya dispatcher menerima tiruan di atas.
const { dispatchTick } = require('./dispatcher') as typeof import('./dispatcher');

async function buatBarisMenunggu(suffix: string): Promise<Outbox> {
  return Outbox.create({
    idempotencyKey: `${TANDA}-${suffix}-${Date.now()}`,
    triggerCode: 'FARMASI_UJI',
    noRkmMedis: null,
    phoneE164: '628000000009',
    chatId: null,
    body: 'baris uji dispatcher',
    status: 'pending',
    attempts: 0,
    eventAt: new Date(),
    scheduledAt: new Date(),
  });
}

afterAll(async () => {
  const baris = await Outbox.findAll({ where: { idempotencyKey: { [Op.like]: `${TANDA}%` } }, attributes: ['id'] });
  const ids = baris.map((b) => b.id);
  if (ids.length > 0) await SendLog.destroy({ where: { outboxId: ids } });
  await Outbox.destroy({ where: { idempotencyKey: { [Op.like]: `${TANDA}%` } } });
  await db.close();
});

describe('dispatchTick: halaman WhatsApp belum siap', () => {
  it('TIDAK menghitungnya sebagai percobaan, dan tidak menulis send_log', async () => {
    const row = await buatBarisMenunggu('belum-siap');
    // Bunyi galat yang benar-benar tercatat saat kirim pertama sesudah worker
    // menyala -- `window.WWebJS` belum tersuntik ulang.
    kirim.mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'getChat')"));

    await dispatchTick();
    await row.reload();

    expect(row.status).toBe('pending');
    // Inti perbaikannya. Sebelum ini nilainya 1, dan tiga kali seperti itu
    // membuat baris berakhir `failed_permanent` tanpa pernah menyentuh WhatsApp.
    expect(row.attempts).toBe(0);
    expect(row.lastError).toContain('halaman WhatsApp belum siap');
    // Baris log percobaan yang tidak pernah terjadi hanya membuat riwayat
    // pengiriman berbohong.
    expect(await SendLog.count({ where: { outboxId: row.id } })).toBe(0);
  });

  it('dijadwalkan ulang beberapa detik, bukan backoff menit-menitan', async () => {
    const row = await buatBarisMenunggu('jadwal');
    kirim.mockRejectedValueOnce(new Error('Execution context was destroyed'));

    const sebelum = Date.now();
    await dispatchTick();
    await row.reload();

    // Yang ditunggu penyuntikan ulang (biasanya di bawah satu detik), bukan
    // gangguan jaringan -- backoff 1/5/25 menit akan menahan pesan yang
    // sebenarnya bisa terkirim sekarang juga.
    const jeda = row.scheduledAt.getTime() - sebelum;
    expect(jeda).toBeGreaterThan(0);
    expect(jeda).toBeLessThanOrEqual(15_000);
  });

  /**
   * Sisi sebaliknya, dan justru ini yang menjaga perbaikannya tidak berubah
   * jadi kerugian: kegagalan SUNGGUHAN harus tetap menghabiskan percobaan.
   * Kalau tidak, baris yang benar-benar tidak bisa terkirim akan dicoba ulang
   * selamanya tanpa pernah muncul di panel "perlu ditinjau".
   */
  it('kegagalan kirim yang sungguhan TETAP menghitung percobaan dan menulis send_log', async () => {
    const row = await buatBarisMenunggu('gagal-nyata');
    kirim.mockRejectedValueOnce(new Error('Evaluation failed: chat not found'));

    await dispatchTick();
    await row.reload();

    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(await SendLog.count({ where: { outboxId: row.id, outcome: 'error' } })).toBe(1);
  });

  it('pengiriman yang berhasil tetap berjalan seperti biasa', async () => {
    const row = await buatBarisMenunggu('sukses');
    kirim.mockResolvedValueOnce(undefined);

    await dispatchTick();
    await row.reload();

    expect(row.status).toBe('sent');
    expect(row.attempts).toBe(1);
    expect(await SendLog.count({ where: { outboxId: row.id, outcome: 'sent' } })).toBe(1);
  });
});
