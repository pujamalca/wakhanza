/**
 * Pagar watermark: sebuah kursor poller tidak boleh mengaku sudah memproses
 * kejadian yang BELUM TERJADI.
 *
 * ==========================================================================
 * Kenapa ini ada -- kejadian nyata, bukan kehati-hatian
 * ==========================================================================
 *
 * Watermark kelas sisip artinya "semua yang waktunya <= T sudah diproses";
 * siklus berikutnya membaca `TIMESTAMP(...) >= T`. Yang menentukan T adalah
 * waktu kejadian TERBESAR yang terbaca -- dan waktu itu datang dari kolom yang
 * diketik manusia di Khanza (`jam_reg`, `jam`, `jam_penyerahan`), bukan dari
 * jam server.
 *
 * Satu pendaftaran uji dibuat pukul 06:15 dengan `jam_reg` **19:59:46**. Poller
 * membacanya, memajukan watermark ke 19:59:46, dan sejak itu SELURUH
 * pendaftaran hari itu -- 09:11 sampai 17:11, semuanya lebih awal menurut jam
 * dinding -- jatuh di bawah watermark lalu dilewati. Tiga belas pasien tidak
 * menerima nomor antriannya. Tidak ada galat, tidak ada baris `outbox`, dan
 * log-nya melaporkan "siklus polling selesai, rowsSeen 0" setiap 60 detik
 * seolah memang tidak ada yang perlu dikerjakan.
 *
 * Itu bukan kekeliruan yang butuh salah ketik luar biasa: satu digit jam yang
 * meleset pada pendaftaran SUNGGUHAN menghasilkan akibat yang sama, dan
 * membekukan pemicunya sampai tengah malam.
 *
 * ==========================================================================
 * Tiga keputusan yang menempel
 * ==========================================================================
 *
 * 1. **Barisnya TETAP diproses.** Yang dibatasi cuma seberapa jauh watermarknya
 *    maju. Pendaftaran bertanggal maju tetap kunjungan sah dan pasiennya tetap
 *    dikirimi; ia hanya tidak boleh ikut menutup pintu bagi baris di belakangnya.
 *
 * 2. **Boleh MUNDUR, dan itu disengaja.** Kalau kursornya sudah terlanjur
 *    melampaui sekarang (seperti kejadian di atas), menahannya di tempat berarti
 *    pagar ini cuma mencegah dan tidak pernah menyembuhkan -- kerusakannya
 *    tetap berumur sehari penuh. Membaca ulang baris yang sudah diproses aman
 *    karena kunci idempoten menolaknya di mesin database; yang terbuang cuma
 *    beberapa query.
 *
 * 3. **Ada TOLERANSI, dan ia bukan kelonggaran yang malas.** Stempel waktunya
 *    ditulis komputer LAIN (workstation Khanza) dan dibaca di sini, jadi
 *    keduanya tidak pernah persis sama. Tanpa toleransi, selisih jam beberapa
 *    detik yang sepenuhnya normal akan dilaporkan sebagai anomali setiap hari --
 *    dan peringatan yang muncul setiap hari berhenti dibaca, persis alasan level
 *    log dipisah `debug`/`warn` di `wa-client.ts`. Yang perlu ditangkap pagar
 *    ini berjarak jam, bukan detik.
 */

/** Selisih jam antar mesin yang masih dianggap wajar, bukan anomali data. */
export const TOLERANSI_WATERMARK_MS = 5 * 60 * 1000;

export interface HasilBatasWatermark {
  /** Nilai yang boleh disimpan. */
  nilai: Date;
  /**
   * Berapa jauh nilai yang diminta melampaui batas, dalam milidetik.
   * 0 berarti tidak dipotong -- pemanggil memakai ini untuk memutuskan
   * mencatat peringatan atau diam.
   */
  lampauMs: number;
}

export function batasiWatermark(
  diminta: Date,
  sekarang: Date,
  toleransiMs: number = TOLERANSI_WATERMARK_MS,
): HasilBatasWatermark {
  const batas = sekarang.getTime() + Math.max(0, toleransiMs);
  const lampau = diminta.getTime() - batas;
  if (lampau <= 0) return { nilai: diminta, lampauMs: 0 };
  // Dipotong ke SEKARANG, bukan ke batas toleransi: toleransi ada untuk
  // memutuskan "ini anomali atau bukan", bukan untuk jadi tempat kursornya
  // mendarat. Mendaratkannya di sekarang membuat aturannya cuma satu kalimat --
  // kursor tidak pernah melampaui waktu berjalan.
  return { nilai: new Date(sekarang.getTime()), lampauMs: lampau };
}
