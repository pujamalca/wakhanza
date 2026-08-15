import { WaSession, WaGroup } from '@/models';
import { catatTransisiStatus } from './sessionHistory';
import { getClient, lepasPerangkat, bersihkanDirektoriSesi } from './wa-client';
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

  /**
   * PEMBACAAN KOSONG TIDAK PERNAH MENGHAPUS APA PUN, dan ini bukan
   * kehati-hatian berlebih -- ia sudah terjadi.
   *
   * Status `wa_session` sudah `ready` beberapa detik setelah worker menyala,
   * tapi koleksi chat di dalam Chromium belum tentu ikut terisi saat itu.
   * Menekan tombol "Muat daftar grup" di sela itu membaca NOL grup, dan versi
   * pertama kode ini menafsirkannya sebagai "rumah sakit keluar dari semua
   * grup" lalu menghapus seluruh barisnya. Keenam grup nyata di mesin ini
   * lenyap begitu, tanpa satu pun galat -- dan yang hilang bukan cuma daftar:
   * ia rujukan yang dipakai memasang tujuan di /farmasi.
   *
   * Nol grup nyaris selalu berarti "belum tersinkron", hampir tidak pernah
   * berarti "memang tidak ada". Jadi yang benar adalah membiarkan daftar lama
   * apa adanya dan berisik soal itu.
   */
  if (grup.length === 0) {
    logger.warn(
      { tersimpan: await WaGroup.count() },
      'daftar grup terbaca KOSONG -- daftar lama dipertahankan, kemungkinan sesi belum selesai sinkron',
    );
    return;
  }

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

  // Grup yang sudah tidak diikuti lagi dihapus -- tapi hanya sesudah terbukti
  // pembacaannya berhasil (dijaga penjagaan di atas). Yang TIDAK ikut terhapus
  // adalah `farmasi_target`: tujuan yang sudah dipasang tidak boleh lenyap
  // karena satu sinkronisasi kebetulan tidak menyertakan grupnya.
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
 * Fase sesi saat perintah dibaca. Diserahkan pemanggil karena hanya
 * `worker/index.ts` yang tahu apakah `initWaClient()` sudah selesai.
 */
export type FaseSesi = 'menautkan' | 'siap';

/**
 * Apa yang harus dikerjakan PEMANGGIL sesudahnya.
 *
 * Perintah yang menuntut sesi lahir kembali dijawab dengan meminta restart,
 * bukan dengan memanggil `client.initialize()` dari sini -- lihat alasannya di
 * cabang `logout`. Bentuk nilai balik dipilih supaya `shutdown()` tetap tinggal
 * di `index.ts`: mengimpornya ke sini membuat lingkaran impor antara dua berkas
 * yang sama-sama dimuat saat worker menyala.
 */
export type HasilPerintah = 'tidak-ada' | 'dikerjakan' | 'minta-restart' | 'ditunda';

/**
 * ARCHITECTURE §1: dashboard menitip perintah lewat wa_session.command;
 * worker membacanya lalu mengosongkannya. Command dikonsumsi (di-set balik
 * ke 'none') SEBELUM dieksekusi supaya perintah yang gagal tidak diulang
 * tanpa henti tiap siklus.
 *
 * ==========================================================================
 * Kenapa fase penautan ditangani TERPISAH
 * ==========================================================================
 *
 * Loop ini dulu dipasang SESUDAH `await initWaClient()`, sehingga selama
 * penautan ia tidak ada sama sekali. Akibatnya persis kebalikan dari yang
 * dibutuhkan: tombol "Sambung ulang" dan "Keluar sesi" berhenti dibaca tepat
 * pada keadaan yang paling membuat orang menekannya, dan yang terlihat bukan
 * "lambat" melainkan tombol yang tidak melakukan apa-apa. Terukur pada gangguan
 * 15 Agustus 2026: penautan gagal berulang selama empat puluh menit, dan
 * sepanjang itu tidak satu pun perintah dari dashboard pernah dibaca.
 *
 * Menaikkan loopnya begitu saja ditolak dengan dua alasan yang MASIH berlaku:
 * ia memanggil `getClient()` yang menuntut halaman jadi, dan ia MENGOSONGKAN
 * kolom perintah sebelum bertindak -- jadi perintah akan ditelan diam-diam.
 * Keduanya ditutup di sini alih-alih dihindari: selama fase `menautkan`,
 * `getClient()` tidak pernah disentuh, dan perintah yang belum bisa dikerjakan
 * TIDAK dikonsumsi -- ia tetap menunggu sampai sesinya hidup, persis seperti
 * sebelumnya.
 *
 * Yang berubah cuma `reconnect`, dan justru itu yang dicari orang: saat
 * penautan menggantung, "sambung ulang" berarti "sudahi percobaan ini, mulai
 * lagi" -- dan itu tidak menuntut halaman apa pun.
 */
export async function processSessionCommand(fase: FaseSesi = 'siap'): Promise<HasilPerintah> {
  const row = await WaSession.findByPk(1);
  if (!row || row.command === 'none') return 'tidak-ada';

  /**
   * SAMBUNG ULANG saat QR sedang tampil TIDAK menyalakan ulang apa pun.
   *
   * Diperiksa di luar percabangan fase karena `qr_pending` bisa muncul di
   * keduanya: sebelum init selesai (pemasangan pertama) maupun sesudah logout
   * pada klien yang sudah jadi.
   *
   * Sebabnya sudah tertulis di `sessionWatchdog()`, yang mengecualikan
   * `qr_pending` dari batas waktunya dengan kalimat yang sama: "restart di
   * tengahnya justru menerbitkan QR baru sehingga kode yang sedang dipindai
   * petugas jadi kedaluwarsa". Aturan itu sudah ada, dan versi pertama
   * perbaikan responsivitas ini melewatinya -- terukur pada 15 Agustus 2026,
   * tombolnya ditekan dua kali pukul 19:44:41 dan 19:45:06, dan tiap tekanan
   * membatalkan QR yang sedang ditatap petugas. Tombol yang responsif tapi
   * merusak lebih buruk daripada tombol yang diam.
   *
   * Perintahnya tetap DIKONSUMSI, bukan ditunda: menundanya berarti ia menyala
   * belakangan pada saat yang tidak diminta siapa pun -- justru mungkin tepat
   * saat QR berikutnya tampil.
   */
  if (row.command === 'reconnect' && row.status === 'qr_pending') {
    await WaSession.update({ command: 'none' }, { where: { id: 1 } });
    logger.info('perintah sambung ulang diabaikan: QR sedang menunggu dipindai');
    return 'dikerjakan';
  }

  if (fase === 'menautkan') {
    if (row.command !== 'reconnect') {
      // SENGAJA tidak dikonsumsi: `logout` dan `sync_groups` sama-sama menuntut
      // halaman yang sudah jadi. Mengosongkan kolomnya di sini berarti perintah
      // staf hilang tanpa jejak, dan dari layar itu tidak bisa dibedakan dari
      // perintah yang sudah dikerjakan.
      logger.info({ command: row.command }, 'perintah ditunda: sesi masih menautkan');
      return 'ditunda';
    }
    await WaSession.update({ command: 'none' }, { where: { id: 1 } });
    logger.warn('perintah sambung ulang saat penautan belum selesai -- worker dimulai ulang');
    return 'minta-restart';
  }

  const command = row.command;
  await WaSession.update({ command: 'none' }, { where: { id: 1 } });

  try {
    const client = getClient();
    if (command === 'logout') {
      logger.warn('perintah logout diterima dari dashboard, memutus sesi WhatsApp');
      // Urutannya menentukan kebenaran, bukan kerapian -- lihat penjelasan di
      // wa-client.ts. Kegagalan menghapus berkas sesi terjadi SESUDAH
      // perangkatnya benar-benar dilepas di sisi server, jadi status harus
      // dikoreksi lebih dulu; menunggu berkasnya bersih berarti membiarkan
      // halaman Koneksi menampilkan sesi yang sudah tidak ada selama itu.
      const { direktoriTerkunci } = await lepasPerangkat();
      await catatTransisiStatus({ status: 'qr_pending', phoneNumber: null, qrData: null, lastError: null });

      if (direktoriTerkunci && !(await bersihkanDirektoriSesi())) {
        // Keterangan, BUKAN laporan kegagalan logout: perangkatnya memang
        // sudah lepas. Statusnya di atas tetap `qr_pending` dan tidak diubah
        // lagi di sini.
        await WaSession.update(
          {
            lastError:
              'Perangkat sudah dilepas dari WhatsApp, tapi berkas sesi lama tidak bisa dihapus (masih dikunci Windows). Hentikan worker, hapus folder .wwebjs_auth\\session, lalu jalankan worker lagi.',
          },
          { where: { id: 1 } },
        );
      }

      /**
       * MINTA RESTART, bukan `await client.initialize()` di sini.
       *
       * Baris itu dulu menahan loop perintah selama seluruh penautan ulang --
       * dan penautan yang menggantung tidak dijaga watchdog mana pun dari sini,
       * karena `BATAS_INIT_MS` hanya mengawasi `initWaClient()` di `main()`.
       * Terukur pada gangguan 15 Agustus 2026, penautan yang gagal menggantung
       * sampai `protocolTimeout` 300 detik: tombol "Keluar sesi" karena itu
       * tampak menggantung lima menit, padahal perangkatnya sudah lepas dan
       * statusnya sudah dikoreksi pada baris-baris di atas.
       *
       * Proses baru mengerjakan penautannya di bawah pengawasan penuh, dan
       * jalur itu sudah teruji tiap kali PM2 menyalakan ulang worker. Jadi yang
       * dibuang bukan kemampuan, melainkan satu jalur init kedua yang tidak
       * terjaga.
       */
      return 'minta-restart';
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
  return 'dikerjakan';
}
