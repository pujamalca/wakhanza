/**
 * Keputusan `sessionWatchdog()` sebagai fungsi MURNI -- tanpa database, tanpa
 * WhatsApp, tanpa `process.exit`.
 *
 * Dipisahkan ke sini karena keadaan yang paling perlu dipatok adalah keadaan
 * yang paling mustahil dibuat sengaja di sistem hidup: sesi yang menggantung di
 * tengah penautan, dan sesi yang tersangkut lewat batas waktu. Mensimulasikannya
 * lewat database berarti merusak sesi sungguhan lebih dulu, dan uji yang gagal
 * di tengah meninggalkan worker tanpa sesi. Pola yang sama dengan
 * `core/suratOtomatis.ts` dan `core/userPolicy.ts`.
 *
 * ==========================================================================
 * Kenapa fase MENAUTKAN perlu jadi cabangnya sendiri
 * ==========================================================================
 *
 * `sessionWatchdog()` dulu dipasang SESUDAH `await initWaClient()`, jadi ia
 * tidak pernah ada selama penautan. Akibatnya proses yang menggantung DI DALAM
 * init tidak punya jaring pengaman sama sekali -- terukur pada gangguan 14
 * Agustus 2026: tidak berdenyut, tidak diawasi, dan tidak bisa menerima perintah
 * dari dashboard. Yang menyudahinya cuma `protocolTimeout` puppeteer, dan itu
 * jatuh ke `main().catch()` -> `process.exit(1)` TANPA lewat `shutdown()`:
 * Chromium mati mendadak di tengah menulis state sesi, sehingga start berikutnya
 * menggantung juga. Loop yang memberi makan dirinya sendiri.
 *
 * Karena itu fase penautan dijaga TERPISAH dari sesi yang sudah tertaut, dengan
 * batas waktunya sendiri yang lebih pendek daripada `protocolTimeout`. Yang
 * dibeli bukan kecepatan matinya melainkan CARA matinya: lewat `shutdown()`,
 * yang menutup Chromium dengan rapi sehingga instance berikutnya mewarisi state
 * sesi yang utuh.
 *
 * Menyatukannya dengan batas 15 menit milik sesi yang sudah tertaut TIDAK bisa,
 * dan bukan soal angka: selama penautan, `wa_session.status` di database masih
 * milik proses SEBELUMNYA -- bisa saja `ready`. Cabang `ready` memanggil
 * pemeriksaan kesehatan terhadap klien yang belum jadi, dan hasilnya bukan
 * "sehat" atau "sakit" melainkan galat yang tidak ada hubungannya dengan
 * pertanyaannya.
 */

/**
 * `qr_pending` SENGAJA dikecualikan dari batas waktu: itu bukan macet melainkan
 * sistem yang benar sedang menunggu manusia memindai QR -- bisa berjam-jam saat
 * pemasangan pertama, dan keluar-lalu-restart di tengahnya justru menerbitkan QR
 * baru sehingga kode yang sedang dipindai petugas jadi kedaluwarsa.
 */
export const STATUS_MENUNGGU_MANUSIA: ReadonlySet<string> = new Set(['qr_pending']);

export type FaseWatchdog = 'menautkan' | 'menunggu-manusia' | 'belum-siap';

export type PutusanWatchdog =
  /** Sesi tertaut dan mengaku `ready`; pastikan Chromium benar-benar menjawab. */
  | { aksi: 'periksa-kesehatan' }
  /** Tidak ada yang perlu dikerjakan sekarang. */
  | { aksi: 'diam'; fase: FaseWatchdog; diamMs: number; setelUlangJamSiap: boolean }
  /** Lewat batas waktu -- keluar lewat `shutdown()`, bukan `process.exit()`. */
  | { aksi: 'keluar'; fase: Exclude<FaseWatchdog, 'menunggu-manusia'>; diamMs: number };

export interface KeadaanWatchdog {
  /** `await initWaClient()` sudah kembali. Selama false, `status` milik proses SEBELUMNYA. */
  initSelesai: boolean;
  /** Sejak `initWaClient()` dipanggil. Diabaikan bila `initSelesai`. */
  msSejakInitMulai: number;
  batasInitMs: number;
  /** `wa_session.status`; null bila barisnya belum pernah ada. */
  status: string | null;
  /** Sejak terakhir sesi berada di keadaan yang sah (ready / menunggu QR). */
  msSejakSiapTerakhir: number;
  batasTidakSiapMs: number;
}

export function putusanWatchdog(k: KeadaanWatchdog): PutusanWatchdog {
  /**
   * Fase penautan diperiksa PALING DULU, dan urutan itu mengikat.
   *
   * Dibalik, `status` yang masih milik proses sebelumnya menentukan cabangnya:
   * `ready` yang basi mengirim watchdog ke pemeriksaan kesehatan atas klien yang
   * belum jadi, dan `authenticating` yang basi membuat jam 15 menit berjalan
   * seolah sesi sudah tertaut padahal belum satu detik pun.
   */
  if (!k.initSelesai) {
    return k.msSejakInitMulai >= k.batasInitMs
      ? { aksi: 'keluar', fase: 'menautkan', diamMs: k.msSejakInitMulai }
      : {
          aksi: 'diam',
          fase: 'menautkan',
          diamMs: k.msSejakInitMulai,
          /**
           * Jam 15 menit disetel ulang sepanjang penautan supaya ia mulai
           * berjalan dari saat sesi benar-benar hidup. Tanpa ini, penautan yang
           * memakan dua menit memotong jatah sesi berikutnya sebanyak itu --
           * dan pemotongan itu paling menggigit persis pada pemasangan pertama,
           * yang memang paling lama.
           */
          setelUlangJamSiap: true,
        };
  }

  if (k.status === 'ready') return { aksi: 'periksa-kesehatan' };

  if (k.status !== null && STATUS_MENUNGGU_MANUSIA.has(k.status)) {
    return { aksi: 'diam', fase: 'menunggu-manusia', diamMs: 0, setelUlangJamSiap: true };
  }

  return k.msSejakSiapTerakhir >= k.batasTidakSiapMs
    ? { aksi: 'keluar', fase: 'belum-siap', diamMs: k.msSejakSiapTerakhir }
    : { aksi: 'diam', fase: 'belum-siap', diamMs: k.msSejakSiapTerakhir, setelUlangJamSiap: false };
}
