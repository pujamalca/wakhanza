/**
 * Satuan waktu: yang DISIMPAN milidetik, yang DIBACA petugas detik.
 *
 * Milidetik adalah satuan yang benar untuk mesin -- `send_log.duration_ms`
 * diisi `Date.now() - startedAt`, dan `polling.interval_ms` diserahkan apa
 * adanya ke `setTimeout`. Tapi tidak ada petugas yang membaca "311 ms" lalu
 * berpikir "0,3 detik"; yang ia baca cuma angka besar tanpa rasa besaran.
 * "300000" untuk interval pindai lebih buruk lagi: butuh menghitung nol untuk
 * tahu itu lima menit.
 *
 * Karena itu konversinya ditaruh di BATAS TAMPILAN saja. Kunci `app_setting`
 * tetap `*_ms`, isinya tetap milidetik, dan worker (`getSettingNumber`) tetap
 * membacanya persis seperti sebelumnya -- mengubah satuan yang tersimpan berarti
 * migrasi, perubahan worker, dan nilai `audit_log` lama yang tiba-tiba berarti
 * lain. Yang berubah hanya angka yang tampil di layar.
 */

/**
 * Durasi satu percobaan kirim untuk halaman Log.
 *
 * Satu desimal di bawah 10 detik (kisaran nyata satu kirim WhatsApp: ratusan
 * milidetik sampai beberapa detik), bilangan bulat di atasnya -- "12,3 s" tidak
 * memberi informasi apa pun yang tidak diberikan "12 s". Yang lebih cepat dari
 * satu desimal terkecil ditulis "<0,1 s", bukan dibulatkan jadi "0,0 s" yang
 * terbaca seperti nol/gagal.
 */
export function formatDurationSeconds(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (safe === 0) return '0 s';
  if (safe < 50) return '<0,1 s';
  if (safe < 10_000) return `${(safe / 1000).toFixed(1).replace('.', ',')} s`;
  return `${Math.round(safe / 1000)} s`;
}

/** Hanya angka desimal positif; tanda minus & notasi lain sengaja tidak cocok. */
const NUMERIC = /^\d+(\.\d+)?$/;

/**
 * Nilai `app_setting` tersimpan (milidetik) -> angka detik yang diketik staf.
 *
 * Nilai yang BUKAN angka dikembalikan apa adanya, dan itu penting: form
 * Pengaturan mengirim ULANG semua kunci saat disimpan, termasuk yang tidak
 * disentuh. Kalau isi tak terduga diubah jadi `0`/`NaN` di sini, membuka
 * halaman lalu menekan Simpan akan diam-diam merusak nilai yang tidak pernah
 * diedit siapa pun.
 */
export function msSettingToSeconds(stored: string): string {
  const trimmed = stored.trim();
  if (!NUMERIC.test(trimmed)) return stored;
  // toFixed(3) membuang galat pembagian float, Number() membuang nol di
  // belakangnya ("60.000" -> 60) supaya kotaknya berisi "60", bukan "60,000".
  return String(Number((Number(trimmed) / 1000).toFixed(3))).replace('.', ',');
}

/**
 * Kebalikan `msSettingToSeconds`. Menerima koma MAUPUN titik sebagai pemisah
 * desimal -- yang ditampilkan memang koma (id-ID), tapi papan ketik dan
 * kebiasaan mengetik angka sering menghasilkan titik, dan menolak salah satunya
 * hanya menghasilkan nilai tersimpan yang salah tanpa pesan galat.
 */
export function secondsToMsSetting(typed: string): string {
  const normalized = typed.trim().replace(',', '.');
  if (!NUMERIC.test(normalized)) return typed;
  return String(Math.round(Number(normalized) * 1000));
}
