import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, LocalAuth, MessageMedia, type Message } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { WaSession, OptOut, Outbox, type WaSessionStatus } from '@/models';
import { logger, safeError, maskPhone } from '@/lib/logger';
import { handleInboundMessageSafely } from './autoReply';
import { cobaBalasStokDariGrup } from './stokReply';
import { isOptOutRequest, optOutTriggerCodes } from '@/core/optOut';
import {
  isIndividualAddress,
  isGroupAddress,
  isKnownNonIndividualAddress,
  isLidAddress,
  isPhoneLike,
  phoneFromAddress,
} from '@/core/waAddress';
import { catatPesanMasuk } from './inboundLog';
import { resolveMediaPath } from '@/lib/mediaStorage';

/**
 * F5.5 / ARCHITECTURE §8: permintaan berhenti selalu didengarkan, dan selalu
 * diperiksa PALING DULU -- sebelum balasan otomatis mendapat giliran.
 *
 * Urutan ini bukan kebetulan. Pasien yang minta berhenti harus berhenti, bukan
 * memicu pencocokan kata kunci yang kebetulan mengandung kata yang sama; dan
 * sebuah aturan balasan yang keliru ditulis staf tidak boleh bisa menyandera
 * permintaan berhenti.
 *
 * Frasanya ada di core/optOut.ts bersama daftar pemicu yang terikat -- keduanya
 * satu berkas karena keduanya menyusun SATU janji ke pasien, dan janji itu
 * tidak boleh terpecah dua tempat yang bisa berbeda tafsir.
 */
/**
 * Teks konfirmasi WAJIB menyebut batas cakupannya.
 *
 * Versi sebelumnya berbunyi "Anda telah berhenti menerima notifikasi dari
 * kami" -- kalimat yang kini tidak benar, karena pengumuman broadcast dan
 * jawaban atas pertanyaan pasien tetap berjalan. Menjanjikan lebih luas dari
 * yang benar-benar dijalankan mesin adalah cara tercepat kehilangan
 * kepercayaan pasien, dan pasien tidak punya cara memeriksanya selain menunggu
 * pesan berikutnya datang.
 */
const OPT_OUT_CONFIRMATION = [
  'Baik, kami hentikan pemberitahuan otomatis untuk nomor ini:',
  'nomor antrian, konfirmasi & pengingat jadwal, hasil pemeriksaan, obat siap, dan tagihan.',
  '',
  'Yang MASIH akan Anda terima: pengumuman dari rumah sakit, dan jawaban atas pesan yang Anda kirim sendiri.',
  '',
  'Ingin berlangganan lagi? Sampaikan ke petugas pendaftaran.',
].join('\n');

let client: Client | null = null;

/** Menyamarkan bagian nomornya tapi MEMPERTAHANKAN akhiran alamat (`@c.us`, `@lid`, `@g.us`) -- akhiran itulah yang menentukan pesan lolos penyaring atau tidak. */
function jejakId(id: string | null | undefined): string {
  if (!id) return '(kosong)';
  const [user, server] = id.split('@');
  return `${maskPhone(user)}@${server ?? '?'}`;
}

export function getClient(): Client {
  if (!client) throw new Error('WhatsApp client belum diinisialisasi — panggil initWaClient() dulu');
  return client;
}

/**
 * Nomor E.164 pengirim sebuah pesan masuk.
 *
 * WAJIB ada sebelum apa pun dikerjakan, karena SEMUA yang di hilir berkunci
 * pada nomor dan bukan pada identitas obrolan: daftar tolak
 * (`opt_out.phone_e164`), kuota balasan per nomor (`auto_reply_log`), dan
 * pengiriman itu sendiri (dispatcher mengirim ke `<nomor>@c.us`).
 *
 * Untuk alamat `@lid` nomornya tidak ada di alamat dan harus ditanyakan ke
 * WhatsApp. Tiga jalur dicoba berurutan, dari yang paling resmi ke yang paling
 * dalam; yang berhasil dicatat supaya kalau suatu saat WhatsApp mengubahnya
 * lagi, log memberi tahu jalur mana yang tumbang -- bukan cuma "tidak membalas".
 *
 * Mengembalikan null berarti pemanggil harus BERHENTI, bukan menebak: membalas
 * ke identitas yang tidak bisa dipetakan berarti melewati daftar tolak dan
 * kuota sekaligus, dan menebak dari bentuk angkanya akan mengirim balasan ke
 * nomor asing (bagian user sebuah LID berbentuk persis seperti nomor telepon).
 */
let jalurPemetaanTerakhir: string | null = null;

/**
 * Dicatat `info` HANYA saat jalurnya BERUBAH, `debug` selebihnya.
 *
 * Jalur mana yang dipakai tidak menarik selama tetap sama -- yang menarik
 * justru saat ia berpindah ke jalur yang lebih dalam, karena itu tanda WhatsApp
 * mengubah sesuatu lagi dan jalur sebelumnya berhenti bekerja. Mencatatnya tiap
 * pesan akan menenggelamkan sinyal itu; mencatatnya hanya di `debug` membuatnya
 * tak terlihat sama sekali pada LOG_LEVEL bawaan.
 */
function catatJalurPemetaan(jalur: string): void {
  if (jalurPemetaanTerakhir === jalur) {
    logger.debug({ jalur }, 'nomor pengirim dipetakan dari LID');
    return;
  }
  jalurPemetaanTerakhir = jalur;
  logger.info({ jalur }, 'jalur pemetaan LID -> nomor berubah');
}

async function resolvePhoneE164(message: Message): Promise<string | null> {
  const langsung = phoneFromAddress(message.from);
  if (langsung) return langsung;
  if (!isLidAddress(message.from)) return null;

  // [1] Jalur resmi. getContactModel() milik whatsapp-web.js sudah menukar id
  // LID dengan nomor telepon begitu WhatsApp mengetahuinya.
  try {
    const kontak = await message.getContact();
    const dariId = phoneFromAddress(kontak?.id?._serialized);
    if (dariId) {
      catatJalurPemetaan('kontak.id');
      return dariId;
    }
    // [2] Cadangan untuk kasus id-nya ada tapi cacat. Penjaga `!isLidAddress`
    // di sini WAJIB dan bukan kehati-hatian berlebih: `Contact.number` diisi
    // dari `userid` kontak, dan untuk kontak ber-LID `userid` itu adalah bagian
    // user LID-nya sendiri -- 15 digit, lolos isPhoneLike, dan sepenuhnya bukan
    // nomor telepon. Tanpa penjaga ini jalur [2] justru menjadi cara paling
    // rapi untuk mengirim balasan pasien ke nomor orang asing.
    if (!isLidAddress(kontak?.id?._serialized) && isPhoneLike(kontak?.number)) {
      catatJalurPemetaan('kontak.number');
      return kontak.number;
    }
  } catch (err) {
    logger.warn({ from: jejakId(message.from), ...safeError(err) }, 'gagal membaca kontak pengirim');
  }

  // [3] Pemetaan internal yang dipakai whatsapp-web.js sendiri untuk peserta
  // grup ber-LID. Dibungkus try/catch supaya pembaruan pustaka yang
  // menghapusnya berakibat "dilewati dengan peringatan", bukan worker tumbang.
  try {
    const page = (client as unknown as { pupPage?: { evaluate: (fn: (lid: string) => unknown, arg: string) => Promise<string | null> } })
      ?.pupPage;
    if (!page) return null;
    const hasil: string | null = await page.evaluate(async (lid: string) => {
      const w = window as unknown as {
        WWebJS?: { enforceLidAndPnRetrieval?: (id: string) => Promise<{ phone?: { _serialized?: string } }> };
      };
      const r = await w.WWebJS?.enforceLidAndPnRetrieval?.(lid);
      return r?.phone?._serialized ?? null;
    }, message.from);
    const dariInternal = phoneFromAddress(hasil);
    if (dariInternal) {
      catatJalurPemetaan('enforceLidAndPnRetrieval');
      return dariInternal;
    }
  } catch (err) {
    logger.warn({ from: jejakId(message.from), ...safeError(err) }, 'pemetaan LID internal gagal');
  }

  return null;
}

export async function isWaReady(): Promise<boolean> {
  const row = await WaSession.findByPk(1);
  return row?.status === 'ready';
}

export async function getWaSessionStatus(): Promise<WaSessionStatus | null> {
  const row = await WaSession.findByPk(1);
  return row?.status ?? null;
}

/** Kode galat Windows saat berkas masih dipegang proses lain. */
const KODE_BERKAS_TERKUNCI = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'];

function galatBerkasTerkunci(err: unknown): boolean {
  // whatsapp-web.js membungkusnya dengan `throw new Error(e)`, jadi kode
  // aslinya sudah luruh jadi TEKS ("Error: EPERM: operation not permitted,
  // unlink '...'"). Karena itu pemeriksaannya lewat pesan, bukan `err.code`.
  const teks = err instanceof Error ? err.message : String(err);
  return KODE_BERKAS_TERKUNCI.some((kode) => teks.includes(kode));
}

/**
 * Direktori sesi yang benar-benar dipakai LocalAuth.
 *
 * Diambil dari instance-nya bila ada -- kalau aturan penamaan pustaka berubah,
 * menurunkannya sendiri berarti kita menghapus direktori yang SALAH (atau,
 * lebih buruk, tidak menghapus apa pun sambil melaporkan berhasil).
 */
function direktoriSesi(): string {
  // `authStrategy` tidak ada di tipe publik whatsapp-web.js, jadi cast-nya
  // memang perlu -- dan justru karena itu hasilnya diperlakukan sebagai
  // mungkin-tidak-ada, dengan penurunan sendiri sebagai cadangan di bawah.
  const dariInstance = (client as unknown as { authStrategy?: { userDataDir?: string } } | null)?.authStrategy
    ?.userDataDir;
  if (dariInstance) return dariInstance;
  return path.join(path.resolve(process.env.WA_SESSION_PATH ?? './.wwebjs_auth'), 'session');
}

/**
 * Melepas perangkat dari WhatsApp. TIDAK menunggu berkas sesinya terhapus.
 *
 * KENAPA DIPECAH DUA. `client.logout()` melakukan empat langkah berurutan:
 *
 *   1. `Socket.logout()` di halaman   -> perangkat dilepas di SISI SERVER
 *   2. `pupBrowser.close()`           -> Chromium ditutup
 *   3. tunggu `isConnected()` -- MAKS 1 detik
 *   4. `authStrategy.logout()`        -> hapus direktori sesi   <-- EPERM di sini
 *
 * Yang gagal di Windows hanya langkah 4, dan itu mengubah seluruh cara
 * menanganinya: saat galatnya muncul, perangkatnya SUDAH terlepas dan Chromium
 * SUDAH tertutup. Melemparkannya sebagai kegagalan utuh -- perilaku sebelumnya
 * -- membuat `status`/`phone_number` tidak pernah dikosongkan, sehingga halaman
 * Koneksi tetap menampilkan sesi yang sebenarnya sudah tidak ada dan setiap
 * upaya menautkan ulang ditolak "sesi sebelumnya masih ada". Ditemukan dari
 * `wa_session.last_error` di produksi, bukan diperkirakan.
 *
 * Karena itu pemanggilnya WAJIB mengoreksi status lebih dulu, baru memanggil
 * `bersihkanDirektoriSesi()`. Urutan sebaliknya menahan koreksi status selama
 * berkasnya masih dicoba dihapus -- yaitu memperpanjang keadaan salah itu.
 *
 * @returns `direktoriTerkunci` true bila perangkat sudah lepas tapi direktori
 *          sesinya belum bisa dihapus. Bukan kegagalan logout.
 */
export async function lepasPerangkat(): Promise<{ direktoriTerkunci: boolean }> {
  const c = getClient();
  try {
    await c.logout();
    return { direktoriTerkunci: false };
  } catch (err) {
    if (!galatBerkasTerkunci(err)) throw err;
    logger.warn(safeError(err), 'perangkat sudah dilepas dari WhatsApp, berkas sesinya menyusul');
    return { direktoriTerkunci: true };
  }
}

/**
 * Menghapus direktori sesi, dengan jeda menaik sampai ~45 detik.
 *
 * Jedanya menaik (1s, 2s, 3s, ...) alih-alih tetap: proses anak Chromium
 * (renderer, GPU, network service) biasanya melepas handle-nya dalam beberapa
 * detik pertama, sementara pemegang yang benar-benar bermasalah -- pemindai
 * virus yang sedang membaca berkas sesi -- butuh jauh lebih lama. Jeda tetap
 * yang pendek gagal untuk kasus kedua; jeda tetap yang panjang membuat kasus
 * pertama, yang justru paling sering, menunggu tanpa alasan.
 *
 * `maxRetries` sengaja tidak dipakai di sini: ulangan bawaan Node tidak
 * mencatat apa pun, jadi kegagalan yang berlangsung setengah menit tidak
 * meninggalkan satu baris pun untuk menjelaskan ke mana waktunya pergi.
 */
export async function bersihkanDirektoriSesi(): Promise<boolean> {
  const dir = direktoriSesi();
  for (let percobaan = 1; percobaan <= 9; percobaan++) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 0 });
      if (percobaan > 1) logger.info({ percobaan }, 'direktori sesi akhirnya terhapus');
      return true;
    } catch (err) {
      if (!galatBerkasTerkunci(err)) throw err;
      logger.debug({ percobaan }, 'direktori sesi masih terkunci');
      await new Promise((r) => setTimeout(r, percobaan * 1_000));
    }
  }
  logger.error({ direktori: dir }, 'direktori sesi TIDAK bisa dihapus -- perlu dibersihkan manual');
  return false;
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
    // `rmMaxRetries: 0` sengaja MENURUNKAN ketahanan pustaka, bukan menaikkannya.
    //
    // Diukur di mesin ini (handle eksklusif, seperti berkas LevelDB Chromium):
    // bawaannya 4 bertahan 32 detik sebelum menyerah, dan 20 masih bertahan di
    // detik ke-119. Anggaran sepanjang itu terdengar bagus sampai disadari DI
    // MANA ia dihabiskan: di dalam `client.logout()`, yaitu SEBELUM status sesi
    // di database sempat dikoreksi. Perangkatnya sudah lepas dari WhatsApp pada
    // langkah pertama, tapi halaman Koneksi akan menampilkan sesi lama sebagai
    // masih tersambung selama dua menit itu -- memperpanjang persis kebohongan
    // yang perbaikan ini ada untuk menghilangkan.
    //
    // Jadi: gagal cepat di sini, koreksi status, baru bersihkan berkasnya lewat
    // `bersihkanDirektoriSesi()` yang anggarannya kita kendalikan dan kita catat.
    authStrategy: new LocalAuth({ dataPath: sessionPath, rmMaxRetries: 0 }),
    puppeteer: {
      headless: true,
      args: ['--disable-dev-shm-usage'],
      // Bawaan Puppeteer 180 detik, dan itu terbukti kurang di sini: worker
      // gagal memulai berulang dengan "Runtime.callFunctionOn timed out"
      // tepat ~200 detik setiap kali, sementara Chromium sendiri jalan normal.
      // Yang lama bukan peluncurannya melainkan injeksi awal whatsapp-web.js
      // ke WhatsApp Web, dan itu tumbuh seiring besarnya sesi tersimpan
      // (direktori sesi di sini 37 MB).
      //
      // Menaikkannya TIDAK menyembunyikan sesi yang menggantung: `sessionWatchdog()`
      // di index.ts tetap menyalakan ulang worker bila sesi berada di luar
      // `ready` lebih dari 15 menit, jadi batas atas pemulihannya tidak berubah.
      protocolTimeout: 300_000,
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

    const perorangan = isIndividualAddress(message.from);
    const grup = isGroupAddress(message.from);

    if (!perorangan && !grup) {
      // Status kontak dan saluran datang terus-menerus ke nomor rumah sakit dan
      // bukan kesalahan apa pun -- dicatat di level debug supaya tidak
      // menenggelamkan yang penting. Server yang BELUM dikenal justru dinaikkan
      // ke warn: lihat alasannya di core/waAddress.ts.
      //
      // Keduanya juga TIDAK dicatat ke `inbound_message`: satu nomor rumah
      // sakit menerima status dari SETIAP kontaknya, dan tabelnya akan tumbuh
      // ribuan baris sehari berisi hal yang tidak seorang pun cari.
      const rutin = isKnownNonIndividualAddress(message.from);
      logger[rutin ? 'debug' : 'warn'](
        { from: jejakId(message.from), type: message.type },
        rutin ? 'pesan bukan-perorangan dilewati' : 'pesan masuk dilewati: jenis alamat belum dikenal',
      );
      return;
    }

    /**
     * Pesan GRUP dicatat, tapi berhenti di sini.
     *
     * Sampai sebelumnya ia dibuang di baris kedua tanpa jejak apa pun, dan
     * itulah kenapa tidak ada satu pun cara melihat id grup dari dashboard.
     * Sekarang ia masuk daftar -- tapi TIDAK melanjutkan ke opt-out maupun
     * balasan otomatis, dan keduanya disengaja:
     *
     * - Opt-out per NOMOR, sementara yang mengirim di grup adalah salah satu
     *   peserta. Satu orang yang mengetik frasa berhenti di dalam grup tidak
     *   sedang meminta apa pun atas nama dirinya sebagai pasien.
     * - Membalas otomatis di dalam grup berarti seluruh anggota menerima
     *   jawaban atas pertanyaan satu orang, dan satu percakapan ramai bisa
     *   memicu balasan beruntun -- persis pola yang membuat nomor diblokir.
     */
    if (grup) {
      /**
       * SATU-SATUNYA hal yang dibalas di dalam grup: pertanyaan stok/harga
       * obat, dan hanya dari grup yang dicentang `boleh_tanya` di
       * `farmasi_target` (migrations/020).
       *
       * Aturan umumnya tetap berlaku dan tidak dilonggarkan: nomor rumah sakit
       * TIDAK membalas di grup. Sebabnya masih sama -- menjawab pertanyaan satu
       * orang berarti seluruh anggota menerima pesannya, dan satu percakapan
       * ramai berubah jadi rentetan balasan dari satu-satunya nomor RS, persis
       * pola yang memicu pemblokiran WhatsApp (PRD F5.2).
       *
       * Yang membuat pengecualian ini bisa dipertanggungjawabkan ada tiga, dan
       * ketiganya harus tetap ada:
       *   1. Grupnya didaftarkan admin satu per satu -- bukan grup mana pun
       *      yang kebetulan mengundang nomor RS.
       *   2. Hanya kata kunci stok yang dijawab; aturan /balasan-otomatis
       *      SENGAJA tidak ikut, karena kata kuncinya jauh lebih longgar.
       *   3. Ada kuota per jam per grup (`farmasi.stok_max_per_grup_per_jam`).
       *
       * Opt-out tetap TIDAK diperiksa di sini: ia berkunci pada nomor, sementara
       * yang mengetik di grup adalah salah satu peserta yang tidak sedang
       * meminta apa pun atas nama dirinya sebagai pasien.
       */
      let dibalas = false;
      try {
        const hasil = await cobaBalasStokDariGrup(message);
        dibalas = hasil.ditangani;
      } catch (err) {
        // Kegagalan menjawab satu grup tidak boleh menjatuhkan pencatatan
        // pesan masuk -- itu satu-satunya jejak bahwa pesannya pernah datang.
        logger.error({ from: jejakId(message.from), ...safeError(err) }, 'balasan stok grup gagal diproses');
      }

      logger.debug({ from: jejakId(message.from), type: message.type, dibalas }, 'pesan grup dicatat');
      await catatPesanMasuk(message, { jenis: 'grup', phoneE164: null, dibalas });
      return;
    }

    // Jejak AMPLOP untuk lalu lintas perorangan, dicatat SEBELUM penyaring
    // sisanya. Tanpa ini, pesan yang jatuh di penyaring mana pun menghilang
    // tanpa satu baris log -- persis keadaan yang membuat "tidak membalas" tak
    // bisa dibedakan dari "pesannya tidak pernah sampai", dan yang membuat bug
    // LID butuh berjam-jam untuk ditemukan. Yang dicatat cuma amplopnya, tidak
    // pernah isinya (§9.7; `autoreply.log_inbound_text` mati karena alasan
    // yang sama).
    logger.info(
      { from: jejakId(message.from), type: message.type, panjangTeks: (message.body ?? '').length },
      'pesan masuk diterima',
    );

    const phoneE164 = await resolvePhoneE164(message);
    if (!phoneE164) {
      logger.warn({ from: jejakId(message.from) }, 'pesan masuk dilewati: nomor pengirim tidak bisa dipetakan');
      // TETAP dicatat, justru karena inilah keadaan yang paling perlu terlihat:
      // pesan pasien yang tidak bisa dipetakan ke nomor pernah hilang
      // berjam-jam tanpa satu pun jejak. Di layar ia muncul sebagai baris
      // dengan kolom nomor kosong, bukan sebagai ketiadaan.
      await catatPesanMasuk(message, { jenis: 'perorangan', phoneE164: null, dibalas: false });
      return;
    }

    if (isOptOutRequest(message.body)) {
      try {
        await OptOut.upsert({ phoneE164, source: 'reply' });
        // §9.8: outbox yang masih menunggu ke nomor ini langsung dilewati --
        // jangan tunggu pemeriksaan kedua di dispatcher untuk baris yang sudah
        // nyata-nyata diketahui harus berhenti sekarang.
        //
        // DIBATASI ke pemicu yang memang terikat: tanpa `triggerCode` di sini,
        // broadcast dan balasan otomatis yang kebetulan sedang mengantre untuk
        // nomor ini ikut tercoret -- padahal keduanya sengaja TIDAK tunduk pada
        // opt-out. Itu akan membuat cakupannya bergantung pada kebetulan waktu:
        // pesan yang sudah telanjur mengantre hilang, yang belum tetap terkirim.
        await Outbox.update(
          { status: 'skipped_opt_out' },
          { where: { phoneE164, status: 'pending', triggerCode: optOutTriggerCodes() } },
        );
        await message.reply(OPT_OUT_CONFIRMATION);
        logger.info({ phone: maskPhone(phoneE164) }, 'permintaan berhenti kirim otomatis diterima');
      } catch (err) {
        logger.error({ phone: maskPhone(phoneE164), ...safeError(err) }, 'gagal memproses permintaan berhenti kirim otomatis');
      }
      await catatPesanMasuk(message, { jenis: 'perorangan', phoneE164, dibalas: true });
      return;
    }

    // Balasan otomatis (worker/autoReply.ts). Diam sepenuhnya selama
    // app_setting `autoreply.enabled` masih '0' -- yaitu perilaku versi 1 yang
    // satu arah, tidak berubah sampai rumah sakit menyalakannya sendiri.
    //
    // message.id._serialized dipakai sebagai kunci idempoten, jadi pesan yang
    // sama diserahkan dua kali oleh whatsapp-web.js (lazim setelah sesi
    // dipulihkan) tidak menghasilkan dua balasan.
    const hasil = await handleInboundMessageSafely({
      waMessageId: message.id?._serialized ?? `${message.from}:${message.timestamp}`,
      phoneE164,
      text: message.body ?? '',
    });

    // Dicatat PALING AKHIR supaya `dibalas` sudah pasti -- tabelnya tanpa grant
    // UPDATE, jadi tidak ada kesempatan kedua untuk membetulkannya.
    await catatPesanMasuk(message, {
      jenis: 'perorangan',
      phoneE164,
      dibalas: hasil.outcome === 'matched' || hasil.outcome === 'fallback',
    });
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

export interface LampiranKirim {
  /** Lintasan RELATIF terhadap direktori media; diperiksa ulang di sini. */
  path: string;
  name: string;
}

/**
 * Menerima ALAMAT LENGKAP (`628xxx@c.us` atau `120363xxx@g.us`), bukan nomor.
 *
 * Dulu parameternya nomor E.164 dan `@c.us` dirakit di sini. Itu benar selama
 * satu-satunya tujuan adalah pasien perorangan; begitu notifikasi farmasi bisa
 * menuju sebuah GRUP, perakitan di sini menjadi tempat yang salah -- ia harus
 * ikut memutuskan jenis alamat padahal yang tahu jenisnya adalah baris outbox.
 * Sekarang keputusan itu ada di satu tempat (dispatcher), dan fungsi ini cuma
 * meneruskan.
 *
 * Untuk pasien, alamatnya tetap `<nomor>@c.us` walau obrolan masuknya beralamat
 * `@lid` -- WhatsApp menerima JID bernomor untuk pengiriman dan menaruhnya di
 * percakapan yang sama. Dibuktikan end-to-end: balasan atas pesan ber-LID
 * diterima pasien.
 */
export async function sendWhatsAppMessage(chatId: string, body: string, lampiran?: LampiranKirim | null): Promise<void> {
  const c = getClient();

  if (!lampiran) {
    await c.sendMessage(chatId, body);
    return;
  }

  // Lintasan dibangun ulang lewat resolveMediaPath, bukan dipakai apa adanya
  // dari baris outbox: nilainya sudah pulang-pergi lewat database, dan ini yang
  // memastikan satu baris yang disunting lewat SQL tidak bisa membuat worker
  // membaca berkas sembarang di server lalu mengirimkannya ke pasien.
  const absolut = resolveMediaPath(lampiran.path);
  if (!absolut) throw new Error(`lintasan lampiran ditolak: ${lampiran.path}`);

  const media = MessageMedia.fromFilePath(absolut);
  media.filename = lampiran.name || media.filename;
  // Isi pesan menjadi KETERANGAN lampiran. Batas panjangnya jauh lebih pendek
  // daripada pesan teks biasa dan sudah diperiksa saat menyusun
  // (core/media.ts's periksaPanjangKeterangan) -- kalau sampai lolos ke sini
  // dan ditolak WhatsApp, kegagalannya tercatat di send_log seperti biasa.
  await c.sendMessage(chatId, media, { caption: body });
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
