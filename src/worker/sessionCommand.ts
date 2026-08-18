import { WaSession, WaGroup } from '@/models';
import { catatTransisiStatus } from './sessionHistory';
import { getClient, lepasPerangkat, bersihkanDirektoriSesi, sisihkanDirektoriSesi } from './wa-client';
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
 * Perintah yang menuntut sesi lahir kembali TIDAK memanggil
 * `client.initialize()` dari sini -- lihat alasannya di cabang `logout`. Bentuk
 * nilai balik dipilih supaya `shutdown()` dan `initWaClient()` tetap tinggal di
 * `index.ts`: mengimpornya ke sini membuat lingkaran impor antara dua berkas
 * yang sama-sama dimuat saat worker menyala.
 *
 * `tautkan-ulang` vs `minta-restart` -- bedanya bukan gaya, melainkan siapa yang
 * masih memegang direktori sesi. Yang pertama berarti direktorinya sudah bersih
 * sehingga penautan ulang bisa dikerjakan proses ini juga (QR terbit beberapa
 * detik kemudian); yang kedua berarti hanya kematian proses ini yang akan
 * melepas berkasnya.
 */
export type HasilPerintah = 'tidak-ada' | 'dikerjakan' | 'tautkan-ulang' | 'minta-restart' | 'ditunda';

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
      /**
       * `authenticating`, BUKAN `qr_pending` -- dan bedanya bukan istilah.
       *
       * `qr_pending` berarti "ada kode di layar, silakan pindai", dan halaman
       * Koneksi memang menampilkan panel QR hanya bila `qrData` ADA. Menulisnya
       * di sini, beberapa detik sebelum kode pertama terbit, menghasilkan
       * halaman yang berkata sedang menunggu dipindai sambil tidak menampilkan
       * apa pun untuk dipindai. Itu persis kebingungan yang membuat tombolnya
       * ditekan berulang: terukur 18 Agustus 2026, `perintah logout diterima`
       * muncul TIGA kali karena tidak ada satu pun tanda bahwa yang pertama
       * sedang dikerjakan.
       *
       * `authenticating` berarti "sedang menautkan", yang memang sedang terjadi,
       * dan ia tetap memenuhi syarat aslinya: status yang sudah tidak benar
       * dikoreksi SEBELUM berkasnya diurus, jadi halaman berhenti menampilkan
       * sesi yang sudah tidak ada. Event `qr` yang menuliskan `qr_pending`
       * berikut gambarnya sekaligus, beberapa detik kemudian.
       */
      await catatTransisiStatus({ status: 'authenticating', phoneNumber: null, qrData: null, lastError: null });

      /**
       * ==================================================================
       * JALUR NORMAL: tautkan ulang DI TEMPAT, QR terbit tanpa restart
       * ==================================================================
       *
       * Versi sebelumnya mengembalikan `'minta-restart'` pada SEMUA jalur --
       * termasuk saat direktorinya sudah bersih. Akibatnya menekan "Keluar
       * sesi" selalu berarti mematikan worker lalu menunggu PM2 melahirkan
       * penggantinya sebelum QR muncul, padahal tidak ada satu pun berkas yang
       * masih perlu dilepas. Ongkosnya tidak kecil di instalasi ini: restart
       * BUKAN operasi rutin di sini (lihat CLAUDE.md "Operasi produksi"), ia
       * punya kemungkinan nyata berakhir tersangkut `menautkan` -- jadi jalan
       * memulihkan sesi justru dibuat melewati satu-satunya operasi yang paling
       * sering menciptakan masalah sesi.
       *
       * Yang membuat penautan di tempat aman justru `logout()` itu sendiri:
       * langkah 2-nya MENUTUP Chromium (lihat `lepasPerangkat()`). Jadi saat
       * baris ini tercapai tidak ada peramban yang hidup, dan `initWaClient()`
       * meluncurkan Chromium SEGAR di atas direktori kosong -- persis keadaan
       * yang diberikan restart, dikurangi kematian prosesnya.
       *
       * Yang MENGAWASI penautan ulangnya tetap watchdog yang sudah ada, bukan
       * mekanisme baru -- `index.ts` menyetel ulang `initSelesai`/`initMulaiAt`
       * sebelum memanggil `initWaClient()`, dan `putusanWatchdog()` membaca
       * keduanya SAAT DIPANGGIL. Jadi penautan ulang yang menggantung dijatuhkan
       * `BATAS_INIT_MS` lewat `shutdown()` sama seperti penautan pertama.
       *
       * ==================================================================
       * MEMINDAHKAN lebih dulu, MENGHAPUS cuma cadangan
       * ==================================================================
       *
       * Versi pertama perbaikan ini menunggu `bersihkanDirektoriSesi()` selesai
       * sebelum menautkan, dan itu terbukti keliru pada percobaan pertama di
       * produksi: penghapusannya gagal sesudah 45 detik penuh, DAN gagal lagi
       * pada start berikutnya walau Chromium belum menyala sama sekali -- yaitu
       * momen yang seluruh rancangan `migrations/054` andaikan bersih.
       *
       * Sebabnya balapan, bukan kunci abadi: percobaan terakhir jatuh di detik
       * ke-36 sementara proses anak Chromium baru melepas handle-nya sekitar
       * detik ke-40. Menaikkan anggarannya berarti memperpanjang penantian yang
       * seharusnya tidak ada -- perangkatnya sudah lepas di langkah pertama
       * `logout()`, dan QR terbukti terbit tiga kali walau berkas lamanya masih
       * utuh. Berkas itu kebersihan, bukan prasyarat.
       *
       * Karena itu urutannya dibalik: SISIHKAN (satu operasi pada satu entri
       * direktori, tidak menuntut satu pun berkas di dalamnya bisa dibuka), lalu
       * tautkan di atas direktori kosong. Penghapusan sisanya menyusul saat
       * worker menyala berikutnya, tanpa menahan apa pun.
       */
      if ((await sisihkanDirektoriSesi()) !== null || (await bersihkanDirektoriSesi())) {
        logger.info({ direktoriTerkunci }, 'sesi lama disingkirkan, menautkan ulang tanpa menyalakan ulang worker');
        return 'tautkan-ulang';
      }

      /**
       * DITITIPKAN ke start berikutnya, bukan dilaporkan sebagai pekerjaan
       * rumah untuk manusia (054).
       *
       * Kalimat yang dulu ditulis di sini -- "Hentikan worker, hapus folder
       * .wwebjs_auth\session, lalu jalankan worker lagi" -- BENAR dan tidak
       * bisa dikerjakan orang yang membacanya: ia muncul di dashboard,
       * sementara jalan keluarnya menuntut shell server plus PM2. Pesan galat
       * yang jalan keluarnya di luar jangkauan pembacanya adalah kegagalan
       * rancangan, bukan keterangan.
       *
       * Mengulang lebih gigih juga bukan jawabannya: selama proses ini hidup,
       * sebagian handle memang tidak akan pernah dilepas. Yang menentukan
       * bukan lamanya menunggu melainkan KAPAN -- dan ada satu momen yang
       * dijamin bersih, yaitu saat worker MULAI sebelum Chromium meluncur.
       *
       * Jalur ke sana sudah ada: cabang ini mengembalikan `'minta-restart'`
       * di bawah. Yang hilang cuma niatnya bertahan melewati restart itu, dan
       * itulah yang dititipkan bendera ini.
       *
       * Statusnya di atas tetap `qr_pending` dan tidak diubah lagi di sini --
       * perangkatnya memang sudah lepas.
       */
      await WaSession.update(
        {
          hapusSesiSaatMulai: true,
          lastError:
            'Perangkat sudah dilepas dari WhatsApp. Berkas sesi lama masih dikunci Windows, jadi akan dihapus otomatis saat worker menyala ulang beberapa detik lagi — tidak ada yang perlu dikerjakan.',
        },
        { where: { id: 1 } },
      );

      /**
       * CADANGAN, dan satu-satunya jalur yang masih menuntut restart: berkas
       * sesi lama TETAP terkunci sesudah ~45 detik. Di sini restart bukan
       * pilihan melainkan syarat -- yang memegang handle-nya adalah proses ini
       * sendiri, jadi tidak ada yang bisa dikerjakan sampai ia mati.
       *
       * Tetap BUKAN `await client.initialize()` dari sini, dan alasan aslinya
       * masih berlaku sepenuhnya: baris itu menahan loop perintah selama seluruh
       * penautan, dan penautan yang menggantung DI SINI tidak dijaga watchdog
       * mana pun -- `BATAS_INIT_MS` mengawasi `initSelesai`/`initMulaiAt` yang
       * hidup di `index.ts`. Terukur pada gangguan 15 Agustus 2026: tombol
       * "Keluar sesi" tampak menggantung lima menit sampai `protocolTimeout`.
       *
       * Itu pula sebabnya jalur normal di atas mengembalikan `'tautkan-ulang'`
       * alih-alih menautkan sendiri: yang memanggil `initWaClient()` tetap
       * `index.ts`, satu-satunya tempat kedua bendera itu bisa disetel ulang.
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
