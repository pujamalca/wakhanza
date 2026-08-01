/**
 * ARCHITECTURE §7: worker memperbarui `wa_session.heartbeat_at` tiap siklus.
 * Lewat ambang ini prosesnya dianggap macet -- ini kegagalan yang paling
 * berbahaya justru karena paling sunyi: `status` bisa tetap tertulis 'ready'
 * selamanya walau prosesnya sudah mati, karena yang menulis status itu ya
 * proses yang mati tersebut.
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
