/**
 * ARCHITECTURE §4.8: rencana query diperlakukan sebagai uji regresi. Tiap
 * modul di src/khanza/ mendaftarkan query poller-nya di sini lewat
 * registerPlanCheck() — bukan ditulis terpisah dari query yang benar-benar
 * dipakai, supaya tidak ada risiko keduanya diam-diam berbeda.
 */
export interface PlanCheck {
  /** Nama pemicu, mis. 'QUEUE_REG'. Dipakai sebagai label di output verify:plans. */
  name: string;
  sql: string;
  replacements: Record<string, unknown>;
  /**
   * Alias tabel (sebagaimana muncul di kolom `table` EXPLAIN, jadi `b`/`d`/`p0`
   * — bukan nama tabel aslinya) yang BOLEH dipindai penuh.
   *
   * Dulu ini `boolean`, dan bentuk itu terlalu tumpul dalam dua arah sekaligus:
   * satu query biasanya menyentuh banyak tabel, jadi mengizinkan pemindaian
   * pada SATU di antaranya berarti berhenti menjaga SEMUANYA. Query jadwal
   * dokter menyentuh tiga tabel padahal yang memang kecil cuma `dokter`;
   * dengan izin menyeluruh, `jadwal` yang tumbuh bebas ikut tidak terjaga.
   * `maxRows`-nya pun tidak pernah benar-benar jalan -- pemeriksaannya keburu
   * dilewati, jadi jaring pengaman yang tertulis di komentar sebenarnya tidak
   * ada. Sekarang izinnya per tabel, dan `maxRows` berlaku untuk semuanya.
   */
  allowFullScan?: string[];
  /** Ambang rows dari EXPLAIN sebelum dianggap gagal. Default 500. */
  maxRows?: number;
}

const registry: PlanCheck[] = [];

export function registerPlanCheck(check: PlanCheck): void {
  registry.push(check);
}

export function allPlanChecks(): readonly PlanCheck[] {
  return registry;
}
