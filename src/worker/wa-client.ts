import { Client, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { WaSession, OptOut, Outbox } from '@/models';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * F5.5 / ARCHITECTURE §8: worker tetap memasang pendengar khusus kata kunci
 * berhenti meski versi 1 tidak melayani percakapan. Pesan masuk LAIN
 * diabaikan tanpa balasan -- membalas otomatis untuk hal medis butuh
 * tanggung jawab klinis di luar cakupan perangkat lunak ini.
 */
const STOP_RE = /^\s*(stop|berhenti|unsubscribe)\s*$/i;
const CONFIRMATION_TEXT =
  'Anda telah berhenti menerima notifikasi dari kami. Balas kembali kapan saja jika ingin berlangganan lagi lewat petugas pendaftaran.';

let client: Client | null = null;

export function getClient(): Client {
  if (!client) throw new Error('WhatsApp client belum diinisialisasi — panggil initWaClient() dulu');
  return client;
}

export async function isWaReady(): Promise<boolean> {
  const row = await WaSession.findByPk(1);
  return row?.status === 'ready';
}

/**
 * ARCHITECTURE §9.6 / TECH_STACK "Pengerasan Puppeteer": TIDAK ADA
 * --no-sandbox. Itu penanganan darurat kontainer Linux; di Windows sandbox
 * Chromium bekerja tanpa perlu diapa-apakan, dan mematikannya membuang batas
 * pengaman pada server yang satu jaringan dengan basis data rekam medis.
 */
export async function initWaClient(): Promise<Client> {
  const sessionPath = process.env.WA_SESSION_PATH ?? './.wwebjs_auth';

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      args: ['--disable-dev-shm-usage'],
    },
  });

  client.on('qr', (qr) => {
    logger.info('QR baru terbit');
    QRCode.toDataURL(qr)
      .then((dataUrl) => WaSession.upsert({ id: 1, status: 'qr_pending', qrData: dataUrl, qrIssuedAt: new Date() }))
      .catch((err) => logger.error(safeError(err), 'gagal membuat gambar QR'));
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp terautentikasi, menunggu ready');
    WaSession.upsert({ id: 1, status: 'authenticating' }).catch((err) =>
      logger.error(safeError(err), 'gagal update wa_session (authenticated)'),
    );
  });

  client.on('ready', () => {
    const phoneNumber = client?.info?.wid?.user ?? null;
    logger.info({ phoneNumber }, 'WhatsApp siap');
    WaSession.upsert({
      id: 1,
      status: 'ready',
      qrData: null,
      qrIssuedAt: null,
      phoneNumber,
      heartbeatAt: new Date(),
      lastError: null,
    }).catch((err) => logger.error(safeError(err), 'gagal update wa_session (ready)'));
  });

  client.on('disconnected', (reason) => {
    logger.warn({ reason: String(reason) }, 'WhatsApp terputus');
    WaSession.upsert({ id: 1, status: 'disconnected', lastError: String(reason) }).catch((err) =>
      logger.error(safeError(err), 'gagal update wa_session (disconnected)'),
    );
  });

  client.on('auth_failure', (message) => {
    logger.error({ message }, 'autentikasi WhatsApp gagal');
    WaSession.upsert({ id: 1, status: 'failed', lastError: message }).catch((err) =>
      logger.error(safeError(err), 'gagal update wa_session (auth_failure)'),
    );
  });

  client.on('message', async (message) => {
    if (message.fromMe) return;
    if (!message.from.endsWith('@c.us')) return; // hanya obrolan perorangan, bukan grup
    if (!STOP_RE.test(message.body)) return;

    const phoneE164 = message.from.replace('@c.us', '');
    try {
      await OptOut.upsert({ phoneE164, source: 'reply' });
      // §9.8: outbox yang masih menunggu ke nomor ini langsung dilewati --
      // jangan tunggu pemeriksaan kedua di dispatcher untuk baris yang
      // sudah nyata-nyata diketahui harus berhenti sekarang.
      await Outbox.update({ status: 'skipped_opt_out' }, { where: { phoneE164, status: 'pending' } });
      await message.reply(CONFIRMATION_TEXT);
      logger.info({ phone: maskPhone(phoneE164) }, 'permintaan berhenti berlangganan diterima');
    } catch (err) {
      logger.error({ phone: maskPhone(phoneE164), ...safeError(err) }, 'gagal memproses permintaan berhenti berlangganan');
    }
  });

  await client.initialize();
  return client;
}

/** ARCHITECTURE §10 / Fase 4: pemeriksaan kesehatan -- Chromium yang menggantung tidak terlihat dari status 'ready' semata. */
export async function checkHealth(timeoutMs = 10_000): Promise<boolean> {
  const c = getClient();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
  try {
    await Promise.race([c.getState(), timeout]);
    return true;
  } catch (err) {
    logger.error(safeError(err), 'pemeriksaan kesehatan client WhatsApp gagal -- Chromium mungkin menggantung');
    return false;
  }
}

export async function sendWhatsAppMessage(phoneE164: string, body: string): Promise<void> {
  const c = getClient();
  await c.sendMessage(`${phoneE164}@c.us`, body);
}

/** F5.4: bedakan nomor tak terdaftar (permanen) dari kegagalan sementara SEBELUM mencoba kirim. */
export async function isRegisteredOnWhatsApp(phoneE164: string): Promise<boolean> {
  const c = getClient();
  const id = await c.getNumberId(phoneE164);
  return id !== null;
}

export async function updateHeartbeat(): Promise<void> {
  await WaSession.update({ heartbeatAt: new Date() }, { where: { id: 1 } });
}
