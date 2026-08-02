'use server';

import { requireRole } from '@/lib/authz';
import { logAudit } from '@/models';
import { sendAlert, alertWebhookUrl } from '@/worker/alert';

/**
 * Mengirim satu peringatan percobaan ke webhook yang tersimpan.
 *
 * Ada karena webhook yang tidak pernah dicoba sama saja dengan tidak ada: URL
 * salah ketik, bot yang belum diundang ke grup, atau token yang kedaluwarsa
 * semuanya diam sampai gangguan sungguhan datang -- yaitu saat paling buruk
 * untuk menemukannya. Satu klik di halaman Pengaturan menjawabnya sekarang.
 *
 * Dijalankan dari proses WEB, bukan worker. Itu memang bukan proses yang nanti
 * mengirim peringatan sungguhan, tapi yang diuji di sini justru bagian yang
 * bisa berbeda: URL tersimpan, jangkauan jaringan keluar, dan apakah
 * penerimanya menerima. Kedua proses berjalan di mesin yang sama.
 *
 * `kind: 'test'` sengaja DIKECUALIKAN dari jeda antar-peringatan di
 * `sendAlert()` -- staf yang menekan tombol uji dua kali berturut-turut sambil
 * membetulkan URL harus melihat hasilnya, bukan diam karena tertahan jeda.
 */
export async function testAlertWebhookAction(): Promise<{ ok: boolean; message: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { ok: false, message: 'Tidak diizinkan.' };

  if (!(await alertWebhookUrl())) {
    return { ok: false, message: 'URL webhook belum diisi (atau bukan URL http/https). Isi dulu lalu Simpan.' };
  }

  const terkirim = await sendAlert({
    kind: 'test',
    message: 'Uji coba peringatan dari wakhanza.',
    detail: 'Bila pesan ini sampai, jalur peringatan gangguan sudah berfungsi.',
  });

  await logAudit(
    session!.user.username,
    'alert_webhook_test',
    undefined,
    terkirim ? 'terkirim' : 'gagal terkirim',
  );

  return terkirim
    ? { ok: true, message: 'Terkirim. Periksa penerimanya sekarang -- kalau tidak ada yang masuk, URL-nya sah tapi salah tujuan.' }
    : { ok: false, message: 'Gagal terkirim. Periksa log worker untuk alasannya (URL salah, jaringan tertutup, atau penerima menolak).' };
}
