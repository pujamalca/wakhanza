import type { OutboxStatus, WaSessionStatus } from '@/models';
import type { BadgeVariant } from './Badge';

/**
 * Terjemahan istilah mesin ke bahasa yang dibaca petugas.
 *
 * Nilai seperti `skipped_no_contact`, `failed_permanent`, atau `QUEUE_REG`
 * adalah kunci enum/kode pemicu -- bentuk yang benar untuk database, log, dan
 * kunci idempoten, tapi tidak untuk petugas pendaftaran yang membuka dashboard.
 * Semua label di sini MURNI presentasi: tidak ada satu pun yang dipakai untuk
 * perbandingan, penyaringan, atau disimpan. Kode aslinya tetap ditampilkan
 * berdampingan (atribut `title` atau kolom terpisah) supaya tiket dukungan dan
 * baris log masih bisa dicocokkan.
 */

export const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = {
  pending: 'Menunggu',
  sending: 'Sedang dikirim',
  sent: 'Terkirim',
  failed: 'Gagal sementara',
  failed_permanent: 'Gagal permanen',
  skipped_no_contact: 'Tanpa nomor',
  skipped_opt_out: 'Menolak (STOP)',
  expired: 'Kedaluwarsa',
};

/** Kalimat penjelas -- dipakai sebagai `title` dan pada keadaan kosong. */
export const OUTBOX_STATUS_HELP: Record<OutboxStatus, string> = {
  pending: 'Sudah masuk antrean, menunggu giliran kirim atau menunggu jam tenang berakhir.',
  sending: 'Sedang dikirim worker saat ini.',
  sent: 'Sudah diserahkan ke WhatsApp.',
  failed: 'Percobaan kirim gagal, masih akan dicoba ulang otomatis.',
  failed_permanent: 'Semua percobaan habis. Perlu ditinjau, bisa dikirim ulang manual.',
  skipped_no_contact: 'Pasien tidak punya nomor yang bisa dipakai. Perbaiki lewat halaman Nomor bermasalah.',
  skipped_opt_out: 'Nomor ini pernah membalas STOP, jadi sengaja tidak dikirimi.',
  expired: 'Kejadiannya sudah terlalu lama saat giliran kirim tiba, jadi dibatalkan agar pasien tidak menerima kabar basi.',
};

/**
 * Pembungkus untuk `Outbox.status`, yang bertipe `CreationOptional<OutboxStatus>`
 * (tipe bermerek Sequelize) dan karena itu tidak bisa dipakai langsung sebagai
 * indeks `Record<OutboxStatus, …>`. Sekalian memberi jalan aman bila suatu saat
 * ada nilai enum baru yang belum punya terjemahan: kodenya ditampilkan apa
 * adanya, bukan `undefined`.
 */
export function outboxStatusLabel(status: string): string {
  return OUTBOX_STATUS_LABEL[status as OutboxStatus] ?? status;
}

export function outboxStatusHelp(status: string): string | undefined {
  return OUTBOX_STATUS_HELP[status as OutboxStatus];
}

/**
 * Cerminan `template.label` yang di-seed di `migrations/002`. Sengaja statis,
 * bukan hasil join ke tabel `template`: halaman Antrean dan Log menampilkan
 * ribuan baris (satu join tambahan per halaman tanpa manfaat), dan `BROADCAST`
 * memang tidak punya baris `template` sama sekali. Kalau admin mengganti
 * `template.label`, yang berubah adalah judul kartu di halaman Template --
 * daftar di sini tetap istilah tetap untuk penamaan jenis pesan.
 */
export const TRIGGER_LABEL: Record<string, string> = {
  BOOK_CONFIRM: 'Konfirmasi booking',
  BOOK_REMIND: 'Pengingat H-1',
  BOOK_CANCEL: 'Booking batal',
  QUEUE_REG: 'Nomor antrian',
  RESULT_READY: 'Hasil penunjang',
  PHARMACY_READY: 'Obat siap',
  BILLING_READY: 'Tagihan',
  BROADCAST: 'Broadcast',
};

/** Kode yang belum dikenal dikembalikan apa adanya, bukan jadi string kosong. */
export function triggerLabel(code: string): string {
  return TRIGGER_LABEL[code] ?? code;
}

export const WA_STATUS_LABEL: Record<WaSessionStatus, string> = {
  disconnected: 'Terputus',
  qr_pending: 'Menunggu pindai QR',
  authenticating: 'Menghubungkan',
  ready: 'Tersambung',
  failed: 'Gagal masuk',
};

export const WA_STATUS_HELP: Record<WaSessionStatus, string> = {
  disconnected: 'Tidak ada sesi WhatsApp aktif. Tidak ada notifikasi yang bisa terkirim.',
  qr_pending: 'Menunggu QR dipindai dari ponsel bernomor notifikasi rumah sakit.',
  authenticating: 'Sesi sedang dipulihkan, biasanya beberapa detik.',
  ready: 'Sesi aktif dan siap mengirim.',
  failed: 'Autentikasi ditolak WhatsApp. Perlu pindai QR ulang.',
};

/**
 * `failed` sebelumnya tidak tertangani di halaman Koneksi (kodenya mencocokkan
 * `auth_failure`, nama EVENT whatsapp-web.js, sedangkan yang tersimpan di
 * `wa_session.status` adalah `failed`) -- akibatnya kegagalan autentikasi
 * tampil abu-abu netral, persis keadaan yang paling perlu terlihat merah.
 */
export function waStatusVariant(status: string): BadgeVariant {
  if (status === 'ready') return 'success';
  if (status === 'qr_pending' || status === 'authenticating') return 'warning';
  return 'danger';
}

/** Halaman Koneksi menerima status lewat JSON, jadi tipenya `string` di sana. */
export function waStatusLabel(status: string): string {
  return WA_STATUS_LABEL[status as WaSessionStatus] ?? status;
}

export function waStatusHelp(status: string): string | undefined {
  return WA_STATUS_HELP[status as WaSessionStatus];
}

export const SEND_OUTCOME_LABEL: Record<'sent' | 'error', string> = {
  sent: 'Terkirim',
  error: 'Gagal',
};
