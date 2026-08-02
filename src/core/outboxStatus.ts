/**
 * Daftar status `outbox` beserta pembagiannya menjadi TERMINAL dan AKTIF.
 *
 * Dipisah ke `core/` karena tiga tempat yang berjauhan harus sepakat soal
 * "baris ini masih akan bergerak sendiri atau tidak", dan selama ini masing-
 * masing menafsirkannya sendiri-sendiri:
 *
 * - `worker/dispatcher.ts` memilih baris yang akan dikerjakan
 * - `worker/cleanup.ts` memangkas baris yang sudah selesai urusannya
 * - `app/(dashboard)/ringkasan/queries.ts` menampilkan yang menunggu orang
 *
 * Ketiganya pernah tidak sinkron, dan akibatnya persis kelas kegagalan yang
 * paling mahal di proyek ini: baris yang tidak dikerjakan siapa pun, tidak
 * ditampilkan di mana pun, dan tidak pernah dihapus.
 */

export const OUTBOX_STATUSES = [
  'pending',
  'sending',
  'sent',
  'failed',
  'failed_permanent',
  'skipped_no_contact',
  'skipped_opt_out',
  'expired',
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * Baris yang MASIH akan bergerak sendiri tanpa campur tangan siapa pun.
 *
 * Hanya dua, dan keduanya dipegang dispatcher: `pending` menunggu giliran,
 * `sending` sedang dikerjakan detik ini juga. Tidak ada status "gagal tapi
 * nanti dicoba lagi" -- percobaan ulang bekerja dengan mengembalikan baris ke
 * `pending` berikut `scheduled_at` yang dimundurkan (`dispatcher.ts`), bukan
 * dengan status tersendiri.
 */
export const ACTIVE_OUTBOX_STATUSES = ['pending', 'sending'] as const satisfies readonly OutboxStatus[];

/**
 * Baris yang tidak akan berubah lagi dengan sendirinya.
 *
 * `failed` ikut di sini dan itu bukan kekeliruan: ia ditulis saat percobaan
 * ulang HABIS, dan tidak ada satu pun kode yang mengambilnya kembali. Satu-
 * satunya jalan keluar dari status terminal adalah tombol "Kirim ulang" yang
 * ditekan manusia (`antrean/actions.ts`), yang mengembalikannya ke `pending`.
 */
export const TERMINAL_OUTBOX_STATUSES = [
  'sent',
  'failed',
  'failed_permanent',
  'skipped_no_contact',
  'skipped_opt_out',
  'expired',
] as const satisfies readonly OutboxStatus[];

export type TerminalOutboxStatus = (typeof TERMINAL_OUTBOX_STATUSES)[number];

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_OUTBOX_STATUSES);

export function isTerminalOutboxStatus(status: string): status is TerminalOutboxStatus {
  return TERMINAL_SET.has(status);
}
