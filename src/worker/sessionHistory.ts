import { WaSession, WaSessionEvent, type WaSessionStatus } from '@/models';
import { logger, safeError } from '@/lib/logger';

/**
 * SATU-SATUNYA titik yang boleh menulis `wa_session.status`.
 *
 * Sebelum ini, lima tempat berbeda (empat di wa-client.ts: qr/authenticated/
 * ready/disconnected/auth_failure, satu di sessionCommand.ts: logout)
 * masing-masing memanggil `WaSession.upsert()`/`update()` sendiri-sendiri --
 * bentuk kegagalan yang sama persis dengan yang sudah dibayar berkali-kali di
 * proyek ini (respectsOptOut(), core/outboxStatus.ts, kunciPesanMasuk(),
 * core/tujuanPemicu.ts): beberapa tempat berjauhan menafsirkan sendiri satu
 * hal yang sama, dan cukup SATU yang lupa diperbarui saat menambah titik
 * transisi baru untuk membuat riwayatnya diam-diam kehilangan baris itu
 * selamanya -- `wa_session_event` insert-only, jadi baris yang tidak pernah
 * ditulis tidak bisa ditambal belakangan.
 *
 * Menulis baris riwayat HANYA saat status benar-benar BERUBAH. Pemanggil yang
 * cuma menyentuh `lastError`/`heartbeatAt`/`command` tanpa mengubah status
 * (mis. `updateHeartbeat()`) sengaja TIDAK lewat sini -- tabel ini riwayat
 * TRANSISI, bukan riwayat setiap sentuhan baris; menyertakan yang tidak
 * berubah akan membanjirnya dengan baris yang tidak menjawab pertanyaan
 * "kapan gateway berpindah keadaan".
 */
export async function catatTransisiStatus(
  patch: { status: WaSessionStatus } & Partial<{
    qrData: string | null;
    qrIssuedAt: Date | null;
    phoneNumber: string | null;
    heartbeatAt: Date;
    lastError: string | null;
    /**
     * Bendera 054. Ikut lewat sini, bukan lewat UPDATE tersendiri, dengan
     * alasan yang sama seperti `status`: penulis kedua adalah cara paling rapi
     * membuat dua tempat menyimpang.
     */
    hapusSesiSaatMulai: boolean;
  }>,
): Promise<void> {
  const sebelum = await WaSession.findByPk(1);
  const statusLama = sebelum?.status ?? null;

  await WaSession.upsert({ id: 1, ...patch });

  if (statusLama === patch.status) return; // tidak berubah -- bukan transisi, tidak dicatat

  await WaSessionEvent.create({ statusLama, statusBaru: patch.status }).catch((err) => {
    // Riwayatnya kehilangan satu baris, tapi wa_session.status di atas SUDAH
    // tertulis benar di atas -- kegagalan di sini murni kehilangan histori,
    // bukan kegagalan operasional, jadi tidak boleh dilempar balik ke
    // pemanggil (event handler whatsapp-web.js yang sinkron).
    logger.warn(
      { ...safeError(err), statusLama, statusBaru: patch.status },
      'gagal mencatat wa_session_event -- status utama tetap tertulis benar',
    );
  });
}
