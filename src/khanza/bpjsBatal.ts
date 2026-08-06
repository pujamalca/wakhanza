import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';

/**
 * Pembatalan booking yang dilakukan PASIEN SENDIRI lewat aplikasi Mobile JKN.
 *
 * Berbeda dari BOOK_CANCEL, yang membaca `booking_registrasi` -- pendaftaran
 * yang dibuat lewat kanal rumah sakit sendiri. Yang ini kanal BPJS: pasien
 * memesan slot di aplikasinya, lalu membatalkannya di aplikasinya juga, dan
 * rumah sakit tidak pernah tahu sampai ada yang membuka SIMRS. Slot yang batal
 * itulah yang bisa diisi pasien lain -- karena itu penerimanya loket/pendaftaran,
 * bukan pasien yang membatalkan (ia sudah tahu, ia yang menekan tombolnya).
 */
export interface BpjsBatalRow {
  nobooking: string;
  no_rkm_medis: string;
  /** Waktu pembatalan. `datetime` NOT NULL, jadi tidak pernah kosong. */
  tanggalbatal: string;
  keterangan: string | null;
  /** Tanggal janji yang dibatalkan -- masa depan bagi sebagian besar baris. */
  tanggalperiksa: string | null;
  jampraktek: string | null;
  /**
   * Nomor yang pasien ketik SENDIRI di aplikasi Mobile JKN. Lihat catatan
   * "nomor mana yang dipakai" di worker/bpjsRunner.ts -- kolom ini TIDAK
   * dipakai untuk menghubungi pasien pada pemicu ini (tujuannya staf), tapi
   * ikut diambil karena pemicu KONTROL memakainya sebagai cadangan.
   */
  nohp: string | null;
  /**
   * Kode poli KHANZA hasil pemetaan, bukan kode poli BPJS. Lihat komentar
   * `maping_poli_bpjs` di bawah -- ini yang dibaca checkPrivacy().
   */
  kd_poli: string | null;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_poli: string | null;
  nm_dokter: string | null;
}

/**
 * PEMINDAIAN PENUH `referensi_mobilejkn_bpjs_batal`, dan itu keputusan sadar --
 * bukan kelalaian yang lolos dari verify:plans.
 *
 * Aturan §4.4 menuntut dua penyaring: prefix primary key sebagai pemangkas
 * lewat indeks, plus kolom waktu asli sebagai penentu ketepatan. Prefix-nya
 * TERSEDIA di sini dan tampak menggoda: `nobooking` ber-format YYYYMMDD +
 * 6 digit (`20260107000014`), persis sekelas dengan `no_rawat`/`no_resep`.
 *
 * Tapi ia menyandikan tanggal JANJI, bukan tanggal PEMBATALAN -- dan keduanya
 * tidak searah. Diukur atas seluruh 1.808 baris di database rujukan:
 *
 *   dibatalkan SEBELUM hari janji   506 baris  (sampai 60 hari sebelumnya)
 *   dibatalkan pada hari janji     1.158 baris
 *   dibatalkan SESUDAH hari janji    144 baris (sampai 105 hari sesudahnya)
 *
 * 144 baris terakhir itulah yang mematikan gagasannya: sebuah pembatalan yang
 * TERCATAT hari ini bisa menunjuk booking dari 105 hari lalu, sehingga
 * `nobooking >= prefix(hari ini - 30)` MEMBUANGNYA. Yang terjadi bukan galat
 * melainkan pemberitahuan yang tidak pernah dikirim, dan tidak ada satu pun
 * baris `outbox` yang menandai bahwa ia pernah ada -- kelas kegagalan yang
 * paling mahal di proyek ini.
 *
 * Yang membuat pemindaian penuh bisa diterima di sini adalah LAJU TUMBUHNYA,
 * bukan ukurannya hari ini: 1.808 baris dalam ~21 bulan (~2,8 per hari). Tabel
 * ini bertambah hanya saat ada yang MEMBATALKAN, bukan tiap kunjungan -- jadi
 * ia tidak sekelas `reg_periksa`. `maxRows` tetap ditegakkan supaya asumsi itu
 * gagal berisik kalau ternyata keliru di instalasi lain.
 */
const SQL_BATAL = `
  SELECT
    b.nobooking,
    b.no_rkm_medis,
    b.tanggalbatal,
    b.keterangan,
    r.tanggalperiksa,
    r.jampraktek,
    r.nohp,
    mp.kd_poli_rs AS kd_poli,
    p.nm_pasien,
    p.no_tlp,
    pk.nm_poli,
    d.nm_dokter
  FROM referensi_mobilejkn_bpjs_batal b
  JOIN referensi_mobilejkn_bpjs r ON r.nobooking = b.nobooking
  LEFT JOIN maping_poli_bpjs mp ON mp.kd_poli_bpjs = r.kodepoli
  LEFT JOIN poliklinik pk ON pk.kd_poli = mp.kd_poli_rs
  LEFT JOIN pasien p ON p.no_rkm_medis = b.no_rkm_medis
  LEFT JOIN dokter d ON d.kd_dokter = r.kodedokter
  WHERE b.tanggalbatal >= :cursorTs
  ORDER BY b.tanggalbatal
  LIMIT 200
`;

export async function pollBpjsBatal(cursorTs: Date): Promise<BpjsBatalRow[]> {
  return sikSelect<BpjsBatalRow>(SQL_BATAL, { cursorTs });
}

/**
 * `maxRows` 6000, bukan 500 bawaan maupun MAX_ROWS_JENDELA_30_HARI.
 *
 * Angka ini mengukur hal yang berbeda dari ketiga pemicu berjendela: di sana
 * `rows` adalah isi jendela 30 hari, di sini ia SELURUH tabel karena memang
 * dipindai penuh. 1.808 hari ini, bertambah ~2,8 per hari -- 6000 memberi
 * sekitar sepuluh tahun sebelum berbunyi, dan kalau ia berbunyi lebih cepat
 * dari itu maka asumsi "pembatalan itu jarang" yang salah, dan itu memang
 * layak diperiksa manusia alih-alih dinaikkan begitu saja.
 */
registerPlanCheck({
  name: 'BPJS_BATAL',
  sql: SQL_BATAL,
  replacements: { cursorTs: new Date('2020-01-01T00:00:00') },
  allowFullScan: ['b'],
  maxRows: 6000,
});
