/**
 * Normalisasi nomor telepon Indonesia ke E.164 (628xxxxxxxxx).
 * Aturan dan urutan langkah: ARCHITECTURE §5.1.
 *
 * Sengaja KETAT (rekomendasi IMPLEMENTATION_PLAN §1.1): hanya menerapkan 7
 * langkah yang didokumentasikan, tanpa heuristik tambahan untuk "menyelamatkan"
 * kasus di luar itu. Nomor yang dipaksakan padahal salah mengirim informasi
 * layanan seseorang ke orang lain — halaman koreksi manual (Fase 3) adalah
 * jalan keluar yang aman untuk sisanya, salah tebak di sini tidak.
 *
 * Diverifikasi terhadap sik.pasien nyata (8.117 baris): 12 baris berisi nomor
 * yang rusak jadi notasi ilmiah spreadsheet (mis. "8,13E+11" dari Excel yang
 * mengubah angka panjang) — bukan "dua nomor dipisah /" seperti dugaan awal
 * PRD §10. Setelah pelucutan non-digit, sisa angka dari notasi itu terlalu
 * pendek untuk lolos validasi akhir, jadi ditolak secara alami tanpa perlu
 * deteksi khusus.
 */
export type PhoneRejectReason = 'empty' | 'too_short' | 'not_mobile' | 'unparseable';

export type PhoneResult = { ok: true; value: string } | { ok: false; reason: PhoneRejectReason };

const MOBILE_RE = /^628[1-9][0-9]{7,10}$/;

export function normalizePhone(raw: string | null | undefined): PhoneResult {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '' || trimmed === '-') {
    return { ok: false, reason: 'empty' };
  }

  // Langkah 1: buang semua karakter selain digit.
  let digits = trimmed.replace(/\D/g, '');
  if (digits === '') {
    return { ok: false, reason: 'empty' };
  }

  // Langkah 2: buang awalan 62 berulang (626281... -> 6281...).
  while (digits.startsWith('6262')) {
    digits = digits.slice(2);
  }

  // Langkah 3-6: petakan ke kandidat 628..., atau tolak bila awalan tak dikenal.
  let candidate: string;
  if (digits.startsWith('0')) {
    candidate = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    candidate = '62' + digits;
  } else if (digits.startsWith('62')) {
    candidate = digits;
  } else {
    return { ok: false, reason: 'unparseable' };
  }

  // Langkah 7: validasi akhir.
  if (MOBILE_RE.test(candidate)) {
    return { ok: true, value: candidate };
  }

  if (!candidate.startsWith('628')) return { ok: false, reason: 'not_mobile' };
  if (candidate.length < 11) return { ok: false, reason: 'too_short' };
  if (!/^628[1-9]/.test(candidate)) return { ok: false, reason: 'not_mobile' };
  return { ok: false, reason: 'unparseable' }; // terlalu panjang / bentuk lain yang tak wajar
}
