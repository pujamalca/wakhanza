export type RepeatKind = 'once' | 'daily' | 'weekly' | 'monthly';

/**
 * `created_by` yang ditulis worker ke `broadcast_campaign` (dan `actor` di
 * `audit_log`) tiap kali sebuah jadwal jalan: `system:broadcast_schedule:<id>`.
 * Itu yang membedakan jalan otomatis dari kirim manual staf, yang memakai
 * username asli.
 *
 * Tinggal di core, bukan sebagai const lokal di runner, karena sejak halaman
 * detail jadwal ada ia dibaca dari DUA arah: worker MENULISnya, dashboard
 * MENCARInya. Dua salinan string berarti riwayat pengiriman yang diam-diam
 * kosong -- halamannya tampil wajar, cuma tidak pernah menemukan satu
 * kampanye pun, dan tidak ada galat di mana pun. Bentuk kegagalan yang sama
 * sudah dibayar di `respectsOptOut()` dan `kunciPesanMasuk()`.
 */
export const SCHEDULE_ACTOR = 'system:broadcast_schedule';

export function scheduleActor(scheduleId: number): string {
  return `${SCHEDULE_ACTOR}:${scheduleId}`;
}

/**
 * Pengulangan tiap N hari ("sekali tiga hari"), dipakai peringatan DARURAT STOK
 * dan sengaja TIDAK ditambahkan ke `RepeatKind`.
 *
 * `broadcast_schedule.repeat_kind` adalah ENUM MariaDB yang tidak memuat nilai
 * ini. Melebarkan `RepeatKind` akan membuat TypeScript meloloskan penetapannya
 * ke model broadcast, dan kegagalannya baru muncul di tingkat database sebagai
 * galat ENUM yang tidak menyebut sebab sebenarnya. Tipe yang lebih sempit
 * tetap boleh masuk ke fungsi yang menerima tipe lebar ini, jadi kedua
 * pemanggil tetap berbagi SATU `computeNextRunAt()` -- yang memang inti
 * alasannya ada: dashboard menghitung `next_run_at` pertama, worker menghitung
 * yang berikutnya, dan keduanya tidak boleh punya tafsir sendiri-sendiri.
 */
export type RepeatKindPeriodik = RepeatKind | 'every_n_days';

export interface ScheduleTiming {
  repeatKind: RepeatKindPeriodik;
  /** 'HH:MM', jam dinding lokal -- diabaikan untuk 'once' (pakai runOnceAt langsung). */
  timeOfDay: string;
  /** 0=Minggu..6=Sabtu, wajib untuk 'weekly'. */
  dayOfWeek?: number | null;
  /** 1-28 (dibatasi supaya selalu valid di semua bulan termasuk Februari), wajib untuk 'monthly'. */
  dayOfMonth?: number | null;
  /** Jarak hari, wajib untuk 'every_n_days'. Dijepit 2-90. */
  intervalDays?: number | null;
  /** Tanggal+jam spesifik, wajib untuk 'once'. */
  runOnceAt?: Date | null;
}

/**
 * Batas jarak hari yang masuk akal.
 *
 * Bawah 2 karena 1 sudah punya namanya sendiri (`daily`) -- dua jalan menuju
 * perilaku yang sama berarti dua tempat yang harus diperiksa saat mencari tahu
 * kenapa sebuah jadwal berjalan tiap hari. Atas 90 supaya "atur lalu lupa"
 * punya batas; jadwal yang jalan tiap tiga bulan lebih baik dinyatakan sebagai
 * `monthly` yang terlihat jelas di daftar.
 */
export const MIN_INTERVAL_DAYS = 2;
export const MAX_INTERVAL_DAYS = 90;

/**
 * Dua cara menafsirkan "pasien mana" pada jadwal broadcast berulang. Bedanya
 * menentukan berapa kali SATU pasien menerima pesan, jadi ini bukan sekadar
 * preferensi tampilan:
 *
 * - `rolling`  : jendela berjalan `lookbackDays` terakhir sampai HARI INI.
 *                Pasien yang sama tetap masuk kriteria selama masih di dalam
 *                jendela, jadi jadwal harian dengan lookback 30 hari mengirim
 *                ke orang yang sama 30 kali. Masuk akal untuk pengumuman
 *                berkala ke seluruh segmen, berbahaya untuk yang lain.
 * - `followup` : TEPAT satu hari kalender, `offsetDays` hari yang lalu.
 *                Dipasangkan dengan pengulangan harian, tiap pasien melewati
 *                jendela ini persis SEKALI -- inilah bentuk "pasien yang
 *                daftar hari ini, dikirimi 3 hari lagi".
 */
export type ScheduleWindowMode = 'rolling' | 'followup';

export const DEFAULT_FOLLOWUP_OFFSET_DAYS = 3;

export interface ScheduleWindowInput {
  windowMode?: ScheduleWindowMode;
  /** Dipakai mode 'rolling'. 0 = TANPA batas bawah, lihat LOOKBACK_SEMUA_WAKTU. */
  lookbackDays: number;
  /** Dipakai mode 'followup'. 0 = pasien yang berkunjung hari ini juga. */
  offsetDays?: number;
}

/**
 * `lookbackDays` yang berarti "seluruh riwayat kunjungan, tanpa batas bawah".
 *
 * Nol dipilih karena ia satu-satunya angka yang TIDAK punya arti lain di sini:
 * jendela nol hari bukan jendela, jadi ia tidak menabrak nilai sah mana pun.
 * (Bandingkan `offsetDays`, tempat 0 justru punya arti sendiri -- "pasien yang
 * berkunjung hari ini juga" -- dan karena itu tidak bisa dipakai untuk ini.)
 *
 * Yang harus disadari saat memakainya: tanpa batas bawah, `segmentScope()`
 * memindahkan query segmen ke BENTUK yang berbeda (berangkat dari `pasien`,
 * bukan dari prefix `no_rawat`), dan tanpa satu pun penyaring pasien ia
 * ditolak sebagai 'tanpa-batas' -> nol baris. Jadi jadwal berjendela semua-
 * waktu yang tidak menyaring apa-apa TIDAK BISA disimpan; `createScheduleAction`
 * menolaknya karena pratinjaunya kosong.
 */
export const LOOKBACK_SEMUA_WAKTU = 0;

/**
 * Rentang tanggal kunjungan yang disasar, dihitung ULANG dari `now` setiap
 * kali dipanggil -- jadwal berulang tidak boleh membekukan tanggal saat
 * dibuat, karena "30 hari terakhir" berarti jendela yang berbeda tiap minggu.
 *
 * Untuk 'followup', dateFrom == dateTo (satu hari kalender penuh, bukan
 * jendela kosong): pemanggilnya memangkas lewat prefix no_rawat [hari, hari+1).
 *
 * `dateFrom` null = tanpa batas bawah. Nilai itu diteruskan apa adanya ke
 * `PatientSegmentFilters`, yang memang sudah menerimanya sejak rentang tanggal
 * /broadcast jadi opsional -- jadi bentuk query yang benar dipilih oleh
 * `segmentScope()` tanpa satu pun cabang tambahan di sisi jadwal.
 */
export function resolveScheduleWindow(
  input: ScheduleWindowInput,
  now: Date,
): { dateFrom: Date | null; dateTo: Date } {
  if (input.windowMode === 'followup') {
    const day = new Date(now);
    day.setDate(day.getDate() - (input.offsetDays ?? DEFAULT_FOLLOWUP_OFFSET_DAYS));
    day.setHours(0, 0, 0, 0);
    return { dateFrom: day, dateTo: new Date(day) };
  }

  // <= 0, bukan === 0: angka negatif yang lolos dari mana pun berarti jendela
  // yang membentang ke MASA DEPAN, dan itu tidak pernah bisa dimaksudkan.
  if (input.lookbackDays <= LOOKBACK_SEMUA_WAKTU) return { dateFrom: null, dateTo: new Date(now) };

  const from = new Date(now);
  from.setDate(from.getDate() - input.lookbackDays);
  return { dateFrom: from, dateTo: new Date(now) };
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const [h, m] = timeOfDay.split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

/**
 * Kapan eksekusi BERIKUTNYA, dihitung dari `after` (saat jadwal dibuat, atau
 * saat terakhir jalan). Dipakai baik oleh dashboard (hitung next_run_at
 * pertama kali) maupun worker (hitung ulang setelah tiap kali jalan) supaya
 * keduanya konsisten. Memakai getter/setter Date lokal biasa (bukan util
 * UTC+7 eksplisit) -- konsisten dengan seluruh proyek yang mengasumsikan
 * server RS berzona WIB (lihat khanza/common.ts, core/quietHours.ts).
 *
 * Mengembalikan null bila tidak ada eksekusi berikutnya ('once' yang
 * runOnceAt-nya sudah lewat, atau input tidak lengkap).
 */
export function computeNextRunAt(timing: ScheduleTiming, after: Date): Date | null {
  if (timing.repeatKind === 'once') {
    if (!timing.runOnceAt) return null;
    return timing.runOnceAt > after ? timing.runOnceAt : null;
  }

  const { hour, minute } = parseTimeOfDay(timing.timeOfDay);

  if (timing.repeatKind === 'daily') {
    const next = new Date(after);
    next.setHours(hour, minute, 0, 0);
    if (next <= after) next.setDate(next.getDate() + 1);
    return next;
  }

  if (timing.repeatKind === 'every_n_days') {
    if (timing.intervalDays == null) return null;
    const n = Math.min(Math.max(Math.floor(timing.intervalDays), MIN_INTERVAL_DAYS), MAX_INTERVAL_DAYS);
    const next = new Date(after);
    next.setHours(hour, minute, 0, 0);
    /**
     * Melompat N hari penuh, bukan 1 hari lalu N-1 lagi.
     *
     * Akibatnya harus diketahui dan sengaja diterima: jadwal "tiap 3 hari pukul
     * 18:00" yang DIBUAT pukul 20:00 pertama kali jalan tiga hari lagi, bukan
     * besok. Jaraknya seragam sejak kejadian pertama, dan itu lebih penting
     * daripada memajukan yang pertama -- jarak yang tidak seragam membuat
     * "kenapa peringatannya datang hari ini" tidak bisa dijawab dengan melihat
     * pengaturannya.
     *
     * Karena `after` adalah waktu jalan TERAKHIR saat worker menghitung ulang,
     * jaraknya ikut menyerap keterlambatan: worker yang mati semalam tidak
     * membuat seluruh jadwal berikutnya bergeser permanen.
     */
    if (next <= after) next.setDate(next.getDate() + n);
    return next;
  }

  if (timing.repeatKind === 'weekly') {
    if (timing.dayOfWeek == null) return null;
    const next = new Date(after);
    next.setHours(hour, minute, 0, 0);
    let daysUntil = (timing.dayOfWeek - next.getDay() + 7) % 7;
    if (daysUntil === 0 && next <= after) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (timing.repeatKind === 'monthly') {
    if (timing.dayOfMonth == null) return null;
    const dom = Math.min(Math.max(timing.dayOfMonth, 1), 28);
    const next = new Date(after);
    next.setDate(dom);
    next.setHours(hour, minute, 0, 0);
    if (next <= after) {
      next.setMonth(next.getMonth() + 1);
      // dom<=28 selalu valid di bulan manapun -- setDate ulang murni jaga-jaga,
      // bukan karena setMonth bisa overflow di sini (tidak bisa, karena day-of-month
      // sebelum panggilan ini sudah <=28).
      next.setDate(dom);
    }
    return next;
  }

  return null;
}
