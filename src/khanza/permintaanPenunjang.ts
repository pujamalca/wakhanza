import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { formatRawatPrefix, lookbackDate } from './common';

export type PermintaanJenis = 'lab' | 'radiologi';

/**
 * PERMINTAAN penunjang -- saat dokter MEMESAN pemeriksaan, bukan saat hasilnya
 * selesai.
 *
 * Pasangan RESULT_READY, dan bedanya menentukan gunanya: RESULT_READY memberi
 * tahu pasien bahwa ia boleh mengambil hasil, sementara ini memberi tahu bahwa
 * ada pemeriksaan yang HARUS DIJALANI -- pasien rawat jalan yang pulang tanpa
 * tahu ada permintaan lab akan datang lagi hanya untuk itu. Dipasangkan dengan
 * `template_target`, ia sekaligus memberi tahu grup laboratorium/radiologi
 * bahwa ada pekerjaan masuk.
 *
 * PRIVASI -- dua kolom yang WAJIB tidak pernah disentuh, dan keduanya ada di
 * tabel yang sama:
 *
 *   diagnosa_klinis      dugaan diagnosis dokter yang meminta pemeriksaan
 *   informasi_tambahan   catatan bebas untuk petugas penunjang
 *
 * Keduanya rekam medis telanjang, dan `diagnosa_klinis` di database ini memang
 * terisi ("kontrol gula"). Query di bawah tidak men-`SELECT` keduanya sama
 * sekali, jadi merendernya bukan terlarang melainkan MUSTAHIL (§5.2) -- prinsip
 * yang sama dengan `status_prb` pada surat kontrol BPJS.
 *
 * `kd_jenis_prw` diambil sebagai KODE dan hanya untuk `checkPrivacy()`, persis
 * seperti RESULT_READY. Nama pemeriksaannya (`jns_perawatan_lab.nm_perawatan`)
 * tidak pernah ikut, dan `jumlah_item` juga tidak -- §4.3: banyaknya pemeriksaan
 * pun petunjuk medis.
 */
export interface PermintaanRow {
  noorder: string;
  no_rawat: string;
  tgl_permintaan: string;
  jam_permintaan: string;
  /** Kode-kode pemeriksaan yang diminta, untuk pemeriksaan privasi F4.3 saja. */
  kd_jenis_prw_list: string | null;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_poli: string | null;
  /** Dokter yang MEMINTA pemeriksaan (`dokter_perujuk`), bukan dokter poli. */
  nm_dokter: string | null;
  png_jawab: string | null;
}

const TABEL: Record<PermintaanJenis, { induk: string; detail: string }> = {
  lab: { induk: 'permintaan_lab', detail: 'permintaan_pemeriksaan_lab' },
  radiologi: { induk: 'permintaan_radiologi', detail: 'permintaan_pemeriksaan_radiologi' },
};

/**
 * MARGIN pemangkas, dan ini bagian yang paling gampang dihapus karena tampak
 * berlebihan.
 *
 * Pemangkasnya `no_rawat` (§4.4) -- terindeks di kedua tabel, dan satu-satunya
 * kolom di sini yang berformat tanggal terurut. Tapi `no_rawat` menyandikan
 * tanggal KUNJUNGAN sementara yang dijadikan kejadian adalah
 * `tgl_permintaan`, dan keduanya tidak selalu sama hari: diukur atas 4.636
 * baris `permintaan_lab`, **4.631 pada hari yang sama dan 5 baris sampai 61
 * hari SESUDAHNYA**. Arahnya selalu maju (tidak ada permintaan yang mendahului
 * kunjungannya), jadi yang perlu dilebarkan hanya batas BAWAH pemangkasnya.
 *
 * Tanpa margin, permintaan yang dibuat hari ini atas kunjungan dua bulan lalu
 * jatuh di luar prefix dan hilang tanpa satu pun galat -- kelas kegagalan yang
 * sama persis dengan prefix `nobooking` pada pembatalan BPJS, hanya jauh lebih
 * jarang. 90 hari dipilih supaya jarak 61 hari yang benar-benar terjadi punya
 * ruang, dan biayanya kecil: tabelnya bertambah ~180 baris/bulan.
 *
 * `noorder` (PK, `PK202612310001`) SEBENARNYA cocok sempurna dengan
 * `tgl_permintaan` -- 0 dari 4.636 meleset -- dan akan jadi pemangkas yang
 * eksak. Ia TIDAK dipakai karena awalan hurufnya tidak bisa dipastikan untuk
 * radiologi: `permintaan_radiologi` kosong di kedua database di mesin ini, jadi
 * "PR" cuma tebakan. Memakai pemangkas berbeda untuk dua pemicu kembar adalah
 * bentuk penyimpangan yang sudah berkali-kali dibayar di proyek ini; kalau
 * suatu saat awalan radiologi terbukti, keduanya boleh pindah BERSAMA.
 */
const MARGIN_HARI = 90;

/**
 * Satu bentuk SQL untuk kedua jenis, dibedakan nama tabelnya -- alasan yang
 * sama seperti `buildResepStafSql`: keduanya menyaring baris yang sama dari
 * tabel berbentuk identik, dan dua salinan yang berbeda satu nama tabel adalah
 * cara paling gampang membuat perbaikan pada satu jenis diam-diam tidak
 * berlaku pada satunya.
 *
 * Nama tabel dari daftar tetap di atas, TIDAK PERNAH dari input pengguna.
 */
function buildPermintaanSql(jenis: PermintaanJenis) {
  const { induk, detail } = TABEL[jenis];
  return `
    SELECT
      pm.noorder, pm.no_rawat, pm.tgl_permintaan, pm.jam_permintaan,
      (
        SELECT GROUP_CONCAT(DISTINCT d.kd_jenis_prw)
        FROM ${detail} d
        WHERE d.noorder = pm.noorder
      ) AS kd_jenis_prw_list,
      r.no_rkm_medis, r.kd_poli,
      p.nm_pasien, p.no_tlp,
      pk.nm_poli,
      dr.nm_dokter,
      pj.png_jawab
    FROM ${induk} pm
    JOIN reg_periksa r ON r.no_rawat = pm.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
    LEFT JOIN dokter dr ON dr.kd_dokter = pm.dokter_perujuk
    LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
    WHERE pm.no_rawat >= :lookbackPrefix
      AND TIMESTAMP(pm.tgl_permintaan, pm.jam_permintaan) >= :cursorTs
    ORDER BY pm.tgl_permintaan, pm.jam_permintaan
    LIMIT 200
  `;
}

export async function pollPermintaan(
  jenis: PermintaanJenis,
  cursorTs: Date,
  lookbackDays: number,
): Promise<PermintaanRow[]> {
  return sikSelect<PermintaanRow>(buildPermintaanSql(jenis), {
    lookbackPrefix: formatRawatPrefix(lookbackDate(lookbackDays + MARGIN_HARI)),
    cursorTs,
  });
}

/**
 * `allowFullScan` untuk alias `pm`, dan alasannya BERBEDA dari ketiga izin lain
 * di proyek ini -- layak dibaca sebelum ada yang menghapusnya atau menirunya.
 *
 * `booking_registrasi` boleh dipindai karena kelas pemicunya memang pindai;
 * `dokter` dan `databarang` boleh karena tabel konfigurasi/katalog yang tidak
 * tumbuh seiring jumlah pasien. `permintaan_lab` JELAS tumbuh seiring pasien --
 * jadi izin ini bukan pernyataan bahwa pemindaiannya aman selamanya.
 *
 * Yang terjadi: query-nya BENAR dan memang memakai indeks pada volume nyata,
 * tapi optimizer memilih pindai penuh selama tabelnya masih kecil, dan di
 * database yang dipakai produksi (`alca`) tabel ini baru berisi 74 baris.
 * Dibuktikan dengan menjalankan query yang SAMA terhadap dua database:
 *
 *   alca  74 baris   -> type=ALL, key=NULL   (12 baris cocok rentang; memindai
 *                                             62 baris memang lebih murah)
 *   sik   4.636 baris -> type=range, key=no_rawat
 *
 * Jadi pindai penuh di sini bukan jalur akses yang salah melainkan keputusan
 * optimizer yang benar, dan ia akan berhenti sendiri begitu tabelnya bertambah.
 *
 * **`maxRows` yang jadi penjaga sebenarnya**, bukan izin ini. 3000 dipilih
 * dengan alasan yang sama seperti MAX_ROWS_JENDELA_30_HARI: jendela 120 hari
 * pada volume nyata berisi 868 baris, jadi 3000 memberi ruang tumbuh sambil
 * tetap berteriak jauh sebelum pemindaian penuh tabel dewasa. Kalau ini gagal:
 * ukur dulu volumenya: naik karena rumah sakit makin ramai itu wajar, naik
 * tanpa kenaikan volume berarti query atau indeksnya yang berubah -- dan ITU
 * yang tidak boleh dinaikkan begitu saja.
 */
for (const jenis of Object.keys(TABEL) as PermintaanJenis[]) {
  registerPlanCheck({
    name: `PERMINTAAN(${jenis})`,
    sql: buildPermintaanSql(jenis),
    replacements: {
      lookbackPrefix: formatRawatPrefix(lookbackDate(30 + MARGIN_HARI)),
      cursorTs: new Date(),
    },
    allowFullScan: ['pm'],
    maxRows: 3000,
  });
}
