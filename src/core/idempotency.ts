import { createHash } from 'node:crypto';

/**
 * ARCHITECTURE §4.2: idempotency_key = SHA1(trigger_code | kunci_alami...).
 * Disisipkan lewat INSERT IGNORE (UNIQUE KEY uq_idem) — deduplikasi terjadi di
 * mesin database, jadi tetap benar walau poller berjalan tumpang tindih.
 *
 * Untuk pemicu kelas pindai (BOOK_CANCEL), sertakan kolom yang berubah
 * (mis. status) sebagai bagian kunci alami: status yang sama -> kunci sama
 * -> INSERT ditolak; status berubah -> kunci baru -> satu pesan baru terkirim.
 */
export function buildIdempotencyKey(triggerCode: string, ...naturalKeyParts: Array<string | number>): string {
  const raw = [triggerCode, ...naturalKeyParts.map(String)].join('|');
  return createHash('sha1').update(raw, 'utf8').digest('hex');
}
