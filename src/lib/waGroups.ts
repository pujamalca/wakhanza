import { WaSession, logAudit } from '@/models';

/**
 * Menitipkan perintah muat-daftar-grup ke worker.
 *
 * Isinya di `lib/` dan bukan di salah satu halaman karena DUA halaman
 * memintanya (`/farmasi` untuk memilih tujuan, `/pesan-masuk` untuk melihat
 * ID-nya). Dua server action yang sama-sama menulis `wa_session.command` adalah
 * duplikasi yang cepat atau lambat berbeda -- mis. satu memeriksa sesi siap dan
 * satunya lupa, sehingga tombol yang satu diam saja saat WhatsApp terputus.
 */
export interface HasilSyncGrup {
  error?: string;
  sukses?: string;
}

export async function mintaSyncGrup(pelaku: string): Promise<HasilSyncGrup> {
  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi daftar grup tidak bisa dibaca. Buka halaman Koneksi dulu.' };
  }

  await WaSession.update({ command: 'sync_groups' }, { where: { id: 1 } });
  await logAudit(pelaku, 'farmasi_sync_grup', 'wa_session', 'diminta');
  // Kedua proses tidak pernah bicara lewat HTTP (ARCHITECTURE §1), jadi
  // hasilnya baru ada setelah worker mengambil perintahnya -- paling lama satu
  // siklus session-command (5 detik). Kalimatnya menyebut itu supaya staf tidak
  // menyimpulkan tombolnya rusak saat daftar belum berubah seketika.
  return { sukses: 'Permintaan dikirim ke worker. Muat ulang halaman ini beberapa detik lagi.' };
}
