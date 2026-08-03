import { WaSession, WaGroup } from '@/models';
import { getClient } from './wa-client';
import { logger, safeError } from '@/lib/logger';

/**
 * Membaca daftar grup yang diikuti nomor rumah sakit lalu menuliskannya ke
 * `wa_group`, supaya staf bisa MEMILIH grup di dashboard alih-alih mengetik
 * JID-nya.
 *
 * Kenapa ini perlu ada sama sekali: JID grup tidak bisa dilihat dari aplikasi
 * WhatsApp. Yang bisa disalin staf hanyalah tautan undangan
 * (`chat.whatsapp.com/...`), yang sama sekali bukan JID dan tidak bisa
 * dikonversi menjadi JID. Tanpa daftar ini, satu-satunya jalan memasang tujuan
 * grup adalah menebak -- dan kode grup yang salah GAGAL DIAM-DIAM: pesannya
 * masuk antrean, dikirim, ditolak WhatsApp, dan grupnya tidak pernah menerima
 * apa pun.
 *
 * Grup yang sudah tidak diikuti lagi DIHAPUS dari tabel, bukan dibiarkan
 * menumpuk: daftar pilihan yang memuat grup yang nomor RS-nya sudah keluar
 * adalah cara paling rapi memasang tujuan yang tidak akan pernah menerima apa
 * pun. Yang TIDAK ikut terhapus adalah `farmasi_target` -- tujuan yang sudah
 * dipasang tidak boleh lenyap karena satu sinkronisasi kebetulan gagal.
 */
interface GrupTerbaca {
  chatId: string;
  nama: string;
  jumlah: number | null;
}

/**
 * SENGAJA TIDAK memakai `client.getChats()`, dan ini bukan selera.
 *
 * `getChats()` memetakan SETIAP chat lewat `getChatModel()` di dalam satu
 * `Promise.all`. Dua akibatnya, dan yang pertama benar-benar terjadi di mesin
 * ini pada percobaan pertama:
 *
 *   1. Satu chat yang gagal diserialisasi menjatuhkan SELURUH daftar. Galat
 *      yang muncul cuma `"r"` -- nama variabel dari kode WhatsApp yang sudah
 *      diminifikasi, tanpa satu pun petunjuk chat mana yang bermasalah.
 *   2. Ia menyerialisasi ribuan percakapan pasien padahal yang dibutuhkan
 *      hanyalah grup: id, nama, jumlah anggota.
 *
 * Yang dipakai sekarang membaca koleksi yang SAMA (`WAWebCollections.Chat`,
 * persis yang dipakai `getChats()` di baliknya -- jadi ini bukan
 * ketergantungan baru pada internal WhatsApp, melainkan yang lama dikurangi
 * satu lapis), menyaring ke `@g.us` lebih dulu, dan membungkus tiap chat dalam
 * try/catch sendiri sehingga satu baris rusak dilewati alih-alih menjatuhkan
 * sisanya.
 */
async function bacaGrupDariSesi(): Promise<GrupTerbaca[]> {
  const page = (getClient() as unknown as { pupPage?: { evaluate: <T>(fn: () => T) => Promise<T> } }).pupPage;
  if (!page) throw new Error('halaman WhatsApp belum siap');

  return page.evaluate<GrupTerbaca[]>(() => {
    const hasil: GrupTerbaca[] = [];
    const w = window as unknown as { require: (m: string) => { Chat: { getModelsArray: () => unknown[] } } };
    const chats = w.require('WAWebCollections').Chat.getModelsArray();

    for (const chat of chats) {
      try {
        const c = chat as {
          id?: { _serialized?: string; server?: string; user?: string };
          name?: string;
          formattedTitle?: string;
          groupMetadata?: { participants?: { length?: number; getModelsArray?: () => unknown[] } };
        };
        if (c.id?.server !== 'g.us') continue;
        const chatId = c.id._serialized ?? `${c.id.user}@g.us`;

        // Peserta kadang larik biasa, kadang koleksi Backbone -- keduanya
        // ditangani, dan kegagalan membacanya tidak boleh membuang grupnya.
        let jumlah: number | null = null;
        try {
          const p = c.groupMetadata?.participants;
          jumlah = typeof p?.length === 'number' ? p.length : (p?.getModelsArray?.().length ?? null);
        } catch {
          jumlah = null;
        }

        hasil.push({ chatId, nama: c.formattedTitle ?? c.name ?? '(tanpa nama)', jumlah });
      } catch {
        // Satu chat rusak dilewati. Inilah bedanya dengan Promise.all milik
        // getChats(), yang membuang seluruh daftar karena satu baris.
      }
    }
    return hasil;
  });
}

async function syncGroups(): Promise<void> {
  const grup = await bacaGrupDariSesi();

  const terbaca: string[] = [];
  for (const g of grup) {
    await WaGroup.upsert({
      chatId: g.chatId,
      nama: (g.nama || '(tanpa nama)').slice(0, 160),
      jumlahPeserta: g.jumlah,
      syncedAt: new Date(),
    });
    terbaca.push(g.chatId);
  }

  const semua = await WaGroup.findAll({ attributes: ['chatId'] });
  const basi = semua.map((g) => g.chatId).filter((id) => !terbaca.includes(id));
  if (basi.length > 0) {
    await WaGroup.destroy({ where: { chatId: basi } });
  }

  // Nama grup TIDAK dicatat -- sebagian memuat nama pasien atau nama dokter,
  // dan log dibaca admin IT serta vendor (§9.7).
  logger.info({ jumlah: terbaca.length, dihapus: basi.length }, 'daftar grup WhatsApp disegarkan');
}

/**
 * ARCHITECTURE §1: dashboard menitip perintah lewat wa_session.command;
 * worker membacanya lalu mengosongkannya. Command dikonsumsi (di-set balik
 * ke 'none') SEBELUM dieksekusi supaya perintah yang gagal tidak diulang
 * tanpa henti tiap siklus.
 */
export async function processSessionCommand(): Promise<void> {
  const row = await WaSession.findByPk(1);
  if (!row || row.command === 'none') return;

  const command = row.command;
  await WaSession.update({ command: 'none' }, { where: { id: 1 } });

  try {
    const client = getClient();
    if (command === 'logout') {
      logger.warn('perintah logout diterima dari dashboard, memutus sesi WhatsApp');
      await client.logout();
      await WaSession.update(
        { status: 'qr_pending', phoneNumber: null, qrData: null, lastError: null },
        { where: { id: 1 } },
      );
      await client.initialize();
    } else if (command === 'reconnect') {
      logger.info('perintah sambung ulang diterima dari dashboard');
      await client.resetState();
    } else if (command === 'sync_groups') {
      logger.info('perintah muat daftar grup diterima dari dashboard');
      await syncGroups();
    }
  } catch (err) {
    logger.error({ command, ...safeError(err) }, 'gagal menjalankan perintah sesi dari dashboard');
    await WaSession.update({ lastError: safeError(err).message }, { where: { id: 1 } });
  }
}
