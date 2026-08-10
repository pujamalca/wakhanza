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

  const hasil = await sendAlert({
    kind: 'test',
    message: 'Uji coba peringatan dari wakhanza.',
    detail: 'Bila pesan ini sampai, jalur peringatan gangguan sudah berfungsi.',
  });

  // Alasannya ikut ke audit_log, bukan cuma ke layar: yang menyetel webhook dan
  // yang nanti bertanya "kenapa peringatan tidak pernah datang" sering bukan
  // orang yang sama, dan layar hasil uji hilang begitu halamannya ditutup.
  await logAudit(
    session!.user.username,
    'alert_webhook_test',
    undefined,
    hasil.terkirim ? 'terkirim' : `gagal terkirim -- ${hasil.alasan ?? 'tanpa keterangan'}`,
  );

  // Alasannya DITAMPILKAN, tidak lagi ditunda ke log worker. Sebabnya satu
  // kejadian nyata: URL bot Telegram tanpa "/sendMessage" menjawab HTTP 404,
  // angka yang sudah dipegang `sendAlert()` satu baris sebelumnya -- sementara
  // layar cuma menyuruh membuka log, yaitu berkas yang staf tidak punya akses
  // ke sana. Pesan galat yang menyembunyikan jawabannya sendiri sama saja
  // dengan tidak ada pesan galat.
  return hasil.terkirim
    ? { ok: true, message: 'Terkirim. Periksa penerimanya sekarang -- kalau tidak ada yang masuk, URL-nya sah tapi salah tujuan.' }
    : { ok: false, message: `Gagal terkirim. ${hasil.alasan ?? 'Periksa log worker untuk alasannya.'}` };
}
