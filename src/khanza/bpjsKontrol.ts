import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';

/**
 * Surat kontrol BPJS: rencana kunjungan berikutnya yang sudah dijadwalkan saat
 * pasien pulang, berminggu-minggu di muka.
 *
 * PRIVASI -- dan tabel ini kasus yang paling tajam di seluruh proyek.
 *
 * `bridging_surat_kontrol_bpjs` punya ~45 kolom, dan sebagian besar di antaranya
 * REKAM MEDIS TELANJANG: `status_prb` berisi diagnosis kronis apa adanya
 * ('01. Diabetes Melitus', '06. Skizofrenia', '09. SLE'), ditambah HBA1C, GDP,
 * GD2JPP, eGFR, LDL, tekanan darah, `JantungKoroner`, `Stroke`, `HamilMenyusui`,
 * dan seterusnya. `bridging_sep` yang di-join menyimpan `diagawal` dan
 * `nmdiagnosaawal`.
 *
 * Query di bawah mengambil SEMBILAN kolom, dan tidak satu pun di antaranya
 * klinis -- hanya penjadwalan (nomor surat, tanggal rencana, poli, dokter) dan
 * identitas untuk menghubungi. Ini bukan kerapian melainkan penegakan yang sama
 * seperti §5.2: kolom yang tidak pernah di-SELECT tidak mungkin bocor lewat
 * template mana pun, dan `{status_prb}` bukan sekadar terlarang -- ia MUSTAHIL,
 * karena datanya tidak pernah sampai ke proses ini.
 *
 * Kalau suatu saat ada yang ingin menyebut jenis penyakit di pesan pengingat:
 * itu bukan perubahan template, itu perubahan kelas data yang dikirim lewat
 * WhatsApp, dan pintunya sengaja ditutup di sini.
 */
export interface BpjsKontrolRow {
  no_surat: string;
  /** Tanggal rencana kontrol (YYYY-MM-DD, `dateStrings: true`). */
  tgl_rencana: string;
  /** Nama poli SEBAGAIMANA TERCETAK di surat yang dipegang pasien. */
  nm_poli_bpjs: string | null;
  nm_dokter_bpjs: string | null;
  no_rkm_medis: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  /**
   * Nomor yang tercatat pada SEP-nya. Cadangan saja -- lihat
   * `worker/bpjsRunner.ts` untuk urutan pemakaiannya dan kenapa ia TIDAK
   * ditulis ke `patient_contact`.
   *
   * Bukan spekulasi bahwa ia berguna: dari 18.843 surat di database rujukan,
   * 618 milik pasien yang `pasien.no_tlp`-nya tidak terpakai, dan 602 di
   * antaranya (97%) punya nomor sah di sini.
   */
  notelep: string | null;
  /** Kode poli KHANZA hasil pemetaan -- yang dibaca checkPrivacy(). */
  kd_poli: string | null;
}

/**
 * PEMINDAIAN PENUH `bridging_surat_kontrol_bpjs`, dan tidak ada jalan keluarnya.
 *
 * `tgl_rencana` tidak terindeks, dan trik §4.4 tidak berlaku di sini: primary
 * key-nya `no_surat` (`0055S0010126K000204`), yang MEMUAT tanggal tapi sebagai
 * `0126` = MMYY di tengah string. Itu tidak terurut secara leksikal antar tahun
 * -- Januari 2026 ('0126') berada SEBELUM Februari 2025 ('0225') -- jadi ia
 * tidak bisa dipakai sebagai pemangkas rentang sama sekali. Menjoin dari
 * `bridging_sep` lebih dulu juga tidak menolong: jarak `tgl_surat` ke
 * `tgl_rencana` mencapai dua bulan, jadi jendelanya harus jauh lebih lebar
 * daripada tabel yang sedang dihindari (27.484 baris berbanding 18.843).
 *
 * Yang membuatnya bisa diterima: query ini jalan SEKALI SEHARI, bukan tiap 60
 * detik. Diukur atas database rujukan (18.843 baris, join penuh seperti di
 * bawah): ~35 ms termasuk overhead klien, tiga kali berturut-turut. Itu satu
 * kali 35 ms per hari.
 *
 * SATU query untuk SELURUH selisih hari yang disetel, lewat `IN (:tanggalTarget)`
 * -- bukan satu query per selisih. Dengan pengaturan "7,1" bentuk per-selisih
 * berarti dua pemindaian penuh tiap hari alih-alih satu, dan biaya itu bertambah
 * tiap kali staf menambahkan satu pengingat lagi.
 */
const SQL_KONTROL = `
  SELECT
    sk.no_surat,
    sk.tgl_rencana,
    sk.nm_poli_bpjs,
    sk.nm_dokter_bpjs,
    sep.nomr AS no_rkm_medis,
    p.nm_pasien,
    p.no_tlp,
    sep.notelep,
    mp.kd_poli_rs AS kd_poli
  FROM bridging_surat_kontrol_bpjs sk
  JOIN bridging_sep sep ON sep.no_sep = sk.no_sep
  LEFT JOIN maping_poli_bpjs mp ON mp.kd_poli_bpjs = sk.kd_poli_bpjs
  LEFT JOIN pasien p ON p.no_rkm_medis = sep.nomr
  WHERE sk.tgl_rencana IN (:tanggalTarget)
  ORDER BY sk.tgl_rencana, sk.no_surat
  LIMIT 500
`;

/**
 * @param tanggalTarget daftar tanggal rencana (YYYY-MM-DD) yang jatuh tempo
 *   diingatkan hari ini. Tidak boleh kosong -- `IN ()` bukan SQL yang sah, dan
 *   pemanggilnya memang tidak punya alasan memanggil tanpa satu pun tanggal.
 */
export async function pollBpjsKontrol(tanggalTarget: string[]): Promise<BpjsKontrolRow[]> {
  if (tanggalTarget.length === 0) return [];
  return sikSelect<BpjsKontrolRow>(SQL_KONTROL, { tanggalTarget });
}

/**
 * `maxRows` 60000 -- SELURUH tabel, karena memang dipindai penuh, plus ruang
 * tumbuh. 18.843 baris hari ini, bertambah seiring kunjungan spesialis.
 *
 * Ambang ini menjaga hal yang berbeda dari pemicu berjendela: bukan "apakah
 * jendelanya membengkak" melainkan "apakah tabelnya masih sekelas yang bisa
 * dipindai sekali sehari". Kalau ia berbunyi, yang perlu ditinjau adalah apakah
 * sekali sehari masih cukup murah -- bukan sekadar menaikkan angkanya.
 */
registerPlanCheck({
  name: 'BPJS_KONTROL',
  sql: SQL_KONTROL,
  replacements: { tanggalTarget: ['2026-02-11', '2026-02-09'] },
  allowFullScan: ['sk'],
  maxRows: 60000,
});
