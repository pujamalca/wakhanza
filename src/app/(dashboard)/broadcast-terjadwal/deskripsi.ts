import {
  isFollowupSchedule,
  isPilihSchedule,
  DEFAULT_FOLLOWUP_OFFSET_DAYS,
  type ScheduleFilterConfig,
} from '@/khanza/broadcastSchedule';
import { LOOKBACK_SEMUA_WAKTU } from '@/core/schedule';
import type { BroadcastSchedule } from '@/models';

/**
 * Keterangan sebuah jadwal dalam bahasa manusia, dipakai BERSAMA tabel
 * "Jadwal tersimpan" dan halaman detailnya.
 *
 * Satu penurunan, bukan dua: kolom "Sasaran" di tabel dan judul sasaran di
 * halaman detail menjawab pertanyaan yang sama, dan dua salinan yang berbeda
 * berarti staf membaca dua keterangan untuk satu jadwal lalu tidak tahu mana
 * yang benar. Bentuk kegagalan yang sudah berkali-kali dibayar di proyek ini
 * (`respectsOptOut()`, `core/outboxStatus.ts`, `core/tujuanPemicu.ts`).
 */

export const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function describeRepeat(s: BroadcastSchedule): string {
  const time = s.timeOfDay;
  if (s.repeatKind === 'once') return s.runOnceAt ? `Sekali, ${s.runOnceAt.toLocaleString('id-ID')}` : 'Sekali';
  if (s.repeatKind === 'daily') return `Harian, ${time}`;
  if (s.repeatKind === 'weekly') return `Mingguan, ${DAY_LABELS[s.dayOfWeek ?? 0]} ${time}`;
  return `Bulanan, tgl ${s.dayOfMonth} ${time}`;
}

/**
 * Mode jendela disimpan di dalam filter_json, jadi harus diurai untuk
 * ditampilkan. Baris lama (dibuat sebelum mode ini ada) tidak punya field-nya
 * dan terbaca sebagai 'rolling' -- sesuai perilakunya selama ini.
 */
export function bacaFilterJson(filterJson: string): ScheduleFilterConfig | null {
  try {
    return JSON.parse(filterJson) as ScheduleFilterConfig;
  } catch {
    return null;
  }
}

export function describeWindowConfig(config: ScheduleFilterConfig): string {
  // Daftar pilihan diperiksa DULU: ia menggantikan jendela, jadi menyebut
  // "Jendela 30 hari" untuk jadwal bercentang adalah keterangan yang salah
  // pada satu-satunya kolom yang menjelaskan siapa penerimanya.
  if (isPilihSchedule(config)) return `Daftar pilihan, ${config.noRkmMedis?.length ?? 0} pasien`;
  if (isFollowupSchedule(config)) return `Tindak lanjut, H+${config.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS}`;
  // "Jendela 0 hari" terbaca sebagai jendela kosong -- kebalikan persis dari
  // artinya. Lihat LOOKBACK_SEMUA_WAKTU.
  return config.lookbackDays > LOOKBACK_SEMUA_WAKTU ? `Jendela ${config.lookbackDays} hari` : 'Jendela semua waktu';
}

export function describeWindow(s: BroadcastSchedule): string {
  const config = bacaFilterJson(s.filterJson);
  return config ? describeWindowConfig(config) : '-';
}

/**
 * Kalimat panjang untuk halaman detail: BUKAN cuma bentuk sasarannya, tapi apa
 * artinya bagi seorang pasien -- berapa kali ia menerima pesan, dan apa yang
 * membuatnya keluar dari segmen. Justru itu yang ingin diperiksa orang yang
 * membuka halaman detail sebuah jadwal yang sudah berjalan.
 */
export function jelaskanSasaran(config: ScheduleFilterConfig): string {
  if (isPilihSchedule(config)) {
    return `Daftar tetap ${config.noRkmMedis?.length ?? 0} pasien yang dicentang staf. Orang yang sama dikirimi SETIAP kali jadwal ini jalan -- tidak ada jendela tanggal yang bisa mengeluarkan mereka dengan sendirinya.`;
  }
  if (isFollowupSchedule(config)) {
    const n = config.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS;
    return `Pasien yang berkunjung tepat ${n} hari sebelum jadwal jalan, satu hari kalender saja. Tiap kunjungan hanya pernah memicu satu pesan, selamanya -- ditegakkan kunci idempoten per no. pendaftaran, bukan oleh jendela tanggalnya.`;
  }
  if (config.lookbackDays > LOOKBACK_SEMUA_WAKTU) {
    return `Semua pasien yang berkunjung dalam ${config.lookbackDays} hari terakhir, dihitung ulang tiap kali jadwal jalan. Pasien yang sama tetap masuk selama masih di dalam jendela, jadi ia menerima pesan LAGI setiap kali.`;
  }
  return 'Semua pasien yang cocok dengan penyaring di bawah, TANPA batas tanggal kunjungan. Tidak ada pasien yang keluar dari segmen ini seiring waktu -- yang membatasinya cuma penyaring pasien dan tanggal berhenti otomatis.';
}
