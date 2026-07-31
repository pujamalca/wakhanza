import {
  resolveScheduleWindow,
  DEFAULT_FOLLOWUP_OFFSET_DAYS,
  type ScheduleWindowMode,
} from '@/core/schedule';
import type { PatientSegmentFilters } from './pasienSegment';

export { DEFAULT_FOLLOWUP_OFFSET_DAYS };
export type { ScheduleWindowMode };

/**
 * broadcast_schedule.filter_json menyimpan rentang tanggal RELATIF
 * (lookbackDays/offsetDays), bukan dateFrom/dateTo tetap seperti
 * broadcast_campaign -- jadwal berulang harus menghitung ulang jendela tanggal
 * SETIAP KALI jalan, bukan membekukan tanggal saat jadwal dibuat.
 *
 * Arti kedua mode-nya (dan kenapa bedanya penting) ada di core/schedule.ts's
 * ScheduleWindowMode; matematikanya sengaja di core supaya bisa diuji unit
 * tanpa menyentuh database, sama seperti computeNextRunAt.
 */
export interface ScheduleFilterConfig {
  /** Absen pada baris yang dibuat sebelum mode ini ada -> dibaca sebagai 'rolling' (perilaku lama dipertahankan apa adanya). */
  windowMode?: ScheduleWindowMode;
  lookbackDays: number;
  offsetDays?: number;
  kdKab?: string[];
  kdKec?: string[];
  kdPj?: string[];
  cari?: string;
}

export function isFollowupSchedule(config: ScheduleFilterConfig): boolean {
  return config.windowMode === 'followup';
}

/** Dipakai baik oleh dashboard (pratinjau saat menyusun jadwal) maupun worker (eksekusi sungguhan) supaya keduanya konsisten. */
export function scheduleFiltersToSegment(config: ScheduleFilterConfig): PatientSegmentFilters {
  const { dateFrom, dateTo } = resolveScheduleWindow(config, new Date());
  return {
    dateFrom,
    dateTo,
    kdKab: config.kdKab,
    kdKec: config.kdKec,
    kdPj: config.kdPj,
    cari: config.cari,
  };
}
