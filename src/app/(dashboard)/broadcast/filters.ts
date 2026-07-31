import type { PatientSegmentFilters } from '@/khanza/pasienSegment';

export const DEFAULT_LOOKBACK_DAYS = 30;

export const DATE_PRESETS: Record<string, { label: string; days: number }> = {
  '1m': { label: '1 bulan terakhir', days: 30 },
  '3m': { label: '3 bulan terakhir', days: 90 },
  '6m': { label: '6 bulan terakhir', days: 180 },
};

export interface RawFilterInput {
  preset?: string | string[];
  dateFrom?: string | string[];
  dateTo?: string | string[];
  kab?: string | string[];
  kec?: string | string[];
  pj?: string | string[];
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Dipakai baik oleh halaman (searchParams GET, pratinjau) maupun server
 * action (FormData, kirim sungguhan) supaya keduanya menafsirkan filter
 * dengan cara yang PERSIS sama -- yang dilihat staf saat pratinjau harus
 * sama dengan yang benar-benar dikirim.
 */
export function parseFilters(input: RawFilterInput): PatientSegmentFilters {
  const preset = single(input.preset);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dateFrom: Date;
  let dateTo: Date;
  if (preset && DATE_PRESETS[preset]) {
    dateFrom = daysAgo(DATE_PRESETS[preset].days);
    dateTo = today;
  } else {
    dateFrom = parseDate(single(input.dateFrom), daysAgo(DEFAULT_LOOKBACK_DAYS));
    dateTo = parseDate(single(input.dateTo), today);
  }

  return {
    dateFrom,
    dateTo,
    kdKab: toArray(input.kab),
    kdKec: toArray(input.kec),
    kdPj: toArray(input.pj),
  };
}
