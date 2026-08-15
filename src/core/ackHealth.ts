/**
 * Keputusan "apakah pesan yang berstatus terkirim ternyata tidak pergi ke mana
 * pun".
 *
 * Ada karena gangguan 15 Agustus 2026, dan bentuk gangguannya adalah yang
 * paling menyesatkan yang mungkin: sesi WhatsApp terautentikasi, `wa_session`
 * berbunyi `ready`, denyut segar, `getState()` menjawab, `window.WWebJS`
 * tersuntik, PM2 online, dispatcher melaporkan `sent` dalam 17-27 ms, dan
 * `send_log` nol galat. Setiap indikator yang dipunyai sistem ini hijau. Yang
 * tidak terjadi cuma satu: pesannya tidak pernah sampai ke WhatsApp. Ia dibuat
 * di dalam Chromium (karena itu `wa_message_id` terisi lewat `message_create`)
 * lalu diam di sana.
 *
 * Yang membuatnya tidak tertangkap apa pun: ketiga sinyal kesiapan mengukur
 * hal-hal DI SEKITAR pengiriman, tidak satu pun mengukur pengirimannya sendiri.
 * `isWaReady()` membaca keadaan HISTORIS di database, `getState()` membaca model
 * soket milik WhatsApp SENDIRI (yang selamat dari kerusakan state sesi kita),
 * `tungguHalamanSiap()` menjajaki objek suntikan pustakanya, dan
 * `max_memory_restart` buta pada keturunan Chromium. Satu-satunya yang
 * membedakan sehat dari rusak sudah ada di `outbox` sejak `migrations/035`:
 * kolom `ack_level`, yang tidak pernah dibaca siapa pun untuk menilai kesehatan.
 *
 * ==========================================================================
 * Kenapa ini fungsi MURNI dan terpisah
 * ==========================================================================
 *
 * Keadaan yang paling perlu dipatok mustahil dibuat lewat database: "sesi siap
 * tapi tidak satu pun pesan mendapat kabar" menuntut sesi WhatsApp sungguhan
 * yang rusak dengan cara tertentu, dan merusaknya berarti mematikan notifikasi
 * pasien lebih dulu. Pola yang sama dengan `core/inboundHealth.ts`,
 * `core/watchdog.ts`, dan `core/suratOtomatis.ts`.
 *
 * Salahnya juga mahal di KEDUA arah, persis seperti `inboundHealth`: peringatan
 * palsu membuat orang berhenti membacanya, sementara diam saat benar-benar
 * buntu adalah pemadaman sepanjang malam yang sudah pernah terjadi.
 */

/**
 * Berapa lama sebuah pesan boleh belum berkabar sebelum dianggap janggal.
 *
 * DIUKUR, bukan dipilih: atas 14 hari kiriman ke grup, ack tingkat 1 (sampai ke
 * server WhatsApp) tiba paling lambat **44 detik** sesudah terkirim. Sepuluh
 * menit memberi tiga belas kali lipat ruang -- cukup lebar untuk memaafkan
 * jaringan yang berkedip, cukup sempit untuk menangkap pemadaman jauh sebelum
 * ia berumur semalaman.
 *
 * Bandingkan sesudah pemulihan: ack tiba dalam **1 detik**.
 */
export const AMBANG_BUNTU_MENIT = 10;

/**
 * Hanya pesan dalam satu jam terakhir yang dinilai, dan batas ini WAJIB ada.
 *
 * Tanpanya, worker yang sudah siap berhari-hari mengumpulkan ratusan pesan
 * lama yang sebagiannya pasti pernah berkabar -- dan satu saja di antaranya
 * cukup untuk membuat penilaian di bawah selamanya berbunyi "normal", termasuk
 * pada detik sistemnya benar-benar buntu. Jendela yang bergerak membuat
 * pertanyaannya tetap "apakah pipa ini hidup SEKARANG", bukan "apakah ia pernah
 * hidup".
 */
export const JENDELA_PANTAU_MENIT = 60;

/**
 * Satu pesan yang tersangkut bisa saja kebetulan; dua tidak.
 *
 * Diperiksa terhadap insiden yang melahirkan berkas ini: pukul 07:52 sudah ada
 * dua pesan jatuh tempo tanpa kabar (07:37 dan 07:41), jadi ambang ini akan
 * berbunyi sekitar waktu yang sama dengan saat seorang manusia menyadarinya --
 * bedanya, ia berbunyi juga pada jam yang tidak ada manusianya.
 */
export const MIN_JATUH_TEMPO = 2;

export interface AckHealthInput {
  /**
   * Pesan yang SEHARUSNYA sudah punya kabar: dikirim sesudah sesi ini siap,
   * masih di dalam jendela pantau, sudah lewat ambang, dan punya
   * `wa_message_id`.
   *
   * Ketiga syarat pertama menyingkirkan sumber positif palsu yang terbesar, dan
   * itu terukur: dari 783 kiriman ke grup dalam 14 hari, **395 tidak pernah
   * mendapat ack sama sekali** -- bukan karena rusak, melainkan karena ack cuma
   * tiba selama sesi yang mengirimnya masih hidup, sementara worker dimulai
   * ulang berkali-kali. Menilai pesan yang dikirim sesi SEBELUMNYA berarti
   * mengalarmkan keadaan yang paling lazim di sistem ini.
   *
   * Syarat keempat menutup sumber kedua: pesan tanpa `wa_message_id` tidak
   * akan pernah bisa dicocokkan dengan event ack-nya, jadi ia diam selamanya
   * apa pun kesehatan sesinya. Itu masalah tersendiri (sudah bersuara sebagai
   * `warn` di `wa-client.ts`), bukan masalah yang dijaga di sini.
   */
  jatuhTempo: number;
  /** Bagian dari `jatuhTempo` yang benar-benar mendapat kabar. */
  berkabar: number;
  /**
   * Sesi sedang `ready`. Di luar itu penilaian ini TIDAK berlaku -- sesi yang
   * memang belum tertaut sudah punya penjaganya sendiri (`sessionWatchdog`),
   * dan mengalarmkannya dua kali cuma menggandakan kebisingan tanpa menambah
   * satu pun informasi.
   */
  sesiReady: boolean;
}

export type AckHealth =
  /** Tidak bisa dinilai: sesinya sendiri sedang tidak siap. */
  | 'tidak-terpantau'
  /** Belum cukup pesan jatuh tempo untuk menyimpulkan apa pun. */
  | 'sepi'
  /** Ada yang berkabar -- pipanya hidup. */
  | 'normal'
  /** Semua jatuh tempo, tidak satu pun berkabar. Inilah tanda tangan gangguannya. */
  | 'buntu';

/**
 * Satu kabar saja sudah cukup untuk memvonis "normal", dan itu disengaja.
 *
 * Yang dijaga fungsi ini SATU mode kegagalan: pipa yang mati seluruhnya. Begitu
 * ada satu pesan yang sampai, mode itu terbantah -- pesan lain yang tersangkut
 * punya sebab per-penerima (ponsel mati, nomor tidak aktif) yang tidak bisa
 * dibedakan dari sini dan tidak dipulihkan oleh tindakan apa pun yang akan
 * disarankan peringatan ini. Melebarkannya jadi "sebagian besar tersangkut"
 * menukar detektor yang sunyi dan tepat dengan detektor yang sering berbunyi
 * untuk hal yang tidak bisa ditindaklanjuti -- dan peringatan yang tidak bisa
 * ditindaklanjuti adalah peringatan yang berhenti dibaca.
 */
export function ackHealth(input: AckHealthInput): AckHealth {
  if (!input.sesiReady) return 'tidak-terpantau';
  if (input.jatuhTempo < MIN_JATUH_TEMPO) return 'sepi';
  if (input.berkabar > 0) return 'normal';
  return 'buntu';
}
