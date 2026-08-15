import { logger } from '@/lib/logger';
import { bacaPantauAck } from '@/lib/ackPantau';
import { ackHealth, AMBANG_BUNTU_MENIT, JENDELA_PANTAU_MENIT } from '@/core/ackHealth';
import { sendAlert } from './alert';

/**
 * Jaring pengaman KETIGA, dan satu-satunya yang mengukur pengirimannya sendiri.
 *
 * Dua yang sudah ada menjaga keadaan sesi: `sessionWatchdog()` menangkap sesi
 * yang tidak pernah mencapai `ready`, dan `checkHealth()` menangkap Chromium
 * yang menggantung. Keduanya lulus sepanjang gangguan 15 Agustus 2026, dan
 * bukan karena rusak -- keduanya memang menjawab pertanyaan lain. Yang tidak
 * pernah ditanyakan siapa pun: apakah pesan yang kita laporkan `sent` benar-
 * benar sampai ke WhatsApp.
 *
 * =========================================================================
 * SENGAJA TIDAK menyalakan ulang worker -- hanya memperingatkan
 * =========================================================================
 *
 * Ini menyimpang dari kedua watchdog di atas, yang keduanya keluar lewat
 * `shutdown()` dan membiarkan PM2 menyalakan ulang. Tiga alasan, dan yang
 * pertama TERUKUR pada gangguan yang melahirkan berkas ini:
 *
 * 1. **Restart terbukti TIDAK memulihkannya.** Prosedur tiga langkah dijalankan
 *    pagi itu; kedua percobaan penautan sesudahnya gagal, satu di antaranya
 *    dijatuhkan batas init 180 detik. Yang menyudahinya cuma memindahkan
 *    `.wwebjs_auth` lalu memindai QR ulang -- dan itu menuntut akses fisik ke
 *    ponsel nomor RS, sesuatu yang mustahil dilakukan proses mana pun. Restart
 *    otomatis di sini bukan pemulihan, melainkan rentetan restart yang menunda
 *    orang mengetahui apa yang sebenarnya harus dikerjakan.
 *
 * 2. **Menyalakan ulang di tengah sinkronisasi awal justru MERUSAK sesi.** Itu
 *    sebab akarnya sendiri: sesi 14 Agustus terpotong empat kali antara 00:18
 *    dan 00:56, dan kerusakannya baru bergejala keesokan paginya. Detektor yang
 *    salah menuduh lalu menyalakan ulang akan menciptakan persis gangguan yang
 *    ia ada untuk menangkapnya.
 *
 * 3. **Positif palsunya belum berumur.** `sessionWatchdog` menumpang tiga tahun
 *    pengamatan; penilaian ini baru. Memberinya wewenang mematikan proses
 *    sebelum ambangnya terbukti di lapangan adalah menukar kegagalan yang
 *    jarang dengan kegagalan yang sering.
 *
 * Kalau nanti terbukti tidak pernah salah tuduh, memberinya wewenang restart
 * adalah keputusan tersendiri -- dan tetap harus dijawab lebih dulu: restart
 * memulihkan apa, mengingat poin 1.
 */
export async function runAckWatchdog(): Promise<void> {
  const pantau = await bacaPantauAck();
  const kesehatan = ackHealth(pantau);

  if (kesehatan !== 'buntu') {
    logger.debug(
      { kesehatan, jatuhTempo: pantau.jatuhTempo, berkabar: pantau.berkabar },
      'pantau kabar terkirim',
    );
    return;
  }

  const tertua = pantau.tersangkutTertuaMenit;
  logger.error(
    {
      jatuhTempo: pantau.jatuhTempo,
      tersangkutTertuaMenit: tertua,
      ambangMenit: AMBANG_BUNTU_MENIT,
      jendelaMenit: JENDELA_PANTAU_MENIT,
    },
    'sesi berstatus ready tapi tidak satu pun pesan mendapat kabar -- kemungkinan pesan tidak benar-benar terkirim',
  );

  // Jedanya diurus `sendAlert()` per JENIS (bawaan 15 menit), jadi gangguan
  // semalaman tidak menjadi ratusan pesan. Tidak perlu pencatat sendiri.
  await sendAlert({
    kind: 'ack_stuck',
    message: `${pantau.jatuhTempo} pesan berstatus terkirim tapi tidak satu pun mendapat kabar dari WhatsApp dalam ${AMBANG_BUNTU_MENIT} menit terakhir -- sesi kemungkinan tidak benar-benar mengirim.`,
    detail:
      'Sesi tetap berbunyi `ready` pada keadaan ini, jadi menyalakan ulang worker sering TIDAK memulihkannya. Bila memang tidak ada pesan yang sampai: hentikan worker, pindahkan folder .wwebjs_auth, jalankan lagi, lalu pindai QR di /koneksi (butuh ponsel nomor RS).',
  });
}
