import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { formatSqlDate } from './common';

export type BookingStatus = 'Terdaftar' | 'Belum' | 'Batal' | 'Dokter Berhalangan';

export interface BookingRow {
  no_rkm_medis: string;
  tanggal_periksa: string;
  tanggal_booking: string | null;
  jam_booking: string | null;
  kd_poli: string | null;
  kd_dokter: string | null;
  status: BookingStatus | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_poli: string | null;
  nm_dokter: string | null;
}

/**
 * ARCHITECTURE §4.1/§4.4: booking_registrasi adalah SATU-SATUNYA tabel tanpa
 * jalan keluar dari full scan -- primary key-nya (no_rkm_medis, tanggal_periksa)
 * berawalan nomor rekam medis, bukan tanggal, jadi tidak ada trik pemangkas
 * indeks yang bisa dipakai. Diterima sengaja karena tabel ini kecil (booking
 * mendatang saja) dan pemicu di sini berjalan pada interval yang lebih
 * longgar (SCAN_INTERVAL_MS, §4.7), bukan tiap 60 detik.
 *
 * BOOK_CONFIRM dan BOOK_CANCEL BERBAGI query ini (bukan dua query terpisah):
 * tabel tidak punya updated_at sehingga perubahan status tidak bisa
 * dideteksi lewat watermark (§4.1) -- satu-satunya cara benar adalah
 * memindai ulang seluruh jendela tiap siklus dan membiarkan kunci idempoten
 * (yang menyertakan status untuk BOOK_CANCEL) menentukan apakah pesan baru
 * perlu dikirim. Lihat worker/pollerBooking.ts.
 */
function buildBookingSql() {
  return `
    SELECT b.no_rkm_medis, b.tanggal_periksa, b.tanggal_booking, b.jam_booking, b.kd_poli, b.kd_dokter, b.status,
           p.nm_pasien, p.no_tlp,
           pk.nm_poli,
           d.nm_dokter
    FROM booking_registrasi b
    LEFT JOIN pasien p ON p.no_rkm_medis = b.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = b.kd_poli
    LEFT JOIN dokter d ON d.kd_dokter = b.kd_dokter
    WHERE b.tanggal_periksa >= :today
    ORDER BY b.tanggal_periksa
    LIMIT 1000
  `;
}

export async function pollUpcomingBookings(today: Date = new Date()): Promise<BookingRow[]> {
  return sikSelect<BookingRow>(buildBookingSql(), { today: formatSqlDate(today) });
}

/** BOOK_REMIND (node-cron, IMPLEMENTATION_PLAN 2.3): booking H-1, bukan seluruh jendela mendatang. */
export async function pollBookingsForDate(date: Date): Promise<BookingRow[]> {
  const rows = await pollUpcomingBookings(date);
  const target = formatSqlDate(date);
  return rows.filter((r) => r.tanggal_periksa === target);
}

registerPlanCheck({
  name: 'BOOK_CONFIRM/BOOK_CANCEL',
  sql: buildBookingSql(),
  replacements: { today: formatSqlDate(new Date()) },
  // Alias `b` = booking_registrasi, satu-satunya pemindaian penuh yang
  // disengaja di kelas pemicu ini (§4.4). Tabel lain di query yang sama tetap
  // dijaga -- dulu izin ini menyeluruh dan ikut membebaskan mereka.
  allowFullScan: ['b'],
  maxRows: 5000,
});
