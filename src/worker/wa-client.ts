import fs from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { Client, LocalAuth, MessageMedia, type Message } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { WaSession, OptOut, Outbox, type WaSessionStatus } from '@/models';
import { catatTransisiStatus } from './sessionHistory';
import { logger, safeError, maskPhone } from '@/lib/logger';
import { handleInboundMessageSafely } from './autoReply';
import { cobaBalasPersediaanDariGrup } from './stokReply';
import { cobaPerintahWaSafely } from './commandReply';
import { cobaFormulirWaSafely } from './formulirReply';
import { isOptOutRequest, optOutTriggerCodes } from '@/core/optOut';
import {
  isIndividualAddress,
  isGroupAddress,
  isKnownNonIndividualAddress,
  isLidAddress,
  isPhoneLike,
  kunciPesanMasuk,
  idPesanKeluar,
  phoneFromAddress,
  type PesanKeluarBerid,
} from '@/core/waAddress';
import { catatPesanKeluarManual, catatPesanMasuk } from './inboundLog';
import { ackBolehMenimpa, isTingkatAck, labelAck } from '@/core/waAck';
import { layakCatatSebagaiBalasanManual, pilihBarisTertaut } from '@/core/tautPesanKeluar';
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
  // "pengingat kontrol" tanpa kata BPJS, dan itu bukan penyederhanaan: sejak
  // migrations/032 ada DUA pemicu pengingat kontrol yang terikat daftar tolak
  // (BPJS_KONTROL dan KONTROL_ULANG untuk pasien non-BPJS). Menyebut salah
  // satunya membuat janji yang dibaca pasien lebih SEMPIT dari yang dijalankan
  // mesin -- di sini arahnya kebetulan aman, tapi pasien non-BPJS yang membaca
  // "kontrol BPJS" wajar menyimpulkan pengingatnya TIDAK ikut berhenti lalu
  // mengeluh saat ia benar-benar berhenti.
  'nomor antrian, konfirmasi & pengingat jadwal, pengingat kontrol, permintaan & hasil pemeriksaan, obat siap, tagihan, dan surat keterangan sakit.',
  '',
  'Yang MASIH akan Anda terima: pengumuman dari rumah sakit, jawaban atas pesan yang Anda kirim sendiri, dan dokumen yang Anda minta sendiri kepada petugas.',
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

  /**
   * Status dikoreksi SEBELUM penautan dimulai, bukan menunggu event pertama.
   *
   * ==========================================================================
   * Kenapa: `/koneksi` bisa berkata "tersambung, siap mengirim" selama sesi
   * yang sama sekali belum ada
   * ==========================================================================
   *
   * Setiap penulisan status di berkas ini terjadi di dalam EVENT HANDLER --
   * `qr`, `authenticated`, `ready`, `disconnected`, `auth_failure`. Saat
   * penautan menggantung, tidak satu pun event itu pernah menyala, jadi tidak
   * ada yang menimpa `ready` milik proses SEBELUMNYA: barisnya bukan basi
   * karena salah ditulis, melainkan karena tidak pernah disentuh sama sekali.
   *
   * Denyut tidak menolong, dan itu justru akibat perbaikan yang benar: ia
   * ditulis TANPA SYARAT supaya "basi = tidak ada proses yang hidup" punya satu
   * tafsir. Proses yang sedang tersangkut menautkan memang hidup dan memang
   * berdenyut. Jadi kedua sinyal yang dipunyai dashboard sama-sama berkata
   * sehat, sementara tidak satu pun pesan bisa keluar.
   *
   * Terukur pada gangguan 15 Agustus 2026 pukul 18:40-19:21: empat penautan
   * gagal berturut-turut, `wa_session.status` tetap `ready` dengan denyut 27
   * detik, `qr_data` KOSONG dan `qr_issued_at` NULL -- sementara peringatan
   * `session_init_stuck` benar-benar terkirim ke webhook. Halaman dan
   * peringatannya saling bertentangan, dan yang dipercaya orang adalah
   * halamannya.
   *
   * Akibat kedua yang ikut tertutup: `dispatchTick()` menggerbangi dirinya pada
   * `isWaReady()`, yang membaca baris ini. `ready` yang palsu membuatnya
   * mencoba mengirim ke sesi yang belum jadi -- percobaan yang menghabiskan
   * jatah `attempts` untuk keadaan yang belum sempat dicoba sama sekali.
   *
   * `authenticating` dan bukan nilai enum baru: ia sudah berarti "belum siap"
   * bagi setiap pembacanya, dan menambah nilai keenam menuntut migrasi ENUM
   * plus keputusan di tiap tempat yang mencocokkannya. Yang dibutuhkan di sini
   * cuma berhenti berbohong, bukan kosakata baru.
   *
   * TIDAK mengganggu `sessionWatchdog()`: ia sengaja tidak membaca status
   * selama fase penautan (`initSelesai`), dan tetap begitu -- yang diperbaiki
   * di sini bacaan DASHBOARD, bukan bacaan watchdog.
   */
  await catatTransisiStatus({ status: 'authenticating' }).catch((err) =>
    logger.error(safeError(err), 'gagal menandai sesi sedang menautkan'),
  );

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
      // KOREKSI: baris ini dulu berbunyi "menaikkannya TIDAK menyembunyikan sesi
      // yang menggantung, karena `sessionWatchdog()` tetap menyalakan ulang
      // worker bila sesi di luar `ready` lebih dari 15 menit". Itu KELIRU, dan
      // kekeliruannya berumur sampai gangguan 14 Agustus 2026: watchdognya dulu
      // dipasang SESUDAH `initWaClient()`, jadi ia tidak ada sama sekali selama
      // penautan -- persis fase yang batas waktu ini jaga. Yang menyudahi init
      // yang menggantung cuma batas ini, dan ia melempar ke `main().catch()` ->
      // `process.exit(1)` TANPA `shutdown()`: Chromium mati mendadak di tengah
      // menulis state sesi, sehingga start berikutnya mewarisi kerusakannya.
      //
      // Sejak watchdog naik ke atas `initWaClient()`, penautan yang menggantung
      // dihabisi lebih dulu pada 180 detik (BATAS_INIT_MS di index.ts) lewat
      // `shutdown()` yang menutup Chromium dengan rapi. Batas ini jadi jaring
      // pengaman lapis kedua, bukan lapis pertama -- dan jarak dua menitnya
      // disengaja supaya keduanya tidak pernah berlomba.
      protocolTimeout: 300_000,
    },
  });

  client.on('qr', (qr) => {
    logger.info('QR baru terbit');
    QRCode.toDataURL(qr)
      .then((dataUrl) => catatTransisiStatus({ status: 'qr_pending', qrData: dataUrl, qrIssuedAt: new Date() }))
      .catch((err) => logger.error(safeError(err), 'gagal membuat gambar QR'));
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp terautentikasi, menunggu ready');
    catatTransisiStatus({ status: 'authenticating' }).catch((err) =>
      logger.error(safeError(err), 'gagal update wa_session (authenticated)'),
    );
  });

  client.on('ready', () => {
    const phoneNumber = client?.info?.wid?.user ?? null;
    logger.info({ phoneNumber }, 'WhatsApp siap');
    catatTransisiStatus({
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
    catatTransisiStatus({ status: 'disconnected', lastError: String(reason) }).catch((err) =>
      logger.error(safeError(err), 'gagal update wa_session (disconnected)'),
    );
  });

  client.on('auth_failure', (message) => {
    logger.error({ message }, 'autentikasi WhatsApp gagal');
    catatTransisiStatus({ status: 'failed', lastError: message }).catch((err) =>
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
       * SATU-SATUNYA hal yang dibalas di dalam grup: pertanyaan PERSEDIAAN --
       * stok/harga satu obat, atau rekap barang yang di bawah ambang minimal --
       * dan hanya dari grup yang dicentang `boleh_tanya` di `farmasi_target`
       * (migrations/020).
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
       *   2. Hanya kata kunci persediaan yang dijawab; aturan /balasan-otomatis
       *      SENGAJA tidak ikut, karena kata kuncinya jauh lebih longgar.
       *   3. Ada kuota per jam per grup (`farmasi.stok_max_per_grup_per_jam`).
       *
       * Opt-out tetap TIDAK diperiksa di sini: ia berkunci pada nomor, sementara
       * yang mengetik di grup adalah salah satu peserta yang tidak sedang
       * meminta apa pun atas nama dirinya sebagai pasien.
       */
      let dibalas = false;
      try {
        /**
         * PERINTAH diperiksa LEBIH DULU, dan urutannya mengikat: cabang
         * persediaan selalu menjawab begitu kata kuncinya kena, jadi nama
         * aturan atau isi balasan yang kebetulan memuat kata "stok"/"harga"
         * akan ditelan sebagai pencarian obat -- staf menerima daftar katalog
         * di tengah percakapan wizard, dan langkahnya tidak pernah maju.
         *
         * Daftar putihnya pun BERBEDA (`wa_command_admin`, bukan
         * `farmasi_target.boleh_tanya`), jadi grup yang cuma boleh bertanya
         * stok tetap jatuh ke cabang di bawah seolah fitur ini tidak ada.
         */
        const perintah = await cobaPerintahWaSafely({
          chatId: message.from,
          // Di grup, yang menjawab wizard harus peserta yang MEMULAINYA. Tanpa
          // `author`, sesinya terkunci ke grupnya sendiri -- artinya siapa pun
          // di dalamnya bisa melanjutkan, yang masih aman karena grupnya sudah
          // terdaftar, tapi tidak seketat yang seharusnya.
          pengirimId: message.author ?? message.from,
          waMessageId: kunciPesanMasuk(message),
          teks: message.body ?? '',
          jenis: 'grup',
          phoneE164: null,
        });

        if (perintah.ditangani) {
          dibalas = true;
        } else {
          /**
           * FORMULIR (051) di grup: HANYA untuk formulir yang `boleh_grup`-nya
           * dicentang staf, dan penyaringan itu dikerjakan di dalam --
           * formulir yang tidak boleh diisi dari grup tidak pernah ikut
           * dicocokkan, jadi pesannya jatuh utuh ke cabang persediaan di
           * bawahnya seolah fitur ini tidak ada.
           *
           * Diperiksa SEBELUM cabang persediaan dengan alasan yang sama persis
           * yang menempatkan perintah di atasnya: cabang itu selalu menjawab
           * begitu kata kuncinya kena, jadi jawaban yang memuat kata
           * "stok"/"harga" ditelan jadi pencarian katalog dan langkah
           * formulirnya tidak pernah maju.
           */
          const formulir = await cobaFormulirWaSafely({
            chatId: message.from,
            pengirimId: message.author ?? message.from,
            waMessageId: kunciPesanMasuk(message),
            teks: message.body ?? '',
            jenis: 'grup',
            phoneE164: null,
          });

          if (formulir.ditangani) {
            dibalas = true;
          } else {
            const hasil = await cobaBalasPersediaanDariGrup(message);
            dibalas = hasil.ditangani;
          }
        }
      } catch (err) {
        // Kegagalan menjawab satu grup tidak boleh menjatuhkan pencatatan
        // pesan masuk -- itu satu-satunya jejak bahwa pesannya pernah datang.
        logger.error({ from: jejakId(message.from), ...safeError(err) }, 'balasan persediaan grup gagal diproses');
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

    /**
     * PERINTAH lewat WhatsApp (045). Diperiksa SESUDAH permintaan berhenti dan
     * SEBELUM balasan otomatis, dan ketiga posisinya disengaja:
     *
     * - Sesudah opt-out, karena aturan apa pun yang ditulis staf tidak boleh
     *   bisa menyandera permintaan berhenti. Frasanya tiga kata dan praktis
     *   mustahil terketik sebagai jawaban wizard, tapi urutannya tetap tidak
     *   dibalik.
     * - Sebelum `handleInboundMessage`, bukan di dalamnya: sakelarnya berdiri
     *   sendiri dari `autoreply.enabled`, supaya RS bisa menyusun aturannya
     *   lewat WhatsApp sebelum menyalakan balasan otomatis. Di dalam, ia akan
     *   mati bersama fungsi itu pada baris pertamanya.
     * - Karena itu pula ia mendahului cabang persediaan, yang berada di dalam
     *   `handleInboundMessage` -- cabang itu selalu menjawab begitu kata
     *   kuncinya kena, dan akan menelan isi balasan yang menyebut "harga".
     *
     * Alamat yang TIDAK terdaftar di `wa_command_admin` didiamkan: hasilnya
     * `ditangani: false`, jadi pesannya lanjut ke penanganan biasa seolah fitur
     * ini tidak ada.
     */
    const perintah = await cobaPerintahWaSafely({
      chatId: message.from,
      // Obrolan perorangan: pengirimnya adalah obrolannya sendiri. Bentuk kunci
      // sesi jadi seragam dengan grup tanpa cabang NULL yang harus diingat.
      pengirimId: message.from,
      waMessageId: kunciPesanMasuk(message),
      teks: message.body ?? '',
      jenis: 'perorangan',
      phoneE164,
    });
    if (perintah.ditangani) {
      await catatPesanMasuk(message, { jenis: 'perorangan', phoneE164, dibalas: true });
      return;
    }

    /**
     * FORMULIR lewat WhatsApp (051). Ketiga posisinya perlu, dan yang ketiga
     * yang paling menentukan:
     *
     * - Sesudah permintaan berhenti, seperti semua yang lain: kata kunci yang
     *   ditulis staf tidak boleh bisa menyandera permintaan berhenti.
     * - Sesudah perintah (045), karena garis miring adalah niat yang tidak
     *   ambigu. Pasien biasa tidak terkena apa pun -- ia tidak pernah lolos
     *   daftar putih `wa_command_admin`, jadi pesannya jatuh ke sini seolah
     *   fitur itu tidak ada.
     * - SEBELUM `handleInboundMessage`, karena cabang persediaan di dalamnya
     *   selalu menjawab begitu kata kuncinya kena. Jawaban pasien atas "obat apa
     *   yang dibutuhkan?" hampir pasti memuat kata yang dijaring cabang itu, dan
     *   tanpa urutan ini ia ditelan jadi pencarian katalog -- pasien menerima
     *   daftar harga di tengah formulir, dan langkahnya tidak pernah maju.
     *
     * Diam sepenuhnya selama `formulir.enabled` masih '0'.
     */
    const formulir = await cobaFormulirWaSafely({
      chatId: message.from,
      pengirimId: message.from,
      waMessageId: kunciPesanMasuk(message),
      teks: message.body ?? '',
      jenis: 'perorangan',
      phoneE164,
    });
    if (formulir.ditangani) {
      await catatPesanMasuk(message, { jenis: 'perorangan', phoneE164, dibalas: true });
      return;
    }

    // Balasan otomatis (worker/autoReply.ts). Diam sepenuhnya selama
    // app_setting `autoreply.enabled` masih '0' -- yaitu perilaku versi 1 yang
    // satu arah, tidak berubah sampai rumah sakit menyalakannya sendiri.
    //
    // Kuncinya dipakai sebagai kunci idempoten, jadi pesan yang sama
    // diserahkan dua kali oleh whatsapp-web.js (lazim setelah sesi dipulihkan)
    // tidak menghasilkan dua balasan. Lewat `kunciPesanMasuk()` karena
    // `id._serialized` tidak selalu ada -- alasannya di sana.
    const hasil = await handleInboundMessageSafely({
      waMessageId: kunciPesanMasuk(message),
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

  /**
   * KONFIRMASI TERKIRIM (migrations/035) -- satu-satunya jalur yang membedakan
   * "WhatsApp menerima titipannya" dari "penerimanya benar-benar dapat".
   *
   * `void` dan bukan `await`: pendengar event tidak boleh menahan antrean event
   * pustaka, dan kegagalan mencatat satu ack tidak boleh berakibat apa pun pada
   * pengiriman. `catatAck()` sendiri yang menjamin tidak pernah melempar.
   */
  /**
   * ID pesan keluar diambil dari `message_create`, BUKAN dari nilai kembalian
   * `sendMessage()` -- dan itu bukan pilihan gaya melainkan keharusan yang
   * terbukti di mesin ini.
   *
   * whatsapp-web.js 1.34.7 menutup `sendMessage()` dengan
   * `return sentMsg ? new Message(this, sentMsg) : undefined`, dan `sentMsg`
   * berasal dari `page.evaluate(...)` yang di sini mengembalikan `undefined`.
   * Pesannya BENAR-BENAR terkirim -- terbukti sampai, dan `send_log` mencatatnya
   * `sent` -- tapi modelnya tidak pernah menyeberang, jadi tidak ada id yang
   * bisa disimpan. Diagnostiknya berbunyi `kunciPesan: "undefined"`: bukan
   * `id`-nya yang hilang, melainkan seluruh objeknya.
   *
   * `message_create` menyala untuk setiap pesan yang dibuat termasuk yang keluar,
   * dan objeknya dibangun lewat jalur yang berbeda sehingga id-nya utuh.
   */
  client.on('message_create', (pesan) => {
    void catatIdPesanKeluar(pesan);
  });

  client.on('message_ack', (pesan, ack) => {
    void catatAck(pesan, ack);
  });

  await client.initialize();
  return client;
}

/**
 * Mencatat satu event `message_ack` ke baris `outbox` yang bersangkutan.
 *
 * TIDAK PERNAH melempar: dipanggil dari pendengar event, tempat galat yang
 * lolos menjadi unhandled rejection yang bisa menjatuhkan proses -- dan
 * menjatuhkan worker demi sebuah kolom keterangan adalah pertukaran yang jelas
 * salah.
 *
 * Dua keadaan yang sengaja DIAM (debug, bukan warn), karena keduanya normal dan
 * sering:
 *
 *   1. Pesan yang tidak punya baris `outbox`. Nomor rumah sakit juga dipakai
 *      manusia -- tiap pesan yang diketik petugas langsung dari HP menghasilkan
 *      ack-nya sendiri. Mencatatnya sebagai peringatan akan menenggelamkan yang
 *      sungguhan, pelajaran yang sama dengan pemisahan level log pada pesan
 *      masuk bukan-perorangan.
 *   2. Ack yang lebih rendah dari yang sudah tersimpan -- dijelaskan di
 *      `ackBolehMenimpa()`.
 */
/**
 * Menautkan pesan keluar yang baru dibuat dengan baris `outbox` yang
 * melahirkannya, supaya event `message_ack` berikutnya punya sesuatu untuk
 * dicocokkan.
 *
 * Penautannya lewat ISI PESAN yang sama persis, dan itu tepat -- bukan
 * perkiraan -- karena setiap pesan keluar diakhiri KODE PENGIRIMAN unik yang
 * diturunkan dari kunci idempotennya (`core/uniqueCode.ts`). Dua baris `outbox`
 * karena itu tidak pernah berisi teks yang identik.
 *
 * Tujuannya ikut diperiksa sebagai pengaman kedua, dan aturannya tinggal di
 * `core/tautPesanKeluar.ts` -- bukan di sini. Bentuk pertamanya satu baris
 * `find()` di tempat ini, dan itu ternyata membuang SETIAP percakapan
 * perorangan: WhatsApp memantulkan `to` sebagai `<id>@lid`, yang sengaja tidak
 * memuat nomor telepon. Terukur 0 dari 114 baris beralamat perorangan pernah
 * tertaut sementara grup mencapai 98,7%. Baca modul itu sebelum menyentuh
 * pencocokannya; ia memuat pengukurannya dan kenapa pengaman keduanya berganti
 * bentuk alih-alih dihapus.
 *
 * TIDAK menyaring `status`: event ini bisa menyala SEBELUM dispatcher sempat
 * menuliskan `sent`, jadi menuntut status tertentu berarti kehilangan penautan
 * justru pada pesan yang paling cepat sampai.
 */
async function catatIdPesanKeluar(pesan: Message): Promise<void> {
  try {
    if (!pesan.fromMe) return;
    const id = idPesanKeluar(pesan as unknown as PesanKeluarBerid);
    const body = pesan.body ?? '';
    if (!id || !body) {
      // Ketiga sebab kegagalan penautan dibedakan di log, karena dari luar
      // ketiganya menghasilkan gejala yang sama persis: kolom kosong.
      logger.warn(
        { adaId: !!id, panjangTeks: body.length },
        'pesan keluar terdeteksi tapi id atau isinya tidak terbaca -- konfirmasi tidak akan tercatat',
      );
      return;
    }

    const tujuan = pesan.to ?? '';
    const kandidat = await Outbox.findAll({
      where: {
        waMessageId: null,
        body,
        // Jendela sempit: yang dicari pesan yang BARU SAJA dikirim. Tanpa batas
        // waktu, baris lama beridentik teks (mungkin dari sebelum kode
        // pengiriman dinyalakan) bisa ikut tertaut.
        createdAt: { [Op.gte]: new Date(Date.now() - 30 * 60 * 1000) },
      },
      order: [['id', 'DESC']],
      limit: 10,
    });

    const hasil = pilihBarisTertaut(kandidat, tujuan);
    if (!hasil.baris) {
      /**
       * Sebabnya WAJIB ikut, dan LEVELNYA berbeda menurut sebab itu.
       *
       * Penautan yang gagal bergejala persis sama dengan penautan yang tidak
       * pernah dicoba: kolom konfirmasi kosong, tanpa galat. Percobaan pertama
       * fitur ini kehilangan berjam-jam justru karena itu -- tidak ada satu pun
       * cara membedakan "event tidak menyala", "id tidak terbaca", dan "tidak
       * ada baris yang cocok" dari luar.
       *
       * `tanpa-kandidat` sengaja DIAM (debug, bukan warn), dan itu bukan
       * melemahkan pengawasan melainkan mengembalikan artinya: nomor rumah
       * sakit juga dipakai MANUSIA -- tiap pesan yang diketik petugas dari HP,
       * tiap balasan di grup, dan tiap status yang diunggah menghasilkan
       * `message_create`-nya sendiri yang memang tidak punya baris `outbox`.
       * Terukur di log produksi, mayoritas peringatan lama adalah itu, dan
       * peringatan yang muncul puluhan kali sehari untuk keadaan normal
       * menenggelamkan yang sungguhan. Aturan yang sama sudah berlaku di
       * `catatAck()` dan pada pemisahan level log pesan masuk bukan-perorangan.
       *
       * Yang dicatat bentuk dan jumlahnya, TIDAK pernah isi pesannya (§9.7);
       * tujuannya disamarkan seperti di tempat lain.
       */
      const jejak = { tujuan: jejakId(tujuan), kandidat: kandidat.length, panjangTeks: body.length, sebab: hasil.sebab };
      if (hasil.sebab === 'tanpa-kandidat') {
        logger.debug(jejak, 'pesan keluar tanpa baris outbox -- diketik manusia dari nomor ini, bukan kiriman sistem');
        /**
         * Dan justru INILAH balasan yang sebenarnya dipakai rumah sakit ini.
         *
         * Sampai sini keadaan itu cuma dicatat lalu dilepas, karena `outbox`
         * satu-satunya sumber sisi keluar percakapan -- padahal `outbox` hanya
         * memuat pesan yang lahir di sini. Terukur 17 Agustus 2026: tombol balas
         * di dashboard NOL baris selamanya, sementara 19 balasan manusia dalam 4
         * hari lewat begitu saja. Halaman percakapan karena itu menampilkan
         * pertanyaan pasien berderet tanpa satu pun jawaban, padahal jawabannya
         * sudah diberikan -- dari ponsel.
         *
         * Keputusan LAYAK/TIDAK tinggal di `core/tautPesanKeluar.ts` supaya bisa
         * diuji tanpa database maupun Chromium; ia yang menyingkirkan unggahan
         * status, saluran, dan alamat yang belum dikenal.
         */
        if (layakCatatSebagaiBalasanManual(tujuan, hasil.sebab)) {
          await catatPesanKeluarManual(pesan, id);
        }
      } else {
        logger.warn(
          jejak,
          'pesan keluar tidak bisa ditautkan ke baris outbox -- konfirmasi terkirim tidak akan tercatat',
        );
      }
      return;
    }

    await hasil.baris.update({ waMessageId: id });
    logger.info(
      { outboxId: hasil.baris.id, triggerCode: hasil.baris.triggerCode },
      'id pesan keluar tertaut ke baris outbox',
    );
  } catch (err) {
    // Tidak pernah melempar: dipanggil dari pendengar event, dan kegagalan
    // menautkan satu id tidak boleh berakibat apa pun pada pengiriman.
    logger.error(safeError(err), 'gagal menautkan id pesan keluar');
  }
}

async function catatAck(pesan: Message, ack: unknown): Promise<void> {
  try {
    const id = idPesanTerkirim(pesan);
    if (!id) return;

    if (!isTingkatAck(ack)) {
      // Tingkat baru dari WhatsApp. Dinaikkan ke warn justru karena inilah satu
      // -satunya tanda bahwa daftar di core/waAck.ts perlu diperbarui; menyimpan
      // angkanya apa adanya akan membuat dashboard menampilkan tingkat tanpa
      // keterangan.
      logger.warn({ ack }, 'tingkat message_ack tidak dikenal -- diabaikan');
      return;
    }

    const row = await Outbox.findOne({ where: { waMessageId: id } });
    if (!row) {
      logger.debug({ waMessageId: id, ack }, 'ack untuk pesan di luar outbox -- dilewati');
      return;
    }
    if (!ackBolehMenimpa(ack, row.ackLevel)) return;

    await row.update({ ackLevel: ack, ackAt: new Date() });
    logger.info(
      { outboxId: row.id, triggerCode: row.triggerCode, ack, keterangan: labelAck(ack, !!row.chatId) },
      'konfirmasi pengiriman diterima',
    );
  } catch (err) {
    logger.error(safeError(err), 'gagal mencatat konfirmasi pengiriman');
  }
}

/** ARCHITECTURE §10 / Fase 4: pemeriksaan kesehatan -- Chromium yang menggantung tidak terlihat dari status 'ready' semata. */
export async function checkHealth(timeoutMs = 10_000): Promise<boolean> {
  const c = getClient();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
  try {
    await Promise.race([c.getState(), timeout]);
  } catch (err) {
    logger.error(safeError(err), 'pemeriksaan kesehatan client WhatsApp gagal -- Chromium mungkin menggantung');
    return false;
  }

  /**
   * `getState()` TIDAK cukup, dan itu sebabnya pemeriksaan ini pernah menjawab
   * "sehat" pada halaman yang tidak bisa mengirim apa pun: ia membaca
   * `window.require('WAWebSocketModel')` -- modul milik WhatsApp SENDIRI, yang
   * selamat dari navigasi -- sementara yang dibutuhkan pengiriman adalah objek
   * suntikan `window.WWebJS`, yang justru dihapus tiap kali frame bernavigasi.
   *
   * Anggarannya panjang (bukan sekali coba) supaya sela penyuntikan ulang yang
   * NORMAL -- biasanya di bawah satu detik -- tidak dibaca sebagai gangguan.
   * Watchdog memakai hasil fungsi ini untuk MENYALAKAN ULANG worker, dan
   * penautan ulang yang terlalu sering justru memperlambat sinkronisasi
   * WhatsApp (lihat BATAS_TIDAK_SIAP_MS di worker/index.ts). Yang harus
   * dijaringnya adalah halaman yang tidak pernah tersuntik lagi, bukan halaman
   * yang sedang menyuntik.
   */
  if (!(await tungguHalamanSiap(timeoutMs))) {
    logger.error('pemeriksaan kesehatan gagal: window.WWebJS tidak kunjung tersuntik ke halaman');
    return false;
  }
  return true;
}

/**
 * Apakah objek suntikan `window.WWebJS` ADA di halaman saat ini.
 *
 * `pupPage` tidak ada di tipe publik whatsapp-web.js, jadi cast-nya memang
 * perlu -- dan justru karena itu ketiadaannya diperlakukan sebagai
 * **"anggap siap"**, bukan "belum siap". Alasannya menentukan: hasil fungsi ini
 * dipakai untuk MENUNDA pengiriman, jadi kalau bentuk pustakanya berubah dan
 * probe-nya tidak bisa lagi dijalankan, gagal-tertutup berarti dispatcher
 * berhenti mengirim SELAMANYA tanpa satu pun galat -- jauh lebih buruk daripada
 * bug yang sedang diperbaiki. Jaring pengaman sebenarnya ada di sisi tangkapan
 * (`galatHalamanBelumSiap`); probe ini cuma menghindarkan galatnya, bukan
 * satu-satunya yang menanganinya.
 */
async function halamanSiap(): Promise<boolean> {
  const page = (getClient() as unknown as { pupPage?: { evaluate: (script: string) => Promise<unknown> } }).pupPage;
  if (!page) {
    logger.warn('probe halaman dilewati: pupPage tidak tersedia -- dianggap siap');
    return true;
  }
  try {
    return (await page.evaluate("typeof window.WWebJS !== 'undefined' && typeof window.WWebJS.getChat === 'function'")) === true;
  } catch (err) {
    // Konteks yang hancur saat probe berjalan ADALAH jawabannya: halamannya
    // sedang bernavigasi.
    logger.debug(safeError(err), 'probe halaman gagal -- dianggap belum siap');
    return false;
  }
}

/**
 * Menunggu sampai halaman benar-benar bisa dipakai mengirim, atau menyerah.
 *
 * Pengalihan ke penjajakan berulang (bukan sekali periksa) disengaja: sela
 * penyuntikan ulang normalnya sangat pendek, jadi menunggu sebentar jauh lebih
 * murah daripada menunda satu siklus dispatcher penuh.
 */
export async function tungguHalamanSiap(budgetMs: number): Promise<boolean> {
  const batas = Date.now() + budgetMs;
  for (;;) {
    if (await halamanSiap()) return true;
    if (Date.now() >= batas) return false;
    await new Promise((r) => setTimeout(r, 250));
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
export async function sendWhatsAppMessage(
  chatId: string,
  body: string,
  lampiran?: LampiranKirim | null,
): Promise<string | null> {
  const c = getClient();

  if (!lampiran) {
    const terkirim = await c.sendMessage(chatId, body);
    return idPesanTerkirim(terkirim);
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
  const terkirim = await c.sendMessage(chatId, media, { caption: body });
  return idPesanTerkirim(terkirim);
}

/**
 * Id pesan keluar, lewat penurunan BERSAMA di `core/waAddress.ts`.
 *
 * Sengaja tidak diturunkan di sini: fungsi yang sama harus dipakai saat MENGIRIM
 * (menyimpan id) dan saat MENDENGAR ack (mencarinya). Dua perakitan yang berbeda
 * sedikit saja membuat keduanya tidak pernah cocok, dan yang terlihat cuma kolom
 * konfirmasi yang selamanya kosong tanpa satu pun galat.
 */
function idPesanTerkirim(pesan: unknown): string | null {
  const id = idPesanKeluar(pesan as PesanKeluarBerid | null | undefined);
  if (!id) {
    /**
     * `debug`, BUKAN `warn`, dan itu keputusan yang diambil setelah diukur:
     * di mesin ini `sendMessage()` mengembalikan `undefined` pada SETIAP
     * kiriman (lihat komentar pendengar `message_create`), jadi peringatan di
     * sini akan menyala tiap pesan dan menenggelamkan yang sungguhan -- persis
     * alasan level log pesan bukan-perorangan dipisah.
     *
     * Jalur yang sebenarnya menautkan id adalah `message_create`. Ketiadaan di
     * sini bukan kegagalan apa pun.
     */
    logger.debug('id pesan keluar tidak ada di nilai kembalian sendMessage -- ditangani lewat message_create');
  }
  return id;
}

/** F5.4: bedakan nomor tak terdaftar (permanen) dari kegagalan sementara SEBELUM mencoba kirim. */
export async function isRegisteredOnWhatsApp(phoneE164: string): Promise<boolean> {
  const c = getClient();
  const id = await c.getNumberId(phoneE164);
  return id !== null;
}

/**
 * Denyut TANPA SYARAT -- sebelumnya digerbangi `if (await isWaReady())`, dan
 * gerbang itu membuat `heartbeat_at` menjawab pertanyaan yang salah.
 *
 * Umur denyut adalah SATU-SATUNYA hal yang bisa menjawab "apakah ada proses
 * worker yang hidup sekarang" -- `status` tidak bisa, karena baris itu ditulis
 * proses yang mungkin sudah mati dan tidak ada yang membatalkannya. Digerbangi
 * kesiapan sesi, denyutnya ikut membeku saat sesi terputus PADAHAL prosesnya
 * sehat, sehingga dua keadaan yang butuh tindakan berbeda menjadi tidak bisa
 * dibedakan dari luar:
 *
 *   worker mati            -> PM2/layanannya yang harus diperiksa
 *   worker hidup, sesi mati -> watchdog memulihkannya sendiri dalam <=15 menit
 *
 * Sesudah gerbangnya dicabut, denyut basi berarti PROSESNYA yang tidak ada --
 * tidak ada tafsir kedua. Sejak loopnya dipasang SEBELUM `initWaClient()`
 * (`index.ts`), pernyataan itu berlaku juga selama penautan: proses yang
 * menggantung di dalam init tetap berdenyut, dan itu satu-satunya cara
 * membedakannya dari proses yang sudah tertaut lalu tersangkut.
 *
 * Konsekuensi yang disengaja: `heartbeatStale()` di dashboard berhenti berarti
 * "sesi bermasalah" dan mulai berarti "worker tidak hidup". SystemStatus ikut
 * diperbarui supaya kalimatnya tidak menjanjikan diagnosis yang salah.
 *
 * ==========================================================================
 * CARA MEMERIKSANYA LEWAT `mysql` -- dan jebakan yang menelan satu diagnosis
 * ==========================================================================
 *
 * `heartbeat_at` ditulis Sequelize yang memakai `timezone: '+00:00'`, jadi
 * isinya UTC; `NOW()` di MariaDB mengembalikan waktu WIB. `TIMESTAMPDIFF(...,
 * heartbeat_at, NOW())` karena itu SELALU melebih-lebihkan umurnya tepat 25.200
 * detik (7 jam), dan hasilnya terbaca persis seperti worker yang mati semalaman
 * padahal denyutnya baru beberapa detik. Sudah benar-benar menyesatkan sekali.
 *
 *   SELECT TIMESTAMPDIFF(SECOND, CONVERT_TZ(heartbeat_at,'+00:00','+07:00'), NOW())
 *
 * Lewat Sequelize (dan karena itu lewat dashboard) tidak ada masalah sama
 * sekali -- tulis dan baca memakai konversi yang sepasang.
 */
export async function updateHeartbeat(): Promise<void> {
  await WaSession.update({ heartbeatAt: new Date() }, { where: { id: 1 } });
}
