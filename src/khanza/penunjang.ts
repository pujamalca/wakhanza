import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { formatRawatPrefix, lookbackDate } from './common';

export type PenunjangJenis = 'lab' | 'radiologi';

export interface ResultReadyRow {
  no_rawat: string;
  tgl_periksa: string;
  jam_terakhir: string;
  jumlah_item: number;
  kd_jenis_prw_list: string | null;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_poli: string | null;
  png_jawab: string | null;
}

const TABLE_BY_JENIS: Record<PenunjangJenis, string> = {
  lab: 'periksa_lab',
  radiologi: 'periksa_radiologi',
};

/**
 * ARCHITECTURE §4.3: satu baris per (no_rawat, tgl_periksa), BUKAN per baris
 * periksa_lab -- pasien dengan panel darah lengkap punya belasan baris
 * (kd_jenis_prw berbeda) untuk satu kunjungan. Tanpa penggabungan, pasien
 * menerima belasan WhatsApp beruntun untuk satu kunjungan.
 *
 * `kd_jenis_prw_list` (kode, BUKAN nama dari jns_perawatan_lab/radiologi)
 * dikumpulkan untuk pemeriksaan privasi F4.3 -- lihat core/privacy.ts. Nama
 * pemeriksaan TIDAK PERNAH diambil di sini sama sekali (§5.2).
 *
 * Penjamin justru kebalikannya: NAMA-nya (`pj.png_jawab`) yang diambil dan
 * kodenya (`r.kd_pj`) yang tidak -- lihat core/penjamin.ts. Bedanya bukan
 * inkonsistensi: kode jenis perawatan dipakai MESIN untuk memutuskan privasi
 * dan namanya memang tidak boleh keluar, sementara nama penjamin dipakai
 * MANUSIA yang membaca pesannya dan kodenya tidak berguna bagi siapa pun.
 */
function buildResultReadySql(jenis: PenunjangJenis) {
  const table = TABLE_BY_JENIS[jenis];
  return `
    SELECT g.no_rawat, g.tgl_periksa, g.jam_terakhir, g.jumlah_item, g.kd_jenis_prw_list,
           r.no_rkm_medis, r.kd_poli,
           p.nm_pasien, p.no_tlp,
           pk.nm_poli,
           pj.png_jawab
    FROM (
      SELECT no_rawat, tgl_periksa,
             MAX(jam) AS jam_terakhir,
             COUNT(*) AS jumlah_item,
             GROUP_CONCAT(DISTINCT kd_jenis_prw) AS kd_jenis_prw_list
      FROM ${table}
      WHERE no_rawat >= :lookbackPrefix
      GROUP BY no_rawat, tgl_periksa
      HAVING MAX(TIMESTAMP(tgl_periksa, jam)) >= :cursorTs
    ) g
    JOIN reg_periksa r ON r.no_rawat = g.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
    ORDER BY g.jam_terakhir
    LIMIT 200
  `;
}

export async function pollResultReady(jenis: PenunjangJenis, cursorTs: Date, lookbackDays: number): Promise<ResultReadyRow[]> {
  const replacements = {
    lookbackPrefix: formatRawatPrefix(lookbackDate(lookbackDays)),
    cursorTs,
  };
  return sikSelect<ResultReadyRow>(buildResultReadySql(jenis), replacements);
}

for (const jenis of Object.keys(TABLE_BY_JENIS) as PenunjangJenis[]) {
  registerPlanCheck({
    // Deskriptif, bukan kode pemicunya -- sama seperti `PERMINTAAN(${jenis})`
    // di permintaanPenunjang.ts. Satu query di sini melayani satu jenis, dan
    // kode pemicu yang memakainya (LAB_RESULT/RAD_RESULT sejak migrations/034)
    // ditentukan di worker, bukan di modul khanza/.
    name: `HASIL(${jenis})`,
    sql: buildResultReadySql(jenis),
    replacements: { lookbackPrefix: formatRawatPrefix(lookbackDate(30)), cursorTs: new Date() },
    maxRows: 500,
  });
}
