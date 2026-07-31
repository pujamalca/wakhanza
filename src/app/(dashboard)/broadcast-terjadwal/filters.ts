import { DEFAULT_FOLLOWUP_OFFSET_DAYS, type ScheduleFilterConfig, type ScheduleWindowMode } from '@/khanza/broadcastSchedule';
import { DATE_PRESETS } from '../broadcast/filters';

export { DATE_PRESETS };

export interface RawFilterInput {
  preset?: string | string[];
  lookback?: string | string[];
  windowMode?: string | string[];
  offset?: string | string[];
  kab?: string | string[];
  kec?: string | string[];
  pj?: string | string[];
  cari?: string | string[];
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const DEFAULT_LOOKBACK_DAYS = 30;

/** Sama seperti broadcast/filters.ts's parseFilters -- dipakai baik oleh halaman (pratinjau) maupun server action (simpan jadwal) supaya keduanya menafsirkan filter dengan cara yang PERSIS sama. */
export function parseScheduleFilters(input: RawFilterInput): ScheduleFilterConfig {
  const preset = single(input.preset);
  let lookbackDays = DEFAULT_LOOKBACK_DAYS;
  if (preset && DATE_PRESETS[preset]) {
    lookbackDays = DATE_PRESETS[preset].days;
  } else {
    const raw = Number(single(input.lookback));
    if (Number.isFinite(raw) && raw > 0) lookbackDays = raw;
  }

  const windowMode: ScheduleWindowMode = single(input.windowMode) === 'followup' ? 'followup' : 'rolling';

  let offsetDays = DEFAULT_FOLLOWUP_OFFSET_DAYS;
  const rawOffset = Number(single(input.offset));
  // >= 0 supaya "0 hari" (pasien yang daftar HARI INI) tetap sah -- berbeda
  // dari lookbackDays yang harus > 0 karena jendela nol hari tidak bermakna.
  if (Number.isFinite(rawOffset) && rawOffset >= 0) offsetDays = rawOffset;

  return {
    windowMode,
    lookbackDays,
    offsetDays,
    kdKab: toArray(input.kab),
    kdKec: toArray(input.kec),
    kdPj: toArray(input.pj),
    cari: single(input.cari)?.trim() || undefined,
  };
}
