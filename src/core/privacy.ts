/**
 * F4.3 / ARCHITECTURE §5.2: daftar poli dan jenis pemeriksaan sensitif
 * (VCT/HIV, jiwa, kulit & kelamin, onkologi, dst — keputusan RS, disimpan di
 * app_setting, KOSONG sampai diisi lewat dashboard). Bila pemicu berasal dari
 * salah satunya, seluruh isi pesan diganti template generik yang tidak
 * menyebut poli maupun jenis layanan.
 *
 * Fungsi ini murni — daftar sensitif diberikan sebagai argumen, bukan dibaca
 * dari database di sini (src/core/ tanpa akses DB, lihat ARCHITECTURE §5).
 * Nama pemeriksaan/obat/diagnosis TIDAK diperiksa di sini karena TIDAK PERNAH
 * diambil oleh src/khanza/ sejak awal — larangan ditegakkan lewat struktur
 * (kolom yang tidak pernah dibaca tidak mungkin bocor lewat modul ini).
 */
export interface PrivacyCheckInput {
  kdPoli?: string | null;
  /** Satu kode, atau beberapa kode sekaligus untuk hasil yang digabung (RESULT_READY, §4.3). */
  kdJenisPrw?: string | string[] | null;
}

export interface PrivacyCheckResult {
  safe: boolean;
  reason?: string;
}

export function checkPrivacy(
  input: PrivacyCheckInput,
  sensitivePoliCodes: readonly string[],
  sensitiveExamCodes: readonly string[] = [],
): PrivacyCheckResult {
  if (input.kdPoli && sensitivePoliCodes.includes(input.kdPoli)) {
    return { safe: false, reason: `poli_sensitif:${input.kdPoli}` };
  }

  const examCodes = Array.isArray(input.kdJenisPrw) ? input.kdJenisPrw : input.kdJenisPrw ? [input.kdJenisPrw] : [];
  const hit = examCodes.find((code) => sensitiveExamCodes.includes(code));
  if (hit) {
    return { safe: false, reason: `pemeriksaan_sensitif:${hit}` };
  }

  return { safe: true };
}
