import { DEFAULT_FOLLOWUP_OFFSET_DAYS, type ScheduleFilterConfig, type ScheduleWindowMode } from '@/khanza/broadcastSchedule';
import { LOOKBACK_SEMUA_WAKTU } from '@/core/schedule';
import { bacaModePenerima, bacaPilihanRm } from '@/core/pilihanPasien';
import { DATE_PRESETS, PRESET_SEMUA_WAKTU } from '../broadcast/filters';

export { DATE_PRESETS, PRESET_SEMUA_WAKTU };

export interface RawFilterInput {
  preset?: string | string[];
  lookback?: string | string[];
  windowMode?: string | string[];
  offset?: string | string[];
  kab?: string | string[];
  kec?: string | string[];
  pj?: string | string[];
  cari?: string | string[];
  mode?: string | string[];
  rm?: string | string[];
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Bawaannya SEMUA WAKTU, bukan 30 hari, dan itu perubahan yang disengaja.
 *
 * Jendela 30 hari dulu ada karena halaman ini membaca segmennya pada setiap
 * pemuatan -- angka itu menahan biayanya. Sejak `core/segmentGate.ts` menunda
 * pembacaan sampai staf benar-benar meminta, alasan itu gugur, sementara
 * kerugiannya tetap: pasien yang terakhir datang lebih dari sebulan lalu
 * TIDAK PERNAH bisa ditemukan lewat kotak cari di halaman ini, dan yang
 * terlihat cuma "tidak ada pasien yang cocok" -- persis seperti kalau namanya
 * salah ketik. Padahal justru pasien lama itulah yang paling sering dicari
 * satu per satu untuk dicentang.
 *
 * Yang menahan penyalahgunaannya bukan angka ini melainkan `segmentScope()`:
 * tanpa batas bawah DAN tanpa penyaring pasien, segmennya ditolak jadi nol
 * baris, sehingga jadwal "seluruh pasien yang pernah terdaftar, tiap hari"
 * tidak bisa disimpan sama sekali.
 */
const DEFAULT_LOOKBACK_DAYS = LOOKBACK_SEMUA_WAKTU;

/** Sama seperti broadcast/filters.ts's parseFilters -- dipakai baik oleh halaman (pratinjau) maupun server action (simpan jadwal) supaya keduanya menafsirkan filter dengan cara yang PERSIS sama. */
export function parseScheduleFilters(input: RawFilterInput): ScheduleFilterConfig {
  const preset = single(input.preset);
  let lookbackDays = DEFAULT_LOOKBACK_DAYS;
  if (preset === PRESET_SEMUA_WAKTU) {
    lookbackDays = LOOKBACK_SEMUA_WAKTU;
  } else if (preset && DATE_PRESETS[preset]) {
    lookbackDays = DATE_PRESETS[preset].days;
  } else {
    const raw = Number(single(input.lookback));
    // >= 0, bukan > 0: nol adalah nilai yang SAH sekarang (semua waktu), dan
    // menolaknya di sini akan diam-diam mengembalikan jendela ke bawaan tanpa
    // satu pun tanda bahwa pilihan staf tidak terpakai.
    if (Number.isFinite(raw) && raw >= 0) lookbackDays = raw;
  }

  const windowMode: ScheduleWindowMode = single(input.windowMode) === 'followup' ? 'followup' : 'rolling';

  let offsetDays = DEFAULT_FOLLOWUP_OFFSET_DAYS;
  const rawOffset = Number(single(input.offset));
  // >= 0 supaya "0 hari" (pasien yang daftar HARI INI) tetap sah -- berbeda
  // dari lookbackDays yang harus > 0 karena jendela nol hari tidak bermakna.
  if (Number.isFinite(rawOffset) && rawOffset >= 0) offsetDays = rawOffset;

  // Daftar centang disimpan APA ADANYA ke filter_json, bukan cuma saat mode
  // `pilih` aktif: staf yang mengumpulkan pasien lalu menyalakan modenya di
  // langkah terakhir tidak boleh kehilangan centangnya karena satu radio.
  // isPilihSchedule() yang memutuskan dipakai atau tidak.
  const mode = bacaModePenerima(input.mode);
  const noRkmMedis = bacaPilihanRm(input.rm).daftar;

  return {
    windowMode,
    lookbackDays,
    offsetDays,
    kdKab: toArray(input.kab),
    kdKec: toArray(input.kec),
    kdPj: toArray(input.pj),
    cari: single(input.cari)?.trim() || undefined,
    mode,
    noRkmMedis,
  };
}
