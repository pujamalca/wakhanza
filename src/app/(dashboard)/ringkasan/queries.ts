import { QueryTypes } from 'sequelize';
import { db } from '@/db/wakhanza';
import { Outbox, type OutboxStatus } from '@/models';

/**
 * Agregasi untuk halaman Ringkasan. Semuanya menyaring `outbox.created_at`,
 * yaitu kolom yang diindeks `ix_created (status, created_at)` di
 * `migrations/009` -- rentang tanggal apa pun di sini HARUS lewat kolom itu,
 * bukan `sent_at`/`event_at` yang tidak terindeks.
 *
 * Satu definisi hari dipakai konsisten di seluruh halaman: **hari pesan itu
 * masuk antrean**, bukan hari ia berhasil terkirim. Pesan yang muncul pukul
 * 22:00 lalu tertahan jam tenang dan baru terkirim pukul 07:00 keesokan hari
 * tetap dihitung pada hari kejadiannya. Ini mencegah satu pesan tampil di dua
 * hari berbeda tergantung angka mana yang sedang dilihat.
 *
 * Semua tanggal memakai getter/setter Date lokal -- konsisten dengan asumsi
 * seluruh proyek bahwa server RS berzona WIB (lihat core/quietHours.ts).
 */

/** SUM(kondisi) di MariaDB mengembalikan DECIMAL, yang dibaca mysql2 sebagai string. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function startOfDay(daysAgo = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Jumlah baris outbox per status sejak `since`. Status tanpa baris tidak muncul di hasil. */
export async function fetchStatusCounts(since: Date): Promise<Partial<Record<OutboxStatus, number>>> {
  const rows = await db.query<{ status: OutboxStatus; n: unknown }>(
    'SELECT status, COUNT(*) AS n FROM outbox WHERE created_at >= :since GROUP BY status',
    { replacements: { since }, type: QueryTypes.SELECT },
  );
  return Object.fromEntries(rows.map((r) => [r.status, toInt(r.n)]));
}

export interface QueueDepth {
  /** pending + sending, tanpa batas waktu -- ini kedalaman antrean SEKARANG, bukan angka harian. */
  waiting: number;
  /** Bagian dari `waiting` yang jadwal kirimnya masih di masa depan (umumnya tertahan jam tenang). */
  scheduledLater: number;
}

export async function fetchQueueDepth(): Promise<QueueDepth> {
  const [row] = await db.query<{ waiting: unknown; later: unknown }>(
    `SELECT COUNT(*) AS waiting, SUM(scheduled_at > NOW()) AS later
       FROM outbox WHERE status IN ('pending', 'sending')`,
    { type: QueryTypes.SELECT },
  );
  return { waiting: toInt(row?.waiting), scheduledLater: toInt(row?.later) };
}

export interface DayVolume {
  /** 'YYYY-MM-DD' */
  key: string;
  date: Date;
  sent: number;
  failed: number;
}

/**
 * Volume harian untuk grafik. Hanya menghitung pesan yang BENAR-BENAR dicoba
 * kirim: `skipped_*` (tanpa nomor / menolak) dikecualikan supaya kedua segmen
 * batangnya benar-benar membagi habis satu keseluruhan, dan `pending`/`sending`
 * dikecualikan karena hasilnya belum diketahui.
 *
 * Hari tanpa satu pun baris diisi nol, bukan dilewati -- kalau tidak, hari mati
 * (worker berhenti) justru menghilang dari grafik alih-alih terlihat sebagai
 * batang kosong, persis kebalikan dari gunanya grafik ini.
 */
export async function fetchDailyVolume(days: number): Promise<DayVolume[]> {
  const since = startOfDay(days - 1);
  const rows = await db.query<{ d: string; sent: unknown; failed: unknown }>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d,
            SUM(status = 'sent') AS sent,
            SUM(status IN ('failed', 'failed_permanent', 'expired')) AS failed
       FROM outbox
      WHERE created_at >= :since
        AND status IN ('sent', 'failed', 'failed_permanent', 'expired')
      GROUP BY d`,
    { replacements: { since }, type: QueryTypes.SELECT },
  );

  const byKey = new Map(rows.map((r) => [r.d, { sent: toInt(r.sent), failed: toInt(r.failed) }]));
  return Array.from({ length: days }, (_, i) => {
    const date = startOfDay(days - 1 - i);
    const key = dayKey(date);
    const hit = byKey.get(key);
    return { key, date, sent: hit?.sent ?? 0, failed: hit?.failed ?? 0 };
  });
}

export interface TriggerRow {
  code: string;
  total: number;
  sent: number;
}

/**
 * Rincian per jenis pesan. Sengaja disajikan sebagai TABEL, bukan grafik:
 * jumlah jenisnya delapan dan semuanya bermakna -- di atas ~7 kelas, warna
 * berhenti membedakan apa pun dan tabel lebih terbaca.
 */
export async function fetchTriggerBreakdown(since: Date): Promise<TriggerRow[]> {
  const rows = await db.query<{ code: string; total: unknown; sent: unknown }>(
    `SELECT trigger_code AS code, COUNT(*) AS total, SUM(status = 'sent') AS sent
       FROM outbox
      WHERE created_at >= :since
      GROUP BY trigger_code
      ORDER BY total DESC`,
    { replacements: { since }, type: QueryTypes.SELECT },
  );
  return rows.map((r) => ({ code: r.code, total: toInt(r.total), sent: toInt(r.sent) }));
}

/**
 * Kegagalan yang sudah berhenti dicoba ulang sendiri -- ini yang benar-benar
 * menunggu orang.
 *
 * `failed` ikut di sini walau dispatcher tidak menulisnya lagi (sekarang
 * `failed_permanent`, lihat komentar di `dispatcher.ts`). Baris `failed` yang
 * telanjur ada di pemasangan lama adalah justru yang paling perlu muncul:
 * selama ini ia tidak dicoba ulang oleh siapa pun DAN tidak tampil di panel
 * ini, jadi tidak ada satu pun cara untuk mengetahuinya.
 */
export const NEEDS_REVIEW: OutboxStatus[] = ['failed', 'failed_permanent', 'expired'];

export async function fetchRecentProblems(limit: number): Promise<Outbox[]> {
  return Outbox.findAll({
    where: { status: NEEDS_REVIEW },
    order: [['id', 'DESC']],
    limit,
  });
}
