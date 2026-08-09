/**
 * ARCHITECTURE §7: worker memperbarui `wa_session.heartbeat_at` tiap siklus.
 * Lewat ambang ini prosesnya dianggap macet -- ini kegagalan yang paling
 * berbahaya justru karena paling sunyi: `status` bisa tetap tertulis 'ready'
 * selamanya walau prosesnya sudah mati, karena yang menulis status itu ya
 * proses yang mati tersebut.
 *
 * Denyutnya ditulis TANPA SYARAT (lihat loop 'heartbeat' di worker/index.ts).
 * Sebelumnya ia digerbangi kesiapan sesi, sehingga membeku juga saat sesi
 * terputus padahal prosesnya sehat -- dan "basi" karena itu tidak bisa dibedakan
 * dari "sesi bermasalah", dua keadaan yang menuntut tindakan berbeda. Sekarang
 * artinya tunggal dan tajam: **basi = tidak ada proses worker yang hidup.**
 * Status yang tertulis di baris yang sama adalah peninggalan, bukan keadaan
 * sekarang.
 *
 * Memeriksanya langsung lewat CLI `mysql` menuntut `CONVERT_TZ` -- kolomnya UTC
 * sementara `NOW()` WIB, jadi selisih mentahnya meleset 7 jam ke arah yang
 * terbaca seperti worker mati. Lihat catatan lengkapnya di worker/index.ts.
 *
 * Ada di sini, bukan di dalam salah satu komponen, karena halaman Koneksi
 * (klien) dan halaman Ringkasan (server) harus memakai ambang yang sama --
 * dua salinan angka 2 menit akan diam-diam berbeda cepat atau lambat.
 */
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

export function heartbeatStale(heartbeatAt: Date | string | null | undefined): boolean {
  if (!heartbeatAt) return true;
  return Date.now() - new Date(heartbeatAt).getTime() > HEARTBEAT_STALE_MS;
}
