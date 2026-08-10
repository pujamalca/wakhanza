import { sikSelect } from '@/db/sik';
import { segmentScope, type SegmentScopeInput } from '@/core/segmentScope';
import { registerPlanCheck } from './planChecks';
import { formatRawatPrefix, formatSqlDate, lookbackDate } from './common';

export interface PatientSegmentFilters extends SegmentScopeInput {
  /**
   * null = tanpa batas bawah tanggal. Lihat core/segmentScope.ts -- kolom ini
   * yang menentukan BENTUK query, bukan sekadar satu kondisi WHERE.
   */
  dateFrom: Date | null;
  dateTo: Date | null;
  kdKab?: string[];
  kdKec?: string[];
  kdKel?: string[];
  kdPj?: string[];
  cari?: string;
}

export interface PatientSegmentRow {
  no_rkm_medis: string;
  /** No. pendaftaran kunjungan terpilih (bukan ID pasien) -- dipakai jadwal tindak-lanjut sebagai kunci idempoten per KUNJUNGAN. */
  no_rawat: string;
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

export const SEGMENT_LIMIT = 1000;

/** Kolom & join yang sama untuk kedua bentuk query -- hanya subquery `seg` yang berbeda. */
const SELECT_DAN_JOIN = `
    SELECT p.no_rkm_medis, p.nm_pasien, p.no_tlp,
           lv.no_rawat, lv.kd_poli, lv.kd_pj, pj.png_jawab,
           kb.nm_kab, kc.nm_kec, kl.nm_kel,
           lv.tgl_registrasi AS tgl_kunjungan_terakhir
    FROM (`;

function joinEkor(outerFilter: string): string {
  return `) seg
    JOIN reg_periksa lv ON lv.no_rawat = seg.no_rawat
    JOIN pasien p ON p.no_rkm_medis = seg.no_rkm_medis
    LEFT JOIN penjab pj ON pj.kd_pj = lv.kd_pj
    LEFT JOIN kabupaten kb ON kb.kd_kab = p.kd_kab
    LEFT JOIN kecamatan kc ON kc.kd_kec = p.kd_kec
    LEFT JOIN kelurahan kl ON kl.kd_kel = p.kd_kel
    WHERE 1 = 1 ${outerFilter}
    ORDER BY seg.no_rawat DESC
    LIMIT ${SEGMENT_LIMIT}`;
}

/**
 * BENTUK 1 -- berjendela: berangkat dari `reg_periksa`, dipangkas prefix
 * `no_rawat` (§4.4). Bentuk asli dan satu-satunya sampai tanggal jadi opsional.
 *
 * Satu pasien bisa berkunjung beberapa kali dalam satu rentang tanggal --
 * broadcast harus mengirim SATU pesan per pasien, bukan per kunjungan. Anak
 * subquery memilih no_rawat TERBARU tiap no_rkm_medis dalam rentang, baru
 * kunjungan itu di-join balik ke reg_periksa untuk kd_poli/kd_pj kunjungan
 * tersebut secara spesifik -- bukan GROUP BY dengan kolom tak teragregasi yang
 * hasilnya bergantung pada implementasi MySQL.
 */
function buildWindowedSql(filters: PatientSegmentFilters) {
  // dateFrom dijamin ada oleh segmentScope; dateTo boleh kosong (= sampai hari
  // ini), jadi staf yang cuma mengisi tanggal mulai tetap dapat jendela.
  const dateFrom = filters.dateFrom!;
  const dateTo = filters.dateTo ?? new Date();
  const nextDay = new Date(dateTo);
  nextDay.setDate(nextDay.getDate() + 1);

  const replacements: Record<string, unknown> = {
    fromPrefix: formatRawatPrefix(dateFrom),
    toPrefixExclusive: formatRawatPrefix(nextDay),
    dateFromSql: formatSqlDate(dateFrom),
    dateToSql: formatSqlDate(dateTo),
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

  const sql = `${SELECT_DAN_JOIN}
      SELECT r.no_rkm_medis, MAX(r.no_rawat) AS no_rawat
      FROM reg_periksa r
      WHERE r.no_rawat >= :fromPrefix AND r.no_rawat < :toPrefixExclusive
        AND r.tgl_registrasi >= :dateFromSql AND r.tgl_registrasi <= :dateToSql
        ${innerFilter}
      GROUP BY r.no_rkm_medis
    ${joinEkor(outerFilter)}
  `;

  return { sql, replacements };
}

/**
 * BENTUK 2 -- semua waktu: berangkat dari `pasien`, masuk ke `reg_periksa`
 * lewat indeks `no_rkm_medis`.
 *
 * KENAPA ARAHNYA DIBALIK, bukan sekadar menghapus kondisi tanggal: prefix
 * `no_rawat` adalah SATU-SATUNYA hal yang membuat bentuk 1 tidak memindai
 * seluruh `reg_periksa` -- tabel yang tumbuh satu baris per kunjungan, jadi
 * yang paling besar di `sik`. Menghapusnya begitu saja mengubah query segmen
 * menjadi pemindaian penuh tabel itu, persis yang dilarang §4.4 dan dijaga
 * `npm run verify:plans`.
 *
 * Dari sisi `pasien` biayanya berbeda jenis: satu baris per PASIEN (bukan per
 * kunjungan), dan pencarian nama memakai indeks `nm_pasien` sebagai covering
 * index -- MariaDB memindai indeksnya yang sempit, bukan barisnya yang lebar.
 * Dari situ tiap pasien masuk ke `reg_periksa` lewat `ref` pada indeks
 * `no_rkm_medis`. Dibuktikan lewat EXPLAIN terhadap `sik` sungguhan, bukan
 * diperkirakan (`BROADCAST_SEGMENT_SEMUA` di verify:plans).
 *
 * Konsekuensi yang harus disadari: pencarian nama berwildcard-depan
 * (`LIKE '%budi%'`) memang tidak bisa memakai indeks apa pun untuk MELOMPAT --
 * biayanya tumbuh seiring jumlah pasien terdaftar. Itu harga yang melekat pada
 * mencari sepenggal nama, dan ini query interaktif satu kali tekan, bukan
 * poller tiap 60 detik.
 */
function buildAllTimeSql(filters: PatientSegmentFilters, cariNoRkmMedis: string | null) {
  const replacements: Record<string, unknown> = {};

  // Penyaring pada PASIEN wajib ada di subquery dalam, bukan di luar: ia yang
  // mempersempit sisi penggerak sebelum join ke reg_periksa. Dipindah ke luar,
  // seluruh kunjungan setiap pasien ikut terbaca lebih dulu.
  let pasienFilter = '';
  if (filters.kdKab && filters.kdKab.length > 0) {
    pasienFilter += ' AND p0.kd_kab IN (:kdKab)';
    replacements.kdKab = filters.kdKab;
  }
  if (filters.kdKec && filters.kdKec.length > 0) {
    pasienFilter += ' AND p0.kd_kec IN (:kdKec)';
    replacements.kdKec = filters.kdKec;
  }
  if (filters.kdKel && filters.kdKel.length > 0) {
    pasienFilter += ' AND p0.kd_kel IN (:kdKel)';
    replacements.kdKel = filters.kdKel;
  }
  if (filters.cari && filters.cari.trim()) {
    const term = filters.cari.trim();
    // No. pendaftaran TIDAK dicocokkan lewat `OR r.no_rawat = ...` di sini:
    // OR yang merentang dua tabel membatalkan join lewat indeks dan
    // mengembalikan query ini ke pemindaian penuh. Ia sudah diterjemahkan
    // lebih dulu menjadi no. RM (resolveNoRawatKeRm), jadi ketiga cara cari
    // tetap bekerja tanpa mengorbankan rencana query.
    pasienFilter += ' AND (p0.nm_pasien LIKE :cariLike OR p0.no_rkm_medis IN (:cariRm))';
    replacements.cariLike = `%${term}%`;
    replacements.cariRm = cariNoRkmMedis ? [term, cariNoRkmMedis] : [term];
  }

  let kunjunganFilter = '';
  if (filters.kdPj && filters.kdPj.length > 0) {
    kunjunganFilter += ' AND r.kd_pj IN (:kdPj)';
    replacements.kdPj = filters.kdPj;
  }
  // Batas ATAS tetap dihormati bila diisi. Ia tidak bisa memangkas lewat
  // indeks (tanpa batas bawah, rentangnya terbuka ke belakang), tapi
  // mengabaikannya berarti staf melihat kunjungan di luar tanggal yang ia
  // ketik sendiri.
  if (filters.dateTo) {
    const nextDay = new Date(filters.dateTo);
    nextDay.setDate(nextDay.getDate() + 1);
    kunjunganFilter += ' AND r.no_rawat < :toPrefixExclusive AND r.tgl_registrasi <= :dateToSql';
    replacements.toPrefixExclusive = formatRawatPrefix(nextDay);
    replacements.dateToSql = formatSqlDate(filters.dateTo);
  }

  const sql = `${SELECT_DAN_JOIN}
      SELECT r.no_rkm_medis, MAX(r.no_rawat) AS no_rawat
      FROM pasien p0
      JOIN reg_periksa r ON r.no_rkm_medis = p0.no_rkm_medis
      WHERE 1 = 1 ${pasienFilter} ${kunjunganFilter}
      GROUP BY r.no_rkm_medis
    ${joinEkor('')}
  `;

  return { sql, replacements };
}

/**
 * BENTUK 3 -- daftar pilihan: berangkat dari `reg_periksa` lewat indeks
 * `no_rkm_medis`, tanpa tanggal dan tanpa satu pun filter lain.
 *
 * Dipakai saat staf mencentang pasien satu per satu (core/pilihanPasien.ts).
 * Daftar itu MENGGANTIKAN segmen, jadi tidak ada rentang tanggal yang bisa
 * membuang pasien yang dicentang sendiri -- lihat alasannya di modul itu.
 *
 * Ini juga yang menegakkan aturan "hasil pratinjau tidak pernah jadi sumber
 * kebenaran": klien menyerahkan no. RM saja, lalu nama, nomor telepon, poli,
 * dan kunjungan terakhirnya dibaca ULANG dari `sik` di sini. Tidak satu pun
 * data pasien datang dari form.
 *
 * `MAX(r.no_rawat)` = kunjungan TERBARU pasien, seumur riwayatnya -- berbeda
 * dari bentuk berjendela yang mengambil terbaru DI DALAM rentang. Itu yang
 * benar di sini: tanpa rentang, "terbaru" tidak punya arti lain. Konsekuensinya
 * `{tanggal_kunjungan}` pada mode ini berarti kunjungan terakhir sungguhan.
 */
function buildPilihRmSql(noRkmMedis: string[]) {
  const sql = `${SELECT_DAN_JOIN}
      SELECT r.no_rkm_medis, MAX(r.no_rawat) AS no_rawat
      FROM reg_periksa r
      WHERE r.no_rkm_medis IN (:rm)
      GROUP BY r.no_rkm_medis
    ${joinEkor('')}
  `;
  return { sql, replacements: { rm: noRkmMedis } };
}

/**
 * Pasien yang BELUM PERNAH berkunjung tidak muncul, dan itu disengaja: seluruh
 * variabel broadcast ({tanggal_kunjungan}, {cara_bayar}) berasal dari sebuah
 * kunjungan, dan `checkPrivacy` memeriksa `kd_poli` kunjungan itu. Tanpa satu
 * pun kunjungan, tidak ada yang bisa diperiksa maupun dirender. Praktisnya
 * tidak menggigit -- no. RM yang dicentang selalu berasal dari tabel pratinjau,
 * yang isinya memang hasil join ke `reg_periksa`.
 */
export async function fetchPatientsByRm(noRkmMedis: string[]): Promise<PatientSegmentRow[]> {
  // `IN ()` kosong adalah galat sintaks di MariaDB, bukan "nol hasil" -- jadi
  // dijaga di sini, bukan diserahkan ke database.
  if (noRkmMedis.length === 0) return [];
  const { sql, replacements } = buildPilihRmSql(noRkmMedis);
  return sikSelect<PatientSegmentRow>(sql, replacements);
}

const SQL_CARI_NO_RAWAT = 'SELECT no_rkm_medis FROM reg_periksa WHERE no_rawat = :cariExact LIMIT 1';

/**
 * Menerjemahkan no. pendaftaran menjadi no. RM lewat primary key `no_rawat`.
 * Dipakai HANYA oleh bentuk `semua-waktu` -- lihat komentar di buildAllTimeSql.
 * Pencarian nama biasa juga melewatinya dan tidak cocok apa-apa; itu satu
 * lookup primary key, jauh lebih murah daripada menebak bentuk masukan staf.
 */
async function resolveNoRawatKeRm(cariExact: string): Promise<string | null> {
  const rows = await sikSelect<{ no_rkm_medis: string | null }>(SQL_CARI_NO_RAWAT, { cariExact });
  return rows[0]?.no_rkm_medis ?? null;
}

/** Dipakai halaman /broadcast untuk pratinjau + kirim (kirim menjalankan ulang query ini di server, tidak pernah percaya daftar dari klien). */
export async function fetchPatientSegment(filters: PatientSegmentFilters): Promise<PatientSegmentRow[]> {
  const scope = segmentScope(filters);

  // Ditolak di sini juga, bukan hanya di halaman: fungsi ini adalah satu-satunya
  // pintu menuju daftar penerima, dan ia dipanggil dari tiga tempat (halaman,
  // server action, worker jadwal). Penjagaan yang cuma ada di salah satunya
  // adalah penjagaan yang cepat atau lambat dilewati.
  if (scope === 'tanpa-batas') return [];

  if (scope === 'berjendela') {
    const { sql, replacements } = buildWindowedSql(filters);
    return sikSelect<PatientSegmentRow>(sql, replacements);
  }

  const term = filters.cari?.trim();
  const cariNoRkmMedis = term ? await resolveNoRawatKeRm(term) : null;
  const { sql, replacements } = buildAllTimeSql(filters, cariNoRkmMedis);
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
  sql: buildWindowedSql(PLAN_CHECK_FILTERS).sql,
  replacements: buildWindowedSql(PLAN_CHECK_FILTERS).replacements,
  maxRows: 2000,
});

const PLAN_CHECK_SEMUA: PatientSegmentFilters = {
  dateFrom: null,
  dateTo: null,
  kdKab: ['1'],
  cari: 'a',
};

/**
 * Cara bayar SENGAJA dipisah jadi pemeriksaan sendiri, bukan digabung ke atas.
 * Menambahkannya membuat optimizer membalik arah join -- ia masuk lewat indeks
 * `kd_pj` pada `reg_periksa` alih-alih lewat `pasien`, karena `LIKE '%..%'`
 * tidak bisa ia nilai selektivitasnya. Masih lewat indeks dan masih dibatasi
 * LIMIT, jadi bukan kegagalan; tapi ia rencana yang BERBEDA, dan rencana yang
 * tidak pernah di-EXPLAIN adalah rencana yang diam-diam boleh berubah.
 */
const PLAN_CHECK_SEMUA_PJ: PatientSegmentFilters = {
  ...PLAN_CHECK_SEMUA,
  kdPj: ['BPJ'],
};

/**
 * Yang dijaga kedua pemeriksaan ini adalah ARAHNYA: `reg_periksa` wajib tetap
 * dimasuki lewat indeks, tidak pernah dipindai penuh. Itulah tabel yang tumbuh
 * satu baris per kunjungan dan yang dibaca poller tiap 60 detik.
 *
 * `p0` (= `pasien`) diberi izin dipindai penuh, dan alasannya BERBEDA dari dua
 * izin lain di proyek ini. `booking_registrasi` boleh karena kelas pemicunya
 * memang pindai; `dokter` boleh karena ia tabel konfigurasi yang tidak tumbuh
 * seiring jumlah pasien. `pasien` jelas tumbuh -- tapi satu baris per PASIEN,
 * bukan per kunjungan, dan query ini dijalankan sekali tiap kali staf menekan
 * Terapkan, bukan berulang di latar belakang.
 *
 * Pemindaiannya juga tidak selalu terjadi: dengan pencarian nama saja, MariaDB
 * memakai indeks `nm_pasien` sebagai covering index (`type: index`). Ia jatuh
 * ke pemindaian penuh begitu wilayah ikut dipilih -- kesetaraan `kd_kab` dan
 * `LIKE '%..%'` tidak bisa dilayani satu indeks yang sama. Itu keputusan
 * optimizer berdasarkan biaya, dan keduanya sama-sama membaca `pasien` satu
 * kali; yang berbeda cuma lebar barisnya.
 *
 * `maxRows` disetel dari sanalah: cukup longgar untuk menampung satu baris per
 * pasien di RS yang jauh lebih besar dari mesin ini (8.112), tanpa menyerah
 * memeriksa. Kalau suatu saat angkanya terlampaui, yang perlu ditinjau bukan
 * ambangnya melainkan apakah pencarian semua-waktu masih pantas dijalankan
 * langsung dari kotak filter.
 */
registerPlanCheck({
  name: 'BROADCAST_SEGMENT_SEMUA',
  sql: buildAllTimeSql(PLAN_CHECK_SEMUA, null).sql,
  replacements: buildAllTimeSql(PLAN_CHECK_SEMUA, null).replacements,
  allowFullScan: ['p0'],
  maxRows: 200_000,
});

registerPlanCheck({
  name: 'BROADCAST_SEGMENT_SEMUA_PJ',
  sql: buildAllTimeSql(PLAN_CHECK_SEMUA_PJ, null).sql,
  replacements: buildAllTimeSql(PLAN_CHECK_SEMUA_PJ, null).replacements,
  allowFullScan: ['p0'],
  maxRows: 200_000,
});

registerPlanCheck({
  name: 'BROADCAST_CARI_RAWAT',
  sql: SQL_CARI_NO_RAWAT,
  replacements: { cariExact: '2026/01/01/000001' },
});

/**
 * TANPA izin pindai penuh, dan itu bukan keberuntungan: `no_rkm_medis` adalah
 * indeks pada `reg_periksa` (indeks yang sama dipakai bentuk semua-waktu untuk
 * masuk dari sisi `pasien`), jadi daftar pilihan berapa pun panjangnya tetap
 * `range`/`ref` -- tidak pernah memindai tabel yang tumbuh satu baris per
 * kunjungan. Nilai contohnya sengaja no. RM yang tidak ada di database mana pun;
 * baris EXPLAIN ber-`table = NULL` yang lahir dari situ sudah ditangani
 * verify-plans sebagai KEBALIKAN dari pemindaian penuh.
 */
registerPlanCheck({
  name: 'BROADCAST_PILIH_RM',
  sql: buildPilihRmSql(['000001', '000002']).sql,
  replacements: buildPilihRmSql(['000001', '000002']).replacements,
});
