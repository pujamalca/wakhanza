import { lookbackDate } from './common';
import type { PatientSegmentFilters } from './pasienSegment';

/**
 * broadcast_schedule.filter_json menyimpan rentang tanggal RELATIF
 * (lookbackDays), bukan dateFrom/dateTo tetap seperti broadcast_campaign --
 * jadwal berulang harus menghitung ulang jendela tanggal SETIAP KALI jalan
 * (mis. "30 hari terakhir" berarti jendela yang berbeda tiap minggu),
 * bukan membekukan tanggal saat jadwal pertama kali dibuat.
 */
export interface ScheduleFilterConfig {
  lookbackDays: number;
  kdKab?: string[];
  kdKec?: string[];
  kdPj?: string[];
  cari?: string;
}

/** Dipakai baik oleh dashboard (pratinjau saat menyusun jadwal) maupun worker (eksekusi sungguhan) supaya keduanya konsisten. */
export function scheduleFiltersToSegment(config: ScheduleFilterConfig): PatientSegmentFilters {
  return {
    dateFrom: lookbackDate(config.lookbackDays),
    dateTo: new Date(),
    kdKab: config.kdKab,
    kdKec: config.kdKec,
    kdPj: config.kdPj,
    cari: config.cari,
  };
}
