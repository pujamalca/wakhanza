import { QueryTypes } from 'sequelize';
import { db } from '@/db/wakhanza';
import { Outbox, type OutboxStatus } from '@/models';
import { keSqlUtc, offsetLokalMenit } from '@/core/sqlWaktu';

/**
 * Agregasi untuk halaman Ringkasan. Semuanya menyaring `outbox.created_at`,
 * yaitu kolom TERDEPAN pada indeks `ix_created (created_at, status,
 * trigger_code)` di `migrations/009` -- rentang tanggal apa pun di sini HARUS
 * lewat kolom itu, bukan `sent_at`/`event_at` yang tidak terindeks.
 *
 * Satu definisi hari dipakai konsisten di seluruh halaman: **hari pesan itu
 * masuk antrean**, bukan hari ia berhasil terkirim. Pesan yang muncul pukul
 * 22:00 lalu tertahan jam tenang dan baru terkirim pukul 07:00 keesokan hari
 * tetap dihitung pada hari kejadiannya. Ini mencegah satu pesan tampil di dua
 * hari berbeda tergantung angka mana yang sedang dilihat.
 *
 * Semua tanggal memakai getter/setter Date lokal -- konsisten dengan asumsi
 * seluruh proyek bahwa server RS berzona WIB (lihat core/quietHours.ts).
 *
 * ==========================================================================
 * TIDAK PERNAH menyerahkan `Date` ke `replacements` -- selalu `keSqlUtc()`
 * ==========================================================================
 *
 * Kolom-kolomnya menyimpan UTC, sementara `Date` yang diserahkan lewat
 * `replacements` diserialisasi ke waktu LOKAL, sehingga setiap batas meleset
 * tepat tujuh jam. Terukur pada berkas ini sebelum diperbaiki: "24 jam
 * terakhir" pada `fetchInboundActivity()` sebenarnya menghitung 17 jam, dan
 * "hari ini" sebenarnya dimulai pukul 07:00 WIB, bukan tengah malam. Yang
 * kedua nyaris tak pernah terlihat cuma karena jam tenang mengosongkan justru
 * jendela 00:00-07:00 -- kebetulan, bukan kebenaran. Lihat `core/sqlWaktu.ts`
 * untuk pengukurannya dan untuk kenapa jalur model Sequelize tidak terkena.
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
    { replacements: { since: keSqlUtc(since) }, type: QueryTypes.SELECT },
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
  /**
   * Offset WAJIB, dan ketiadaannya adalah bug KEDUA yang berdiri sendiri dari
   * batas `since`. `created_at` menyimpan UTC, jadi mengelompokkannya apa
   * adanya menghasilkan ember per hari UTC sementara `dayKey()` di bawah
   * menghasilkan kunci per hari LOKAL. Keduanya lalu dicocokkan lewat `Map`.
   *
   * Akibatnya bukan galat melainkan pergeseran: pesan yang lahir antara 00:00
   * dan 07:00 WIB jatuh ke ember hari SEBELUMNYA -- dan karena kunci yang tidak
   * ketemu diisi nol, batangnya tampak wajar. Poller berjalan 24 jam, jadi
   * pendaftaran dini hari memang ada.
   */
  const rows = await db.query<{ d: string; sent: unknown; failed: unknown }>(
    `SELECT DATE_FORMAT(created_at + INTERVAL :offsetMenit MINUTE, '%Y-%m-%d') AS d,
            SUM(status = 'sent') AS sent,
            SUM(status IN ('failed', 'failed_permanent', 'expired')) AS failed
       FROM outbox
      WHERE created_at >= :since
        AND status IN ('sent', 'failed', 'failed_permanent', 'expired')
      GROUP BY d`,
    // Penggeseran ada di SELECT/GROUP BY, bukan di WHERE -- `created_at` di
    // WHERE tetap telanjang sehingga `ix_created` tetap terpakai.
    { replacements: { since: keSqlUtc(since), offsetMenit: offsetLokalMenit(since) }, type: QueryTypes.SELECT },
  );

  const byKey = new Map(rows.map((r) => [r.d, { sent: toInt(r.sent), failed: toInt(r.failed) }]));
  return Array.from({ length: days }, (_, i) => {
    const date = startOfDay(days - 1 - i);
    const key = dayKey(date);
    const hit = byKey.get(key);
    return { key, date, sent: hit?.sent ?? 0, failed: hit?.failed ?? 0 };
  });
}

export interface InboundActivity {
  /** Pesan masuk perorangan yang tercatat 24 jam terakhir. */
  last24h: number;
  /** Kapan pesan masuk TERAKHIR tercatat, kapan pun itu. null = belum pernah sama sekali. */
  lastAt: Date | null;
  /**
   * Menit sejak pesan masuk terakhir. null bila belum pernah ada.
   *
   * Dihitung DI SINI, bukan di komponen: `Date.now()` di badan komponen React
   * adalah nilai yang berubah tiap render dan ditolak aturan lint
   * `react-hooks/purity`. Komponennya jadi murni presentasi -- sekaligus alasan
   * kenapa aturan itu ada.
   */
  minutesSinceLast: number | null;
  /** Bagian dari `last24h` yang tidak cocok aturan mana pun -- bahan menyetel kata kunci. */
  unmatched24h: number;
}

/**
 * Lalu lintas MASUK, dan ini satu-satunya angka di halaman ini yang menjawab
 * pertanyaan "apakah kita masih bisa MENDENGAR pasien".
 *
 * Ada karena bug LID: WhatsApp memindahkan pengalamatan ke `@lid` dan setiap
 * pesan pasien dibuang di baris kedua listener selama berjam-jam. Gejalanya
 * yang paling menyesatkan yang mungkin -- PM2 online, sesi `ready`, kirim
 * keluar normal, balasan otomatis menyala, aturan benar -- dan SEMUA indikator
 * di halaman ini tetap hijau, karena semuanya mengukur arah keluar. Yang
 * membedakan sehat dari rusak cuma satu: `auto_reply_log` nol baris, dan tidak
 * ada satu pun tempat yang menampilkannya.
 *
 * Dihitung dari `auto_reply_log` (dicatat untuk SETIAP pesan masuk perorangan,
 * termasuk yang tidak cocok aturan) bukan dari `outbox` -- pertanyaan pasien
 * yang tidak dibalas justru TIDAK meninggalkan jejak di `outbox` sama sekali,
 * jadi menghitung dari sana akan buta persis pada kasus yang perlu dilihat.
 *
 * `lastAt` tanpa batas waktu supaya "sepi hari ini" bisa dibedakan dari "tidak
 * pernah menerima apa pun sejak dipasang" -- yang kedua nyaris pasti kerusakan.
 */
export async function fetchInboundActivity(): Promise<InboundActivity> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db.query<{ n: unknown; unmatched: unknown; last_at: string | null }>(
    `SELECT SUM(created_at >= :since) AS n,
            SUM(created_at >= :since AND outcome = 'no_match') AS unmatched,
            MAX(created_at) AS last_at
       FROM auto_reply_log`,
    { replacements: { since: keSqlUtc(since) }, type: QueryTypes.SELECT },
  );
  const lastAt = row?.last_at ? new Date(row.last_at) : null;
  return {
    last24h: toInt(row?.n),
    unmatched24h: toInt(row?.unmatched),
    lastAt,
    minutesSinceLast: lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 60_000) : null,
  };
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
    { replacements: { since: keSqlUtc(since) }, type: QueryTypes.SELECT },
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
