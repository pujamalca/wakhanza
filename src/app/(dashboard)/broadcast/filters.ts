import type { PatientSegmentFilters } from '@/khanza/pasienSegment';

export const DEFAULT_LOOKBACK_DAYS = 30;

export const DATE_PRESETS: Record<string, { label: string; days: number }> = {
  '1m': { label: '1 bulan terakhir', days: 30 },
  '3m': { label: '3 bulan terakhir', days: 90 },
  '6m': { label: '6 bulan terakhir', days: 180 },
};

/**
 * Preset tersendiri, sengaja TIDAK ikut di DATE_PRESETS: isinya bukan "sekian
 * hari terakhir" melainkan ketiadaan rentang, dan memaksakannya masuk tabel di
 * atas berarti mengarang angka `days` yang tidak berarti apa-apa.
 */
export const PRESET_SEMUA_WAKTU = 'semua';

export interface RawFilterInput {
  preset?: string | string[];
  dateFrom?: string | string[];
  dateTo?: string | string[];
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

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
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
 *
 * KOSONG DAN TIDAK ADA ITU BEDA, dan bedanya menentukan perilaku:
 *
 * - kunci `dateFrom`/`dateTo` TIDAK ADA sama sekali = halaman dibuka polos,
 *   belum ada yang memilih apa pun -> jendela bawaan 30 hari. Membuka
 *   /broadcast tidak boleh langsung menyodorkan seluruh riwayat pasien.
 * - kunci ADA tapi isinya kosong = staf mengosongkan kotak tanggalnya sendiri
 *   lalu menekan Terapkan -> memang minta tanpa batas waktu.
 *
 * Form GET selalu mengirim kedua kunci itu (walau kosong), jadi pembedaan ini
 * bekerja apa adanya lewat browser. Yang perlu diperhatikan cuma URL yang
 * diketik tangan: `?cari=Budi` tanpa kunci tanggal dibaca sebagai pemuatan
 * pertama, jadi tetap berjendela 30 hari -- arah yang aman bila salah.
 */
export function parseFilters(input: RawFilterInput): PatientSegmentFilters {
  const preset = single(input.preset);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dateFrom: Date | null;
  let dateTo: Date | null;

  if (preset === PRESET_SEMUA_WAKTU) {
    dateFrom = null;
    dateTo = null;
  } else if (preset && DATE_PRESETS[preset]) {
    dateFrom = daysAgo(DATE_PRESETS[preset].days);
    dateTo = today;
  } else if (input.dateFrom === undefined && input.dateTo === undefined && !single(input.cari)?.trim()) {
    // Pencarian yang ikut, TANPA kunci tanggal sama sekali, hanya lahir dari
    // URL yang diketik/dibagikan tangan -- dan di sana jendela bawaan adalah
    // kegagalan diam yang persis dijelaskan core/segmentScope.ts: pasien yang
    // terakhir datang lebih dari sebulan lalu tidak muncul, dan yang terlihat
    // cuma "tidak ada pasien yang cocok". Orang yang mengetik ?cari=... sedang
    // mencari SEORANG PASIEN, bukan menyaring kunjungan sebulan terakhir.
    dateFrom = daysAgo(DEFAULT_LOOKBACK_DAYS);
    dateTo = today;
  } else {
    dateFrom = parseDate(single(input.dateFrom));
    dateTo = parseDate(single(input.dateTo));
    // Tanggal mulai terisi tapi akhir kosong = "sejak X sampai sekarang".
    // Dilengkapi di sini supaya ia tetap jadi jendela yang dipangkas indeks,
    // bukan jatuh ke bentuk query semua-waktu yang jauh lebih mahal.
    if (dateFrom && !dateTo) dateTo = today;
  }

  return {
    dateFrom,
    dateTo,
    kdKab: toArray(input.kab),
    kdKec: toArray(input.kec),
    kdPj: toArray(input.pj),
    cari: single(input.cari)?.trim() || undefined,
  };
}
