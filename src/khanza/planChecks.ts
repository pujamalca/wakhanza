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

/**
 * Ambang `rows` untuk pemicu yang memindai JENDELA 30 HARI atas tabel yang
 * tumbuh seiring jumlah kunjungan: QUEUE_REG (`reg_periksa`), PHARMACY_READY
 * (`resep_obat`), BILLING_READY (`nota_jalan`).
 *
 * Dulu 500, dan angka itu ternyata tidak pernah dikalibrasi terhadap volume
 * yang hidup. Ia dipilih saat `SIK_DB_NAME` masih menunjuk salinan lama yang
 * berisi **2 registrasi dalam 30 hari terakhir** -- seluruh 34.237 barisnya
 * riwayat yang sudah berhenti bertambah. Jendela 30 harinya praktis kosong,
 * jadi ambang berapa pun akan lolos.
 *
 * Diukur terhadap database produksi (3 Agustus 2026): 652 / 668 / 642 baris
 * dalam jendela yang sama, laju 18-42 registrasi per hari. Jalur aksesnya
 * TIDAK berubah -- ketiganya tetap `type=range` lewat `PRIMARY`/`tanggal`;
 * yang bertambah cuma isi jendelanya.
 *
 * 3000 dipilih supaya tetap berteriak pada kejutan sungguhan (~100 kunjungan
 * per hari berkelanjutan, lebih dari dua kali hari tersibuk yang pernah
 * terlihat) tanpa jadi gagal rutin yang lama-lama diabaikan orang -- dan
 * ambang yang diabaikan sama saja dengan tidak ada ambang. Ia tetap jauh di
 * bawah pemindaian penuh `reg_periksa` (12.100 baris dan bertambah ~870 per
 * bulan), jadi regresi jalur akses tetap tertangkap -- di samping pemeriksaan
 * `type=ALL` dan `key=NULL` yang memang penjaga utamanya.
 *
 * Kalau ini gagal lagi: ukur ulang volumenya lebih dulu. Naik karena rumah
 * sakit makin ramai itu wajar dan cukup dinaikkan berikut angka barunya; naik
 * tanpa kenaikan volume berarti query atau indeksnya yang berubah, dan ITU
 * yang tidak boleh dinaikkan begitu saja.
 */
export const MAX_ROWS_JENDELA_30_HARI = 3000;

const registry: PlanCheck[] = [];

export function registerPlanCheck(check: PlanCheck): void {
  registry.push(check);
}

export function allPlanChecks(): readonly PlanCheck[] {
  return registry;
}
