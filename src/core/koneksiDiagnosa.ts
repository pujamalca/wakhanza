/**
 * Menjelaskan APA YANG SEDANG TERJADI pada sesi yang belum siap.
 *
 * `/koneksi` selama ini cuma menampilkan lencana status. Saat penautan
 * menggantung, yang terbaca staf tinggal kata "Menghubungkan" -- selama berjam-
 * jam, tanpa satu pun tanda apakah ia sedang berjalan wajar, sudah gagal
 * berulang, atau menunggu sesuatu dari mereka. Terukur pada gangguan 15 Agustus
 * 2026: penautan gagal empat belas kali berturut-turut selama satu jam, dan
 * halaman itu tampak persis sama pada menit pertama maupun menit keenam puluh.
 *
 * Fungsi murni dan terpisah karena keadaan yang paling perlu dipatok adalah
 * keadaan yang paling mahal dibuat dengan tangan: sesi yang gagal menaut
 * berulang menuntut merusak sesi WhatsApp sungguhan lebih dulu. Pola yang sama
 * dengan `core/inboundHealth.ts`, `core/ackHealth.ts`, dan `core/watchdog.ts`.
 */

/**
 * Penautan yang SEHAT selesai jauh di bawah ini -- terukur 5-13 detik, dan 8
 * detik pada penautan berhasil terakhir yang tercatat. Tiga puluh detik memberi
 * lebih dari dua kali lipat ruang, jadi melewatinya bukan lagi "sedang jalan"
 * melainkan "ada yang tidak beres".
 *
 * Sengaja jauh DI BAWAH `BATAS_INIT_MS` (180 detik): yang di sana batas untuk
 * BERTINDAK, yang di sini batas untuk BERBICARA. Menyamakannya berarti staf
 * baru diberi tahu pada detik worker menyerah -- tiga menit setelah mereka
 * mulai bertanya-tanya.
 */
export const AMBANG_MENAUTKAN_LAMA_DTK = 30;

/** Dua kali masih bisa kebetulan; tiga kali dalam seperempat jam adalah pola. */
export const AMBANG_PERCOBAAN_BERULANG = 3;

export interface DiagnosaInput {
  status: string;
  /** Detik sejak status ini mulai berlaku. null bila tidak diketahui. */
  detikDiStatus: number | null;
  /** Berapa kali sesi masuk fase penautan dalam 15 menit terakhir. */
  percobaanMenautkan: number;
}

export type DiagnosaKoneksi =
  /** Tidak ada yang perlu dikatakan -- sesi siap, atau baru saja mulai. */
  | 'normal'
  /** Sedang menunggu manusia memindai QR. Bukan gangguan. */
  | 'menunggu-pindai'
  /** Menautkan jauh lebih lama dari yang wajar, tapi baru sekali. */
  | 'menautkan-lama'
  /** Gagal menaut berulang -- pola, bukan kebetulan. */
  | 'menautkan-berulang';

export function diagnosaKoneksi(input: DiagnosaInput): DiagnosaKoneksi {
  // `qr_pending` diperiksa LEBIH DULU dan tidak pernah dianggap gangguan: itu
  // sistem yang bekerja benar sambil menunggu orang memindai, dan bisa
  // berjam-jam saat pemasangan pertama. Alasan yang sama membuat
  // `sessionWatchdog()` mengecualikannya dari batas waktu.
  if (input.status === 'qr_pending') return 'menunggu-pindai';
  if (input.status === 'ready') return 'normal';

  // Diperiksa sebelum durasi: percobaan yang berulang selalu terlihat "baru
  // mulai" tepat sesudah restart, jadi mendahulukan durasi akan membuat pola
  // yang sudah satu jam berjalan tampil sebagai penautan yang baru dimulai.
  if (input.percobaanMenautkan >= AMBANG_PERCOBAAN_BERULANG) return 'menautkan-berulang';

  if (input.detikDiStatus !== null && input.detikDiStatus >= AMBANG_MENAUTKAN_LAMA_DTK) return 'menautkan-lama';

  return 'normal';
}

/**
 * APA YANG BISA DILAKUKAN staf pada keadaan itu -- dan yang tidak, berikut
 * sebabnya.
 *
 * ==========================================================================
 * Kenapa ini perlu ada: ketiga jalan keluar bisa DIAM sekaligus
 * ==========================================================================
 *
 * Terjadi sungguhan 17 Agustus 2026. Sesi tersangkut di fase penautan sejak
 * pukul 13.41, dan staf mencoba ketiga hal yang tersedia -- menunggu, "Sambung
 * ulang", lalu "Keluar sesi". Ketiganya tidak berespons, dan halaman ini tidak
 * mengatakan apa pun tentang itu; yang terlihat cuma dua tombol yang ditekan
 * lalu tidak terjadi apa-apa.
 *
 * Ketiganya diam BUKAN karena kebetulan, melainkan karena masing-masing
 * memang tidak bisa bekerja pada keadaan itu:
 *
 *   Menunggu       tiap percobaan berbatas `BATAS_INIT_MS` lalu diulang dari
 *                  nol. Menunggu mengulang balapan yang sama, bukan mengubah
 *                  peluangnya.
 *   Sambung ulang  BEKERJA (perintahnya dibaca selama menautkan) tapi ia
 *                  membatalkan percobaan yang sedang berjalan lalu memulai
 *                  yang baru -- jadi ditekan berulang, ia justru mencegah
 *                  percobaan mana pun sempat selesai.
 *   Keluar sesi    TIDAK BISA. `logout()` menuntut halaman yang sudah jadi,
 *                  sementara loop `session-command` sengaja tidak dinaikkan ke
 *                  atas `initWaClient()`. Perintahnya tersimpan menunggu sesi
 *                  hidup, yang justru tidak akan pernah terjadi. Kunci mati.
 *
 * Murni dan terpisah dengan alasan yang sama seperti `diagnosaKoneksi()` di
 * atas: keadaan yang paling perlu dipatok adalah yang paling mahal dibuat
 * dengan tangan.
 */
export interface KendaliKoneksi {
  bisa: boolean;
  /** Kenapa tidak bisa, atau apa akibatnya bila tetap ditekan. null = tanpa catatan. */
  catatan: string | null;
}

export interface TindakanKoneksi {
  sambungUlang: KendaliKoneksi;
  keluarSesi: KendaliKoneksi;
  /** Langkah yang BENAR-BENAR berlaku untuk keadaan ini, berurutan. Kosong = tidak ada yang perlu dikerjakan. */
  langkah: string[];
}

const TANPA_CATATAN: KendaliKoneksi = { bisa: true, catatan: null };

export function tindakanKoneksi(diagnosa: DiagnosaKoneksi): TindakanKoneksi {
  if (diagnosa === 'menunggu-pindai') {
    return {
      sambungUlang: {
        bisa: false,
        catatan:
          'Menekannya menerbitkan kode QR BARU dan membatalkan yang sedang ditatap petugas. Pindai dulu kode yang tampil.',
      },
      keluarSesi: TANPA_CATATAN,
      langkah: [],
    };
  }

  if (diagnosa === 'menautkan-lama' || diagnosa === 'menautkan-berulang') {
    return {
      sambungUlang: {
        bisa: true,
        catatan:
          'Ia MEMBATALKAN percobaan yang sedang berjalan lalu memulai dari nol. Ditekan berulang, ia justru mencegah percobaan mana pun sempat selesai. Tekan paling banyak sekali, lalu biarkan satu percobaan penuh berjalan.',
      },
      keluarSesi: {
        bisa: false,
        catatan:
          'Tidak bisa dikerjakan selama penautan belum selesai: keluar sesi menuntut halaman WhatsApp yang sudah jadi, dan perintahnya baru dijalankan setelah sesi hidup — yang justru belum terjadi. Perintahnya akan tersimpan tanpa pernah berjalan.',
      },
      langkah: [
        'Jangan tekan tombol apa pun dulu. Biarkan SATU percobaan berjalan utuh sampai worker menyerah sendiri (3 menit) lalu mencoba lagi.',
        'Kalau sesudah beberapa percobaan tetap tidak tersambung, hentikan worker lewat PM2, tutup Chromium yang memegang direktori sesi, lalu nyalakan lagi. Ini yang membebaskan Chromium yang membengkak — PM2 tidak bisa melihat memori Chromium, jadi ia tidak pernah menyalakannya ulang sendiri.',
        'Kalau masih juga, barulah pindahkan direktori sesi lalu pindai QR ulang. Langkah ini menuntut ponsel bernomor rumah sakit ada di tangan, jadi ia yang TERAKHIR — bukan yang pertama.',
      ],
    };
  }

  return { sambungUlang: TANPA_CATATAN, keluarSesi: TANPA_CATATAN, langkah: [] };
}
