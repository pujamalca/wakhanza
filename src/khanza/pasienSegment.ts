import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { formatRawatPrefix, formatSqlDate, lookbackDate } from './common';

export interface PatientSegmentFilters {
  dateFrom: Date;
  dateTo: Date;
  kdKab?: string[];
  kdKec?: string[];
  kdKel?: string[];
  kdPj?: string[];
  cari?: string;
}

export interface PatientSegmentRow {
  no_rkm_medis: string;
  nm_pasien: string | null;
  no_tlp: string | null;
  kd_poli: string | null;
  kd_pj: string | null;
  png_jawab: string | null;
  nm_kab: string | null;
  nm_kec: string | null;
  nm_kel: string | null;
  tgl_kunjungan_terakhir: string;
}

const SEGMENT_LIMIT = 1000;

/**
 * Satu pasien bisa berkunjung beberapa kali dalam satu rentang tanggal --
 * broadcast harus mengirim SATU pesan per pasien, bukan per kunjungan. Anak
 * subquery memilih no_rawat TERBARU tiap no_rkm_medis dalam rentang (dipangkas
 * lewat prefix no_rawat, sama seperti pemicu lain, §4.4), baru kunjungan itu
 * di-join balik ke reg_periksa untuk kd_poli/kd_pj kunjungan tersebut secara
 * spesifik -- bukan GROUP BY dengan kolom tak teragregasi yang hasilnya
 * bergantung pada implementasi MySQL.
 */
function buildPatientSegmentSql(filters: PatientSegmentFilters) {
  const nextDay = new Date(filters.dateTo);
  nextDay.setDate(nextDay.getDate() + 1);

  const replacements: Record<string, unknown> = {
    fromPrefix: formatRawatPrefix(filters.dateFrom),
    toPrefixExclusive: formatRawatPrefix(nextDay),
    dateFromSql: formatSqlDate(filters.dateFrom),
    dateToSql: formatSqlDate(filters.dateTo),
  };

  let innerFilter = '';
  if (filters.kdPj && filters.kdPj.length > 0) {
    innerFilter += ' AND r.kd_pj IN (:kdPj)';
    replacements.kdPj = filters.kdPj;
  }

  let outerFilter = '';
  if (filters.kdKab && filters.kdKab.length > 0) {
    outerFilter += ' AND p.kd_kab IN (:kdKab)';
    replacements.kdKab = filters.kdKab;
  }
  if (filters.kdKec && filters.kdKec.length > 0) {
    outerFilter += ' AND p.kd_kec IN (:kdKec)';
    replacements.kdKec = filters.kdKec;
  }
  if (filters.kdKel && filters.kdKel.length > 0) {
    outerFilter += ' AND p.kd_kel IN (:kdKel)';
    replacements.kdKel = filters.kdKel;
  }
  // Satu kotak pencarian menjangkau dua tabel sekaligus, karena staf bisa
  // cuma tahu SALAH SATU: nama (fuzzy, tabel pasien -- tidak terindeks,
  // LIKE berwildcard-depan tidak bisa pakai indeks apa pun), no. RM (persis,
  // tabel pasien -- ID permanen pasien lintas kunjungan), atau no. pendaftaran
  // (persis, tabel reg_periksa -- ID per kunjungan, beda dari no. RM; hanya
  // cocok bila itu KUNJUNGAN TERBARU pasien dalam rentang tanggal terpilih,
  // karena lv mewakili satu kunjungan terpilih per pasien lewat MAX(no_rawat)
  // di atas, bukan seluruh riwayat kunjungannya). Aman diterapkan di sini
  // (bukan di subquery dalam) karena berjalan SETELAH subquery mempersempit
  // lewat prefix no_rawat -- scan hanya atas hasil yang sudah kecil, pola
  // sama seperti kdKab/kdKec/kdKel di atas.
  if (filters.cari && filters.cari.trim()) {
    const term = filters.cari.trim();
    outerFilter += ' AND (p.nm_pasien LIKE :cariLike OR p.no_rkm_medis = :cariExact OR lv.no_rawat = :cariExact)';
    replacements.cariLike = `%${term}%`;
    replacements.cariExact = term;
  }

  const sql = `
    SELECT p.no_rkm_medis, p.nm_pasien, p.no_tlp,
           lv.kd_poli, lv.kd_pj, pj.png_jawab,
           kb.nm_kab, kc.nm_kec, kl.nm_kel,
           lv.tgl_registrasi AS tgl_kunjungan_terakhir
    FROM (
      SELECT r.no_rkm_medis, MAX(r.no_rawat) AS no_rawat
      FROM reg_periksa r
      WHERE r.no_rawat >= :fromPrefix AND r.no_rawat < :toPrefixExclusive
        AND r.tgl_registrasi >= :dateFromSql AND r.tgl_registrasi <= :dateToSql
        ${innerFilter}
      GROUP BY r.no_rkm_medis
    ) seg
    JOIN reg_periksa lv ON lv.no_rawat = seg.no_rawat
    JOIN pasien p ON p.no_rkm_medis = seg.no_rkm_medis
    LEFT JOIN penjab pj ON pj.kd_pj = lv.kd_pj
    LEFT JOIN kabupaten kb ON kb.kd_kab = p.kd_kab
    LEFT JOIN kecamatan kc ON kc.kd_kec = p.kd_kec
    LEFT JOIN kelurahan kl ON kl.kd_kel = p.kd_kel
    WHERE 1 = 1 ${outerFilter}
    ORDER BY seg.no_rawat DESC
    LIMIT ${SEGMENT_LIMIT}
  `;

  return { sql, replacements };
}

/** Dipakai halaman /broadcast untuk pratinjau + kirim (kirim menjalankan ulang query ini di server, tidak pernah percaya daftar dari klien). */
export async function fetchPatientSegment(filters: PatientSegmentFilters): Promise<PatientSegmentRow[]> {
  const { sql, replacements } = buildPatientSegmentSql(filters);
  return sikSelect<PatientSegmentRow>(sql, replacements);
}

export interface RegionOption {
  kode: string;
  nama: string;
}

/**
 * kabupaten/kecamatan di install ini sudah dipangkas ke wilayah cakupan RS
 * (116 & 156 baris saat ditulis, bukan referensi nasional Kemendagri yang
 * puluhan ribu baris) -- aman dibaca penuh tanpa DISTINCT lewat pasien.
 */
export async function fetchRegionOptions(): Promise<{ kabupaten: RegionOption[]; kecamatan: RegionOption[] }> {
  const [kabupaten, kecamatan] = await Promise.all([
    sikSelect<{ kd_kab: string; nm_kab: string }>('SELECT kd_kab, nm_kab FROM kabupaten ORDER BY nm_kab'),
    sikSelect<{ kd_kec: string; nm_kec: string }>('SELECT kd_kec, nm_kec FROM kecamatan ORDER BY nm_kec'),
  ]);
  return {
    kabupaten: kabupaten.map((r) => ({ kode: r.kd_kab, nama: r.nm_kab })),
    kecamatan: kecamatan.map((r) => ({ kode: r.kd_kec, nama: r.nm_kec })),
  };
}

export async function fetchPaymentOptions(): Promise<RegionOption[]> {
  const rows = await sikSelect<{ kd_pj: string; png_jawab: string }>(
    "SELECT kd_pj, png_jawab FROM penjab WHERE kd_pj <> '-' ORDER BY png_jawab",
  );
  return rows.map((r) => ({ kode: r.kd_pj, nama: r.png_jawab }));
}

const PLAN_CHECK_FILTERS: PatientSegmentFilters = {
  dateFrom: lookbackDate(90),
  dateTo: new Date(),
  kdKab: ['1'],
  kdPj: ['BPJ'],
  cari: 'a',
};

registerPlanCheck({
  name: 'BROADCAST_SEGMENT',
  sql: buildPatientSegmentSql(PLAN_CHECK_FILTERS).sql,
  replacements: buildPatientSegmentSql(PLAN_CHECK_FILTERS).replacements,
  maxRows: 2000,
});
