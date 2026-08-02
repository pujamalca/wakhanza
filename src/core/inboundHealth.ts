/**
 * Keputusan "apakah sunyinya pesan masuk itu mencurigakan".
 *
 * Fungsi murni dan terpisah dari komponennya karena dua alasan. Pertama, ia
 * tidak bisa diuji lewat database: keadaan yang paling perlu dibuktikan justru
 * "belum pernah menerima apa pun", dan `auto_reply_log` sengaja tidak punya
 * grant UPDATE (baris log tidak pernah ditulis ulang) sehingga baris nyata tak
 * bisa disembunyikan sementara untuk mensimulasikannya. Kedua, ini penilaian
 * yang salahnya mahal di kedua arah -- peringatan palsu tiap malam membuat
 * orang berhenti membacanya, sementara diam saat benar-benar rusak adalah
 * kegagalan 14 jam yang sudah pernah terjadi.
 */

/**
 * Lebih pendek dari ini wajar terjadi: malam hari, akhir pekan, hari libur.
 * Lebih panjang dari sehari penuh tanpa satu pun pesan masuk di nomor yang
 * dipakai pasien jauh lebih sering berarti sistemnya tidak mendengar.
 */
export const AMBANG_SUNYI_MENIT = 24 * 60;

export interface InboundHealthInput {
  /** Pesan masuk perorangan tercatat dalam 24 jam terakhir. */
  last24h: number;
  /** Menit sejak pesan masuk terakhir; null bila belum pernah ada sama sekali. */
  minutesSinceLast: number | null;
  /**
   * Pencatatan pesan masuk hanya berjalan saat balasan otomatis menyala.
   * Saat mati, nol memang nol dan bukan pertanda apa pun -- melaporkannya
   * sebagai kecurigaan akan jadi peringatan palsu yang permanen.
   */
  autoReplyEnabled: boolean;
}

export type InboundHealth =
  /** Tidak bisa dinilai: pencatatannya sedang mati. */
  | 'tidak-terpantau'
  /** Ada lalu lintas masuk dalam 24 jam terakhir. */
  | 'normal'
  /** Sunyi melewati ambang -- patut dicurigai, bukan dipastikan rusak. */
  | 'sunyi';

export function inboundHealth(input: InboundHealthInput): InboundHealth {
  if (!input.autoReplyEnabled) return 'tidak-terpantau';
  if (input.last24h > 0) return 'normal';
  // `null` (belum pernah sama sekali) ikut dihitung sunyi, dan itu justru
  // keadaan paling mencurigakan -- bukan yang paling aman.
  if (input.minutesSinceLast === null) return 'sunyi';
  return input.minutesSinceLast >= AMBANG_SUNYI_MENIT ? 'sunyi' : 'normal';
}
