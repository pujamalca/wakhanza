import { Op } from 'sequelize';
import { NextResponse } from 'next/server';
import { WaSession, WaSessionEvent } from '@/models';
import { requireSession } from '@/lib/authz';

/**
 * Jendela penghitungan percobaan. Cukup panjang untuk memperlihatkan POLA
 * (penautan yang gagal berulang tiap ~3,5 menit menghasilkan 4-5 di dalamnya),
 * cukup pendek untuk tidak menghitung gangguan pagi tadi sebagai gangguan
 * sekarang.
 */
const JENDELA_PERCOBAAN_MENIT = 15;

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  const row = await WaSession.findByPk(1);

  /**
   * Dua angka yang membuat halaman berhenti cuma berkata "Menghubungkan".
   *
   * Keduanya sudah ada di `wa_session_event` sejak migrations/037 dan tidak
   * pernah dibaca halaman ini -- sehingga penautan yang sudah gagal empat belas
   * kali tampak persis sama dengan yang baru dimulai delapan detik lalu.
   *
   * `sejak` datang dari riwayat TRANSISI dan bukan dari `wa_session` sendiri:
   * baris itu ditimpa di tempat, jadi ia tidak menyimpan kapan status yang
   * sekarang mulai berlaku. Riwayatnya insert-only, jadi baris terakhir dengan
   * `status_baru` yang sama persis adalah jawabannya.
   */
  const [mulai, percobaan] = row
    ? await Promise.all([
        WaSessionEvent.findOne({ where: { statusBaru: row.status }, order: [['id', 'DESC']] }),
        WaSessionEvent.count({
          where: {
            statusBaru: 'authenticating',
            createdAt: { [Op.gte]: new Date(Date.now() - JENDELA_PERCOBAAN_MENIT * 60_000) },
          },
        }),
      ])
    : [null, 0];

  return NextResponse.json({
    status: row?.status ?? 'disconnected',
    qrData: row?.qrData ?? null,
    qrIssuedAt: row?.qrIssuedAt ?? null,
    phoneNumber: row?.phoneNumber ?? null,
    heartbeatAt: row?.heartbeatAt ?? null,
    lastError: row?.lastError ?? null,
    /** Kapan status yang sekarang mulai berlaku. null bila riwayatnya sudah dipangkas. */
    statusSejak: mulai?.createdAt ?? null,
    percobaanMenautkan: percobaan,
    jendelaPercobaanMenit: JENDELA_PERCOBAAN_MENIT,
  });
}
