import {
  resolveScheduleWindow,
  DEFAULT_FOLLOWUP_OFFSET_DAYS,
  type ScheduleWindowMode,
} from '@/core/schedule';
import type { ModePenerima } from '@/core/pilihanPasien';
import { fetchPatientSegment, fetchPatientsByRm, type PatientSegmentFilters, type PatientSegmentRow } from './pasienSegment';

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
  /**
   * 'pilih' = penerimanya daftar no. RM tetap di bawah, bukan segmen hasil
   * filter. Absen pada seluruh baris yang dibuat sebelum fitur ini ada ->
   * dibaca sebagai 'semua', jadi jadwal lama berperilaku persis seperti dulu.
   */
  mode?: ModePenerima;
  noRkmMedis?: string[];
}

/**
 * Daftar pilihan MENGGANTIKAN jendela tanggal, tidak menyaringnya -- jadi mode
 * ini dan mode tindak lanjut saling meniadakan, dan itu ditegakkan di
 * `isFollowupSchedule` di bawah alih-alih diingat oleh tiap pemanggil.
 */
export function isPilihSchedule(config: ScheduleFilterConfig): boolean {
  return config.mode === 'pilih' && (config.noRkmMedis?.length ?? 0) > 0;
}

/**
 * SENGAJA false saat modenya `pilih`, dan itu bukan kerapian melainkan
 * kebenaran: mode tindak lanjut berarti "N hari sesudah SEBUAH KUNJUNGAN", dan
 * kunci idempotennya berkunci pada `no_rawat` supaya satu kunjungan hanya
 * pernah memicu satu pesan selamanya. Pada daftar pilihan tidak ada kunjungan
 * yang memicu apa pun -- yang memicu adalah jadwalnya -- dan `no_rawat` di sana
 * cuma kunjungan TERAKHIR pasien, yang berubah setiap kali ia datang lagi.
 * Membiarkan keduanya menyala berarti pasien yang dicentang menerima pesan
 * tambahan setiap kali ia berobat, tanpa satu pun galat.
 *
 * Ditegakkan di sini, bukan di runner, karena jawabannya dibutuhkan di empat
 * tempat (pratinjau halaman, pemeriksaan simpan, keterangan tabel, eksekusi
 * worker) -- dan yang lupa memeriksanya tidak mendapat galat apa pun.
 */
export function isFollowupSchedule(config: ScheduleFilterConfig): boolean {
  return config.windowMode === 'followup' && !isPilihSchedule(config);
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

/**
 * SATU pintu menuju daftar penerima sebuah jadwal, dipakai ketiga pemanggilnya:
 * pratinjau halaman, pemeriksaan kewarasan saat simpan, dan worker saat jadwal
 * jatuh tempo. Percabangan yang disalin ke tiga tempat adalah percabangan yang
 * cepat atau lambat berbeda di salah satunya -- dan yang paling mungkin
 * tertinggal adalah PRATINJAUNYA, yaitu satu-satunya dari ketiganya yang tidak
 * mengirim apa pun sehingga kesalahannya tidak bergejala.
 */
export async function fetchSegmentUntukJadwal(config: ScheduleFilterConfig): Promise<PatientSegmentRow[]> {
  if (isPilihSchedule(config)) return fetchPatientsByRm(config.noRkmMedis ?? []);
  return fetchPatientSegment(scheduleFiltersToSegment(config));
}
