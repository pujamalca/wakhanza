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
