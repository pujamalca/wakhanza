import { QueryTypes } from 'sequelize';
import { sik } from '@/db/sik';
import { registerPlanCheck, MAX_ROWS_JENDELA_30_HARI } from './planChecks';
import { formatRawatPrefix } from './common';

/**
 * PENILAIAN AWAL KEPERAWATAN -- kelengkapan asesmen untuk pasien BARU.
 *
 * ==========================================================================
 * Apa yang dijawab modul ini, dan apa yang TIDAK
 * ==========================================================================
 *
 * Pasien yang `reg_periksa.status_poli = 'Baru'` wajib punya asesmen awal
 * keperawatan. Modul ini menjawab SATU pertanyaan: siapa yang belum punya, dan
 * siapa yang punya tapi isinya belum lengkap.
 *
 * Ia TIDAK membaca ISI asesmennya. Perbedaan itu bukan kerapian melainkan pagar
 * privasi yang ditegakkan daftar SELECT -- lihat seksi "Pagar privasi" di bawah.
 *
 * ==========================================================================
 * Kenapa `penilaian_awal_keperawatan_ralan`, dan kenapa CUMA itu untuk sekarang
 * ==========================================================================
 *
 * Khanza punya 31 tabel `penilaian_awal_keperawatan_*` -- gigi, mata, kebidanan,
 * igd, geriatri, psikiatri, ranap, dan seterusnya. Yang dipakai rumah sakit ini
 * baru SATU, dan itu terukur bukan diduga: dari seluruh 550 pasien Baru dalam 90
 * hari terakhir, `kd_poli` bernilai `UMUM` pada **550**, dan `status_lanjut`
 * bernilai `Ralan` pada **seluruh 12.354 baris `reg_periksa`** (nol Ranap).
 *
 * Karena itu modul ini sengaja hanya menangani yang umum/rawat jalan, dan
 * halamannya berdiri sebagai SUBMENU -- bukan tab -- justru supaya penilaian
 * poli lain bisa menyusul sebagai submenu berikutnya tanpa membongkar apa pun.
 *
 * ==========================================================================
 * Tiga golongan, bukan satu ambang -- dan ini DIUKUR
 * ==========================================================================
 *
 * Seluruh 57 kolom tabel asesmen `NOT NULL`, jadi Khanza menyimpan STRING KOSONG
 * dan bukan NULL. Akibatnya "ada barisnya" sama sekali tidak berarti "terisi".
 *
 * Diukur atas 191 baris asesmen milik pasien Baru dalam 90 hari:
 *
 *   keluhan_utama   0 kosong  (selalu diisi)
 *   td             51 kosong  (27%)
 *   suhu           53 kosong  (28%)
 *   nadi / rr      68 kosong  (36%)
 *   bb            144 kosong  (75%)
 *   tb            173 kosong  (91%)
 *
 * Menuntut SELURUH kolom terisi akan menandai hampir setiap asesmen sebagai
 * "belum lengkap", dan rekap yang isinya hampir semuanya berhenti dibaca dalam
 * sepekan -- sejak itu yang sungguhan ikut tidak terbaca. Pelajaran yang sama
 * sudah dibayar pada `farmasi.template_darurat_kosong` (default diam saat gudang
 * aman) dan pemisahan level log `debug`/`warn` di `wa-client.ts`.
 *
 * Karena itu golongannya TIGA, dan yang kedua ambangnya disetel RS:
 *
 *   BELUM   tidak ada baris sama sekali   <- kasus dominan: 359 dari 550 (65%)
 *   SEBAGIAN baris ada, kolom inti kosong
 *   LENGKAP  baris ada, kolom inti terisi
 *
 * `bb`/`tb` sengaja TIDAK masuk kolom inti bawaan: 75% dan 91% kosong berarti
 * memasukkannya membuat golongan SEBAGIAN menelan hampir seluruh golongan
 * LENGKAP, dan pembedaan yang tidak pernah membedakan apa pun sama saja dengan
 * tidak ada.
 *
 * ==========================================================================
 * Pagar privasi: yang TIDAK pernah di-SELECT
 * ==========================================================================
 *
 * Tabel asesmen memuat rekam medis telanjang -- `keluhan_utama`, `rpd` (riwayat
 * penyakit dahulu), `rpk` (riwayat penyakit keluarga), `rpo` (riwayat obat),
 * `alergi`, `status_psiko`, `nyeri`, `skala_nyeri`, `ekonomi`, `hub_keluarga`.
 * Tidak SATU pun ikut dalam daftar SELECT mana pun di berkas ini.
 *
 * Yang dibaca dari tabel itu hanya: apakah barisnya ADA, dan apakah kolom
 * vitalnya KOSONG. Perhatikan bentuknya -- `TRIM(p.td) <> ''` menghasilkan
 * boolean, jadi query ini mengetahui bahwa tekanan darah sudah diisi TANPA
 * pernah mengetahui berapa angkanya. Merender nilainya karena itu bukan
 * terlarang melainkan MUSTAHIL (§5.2), prinsip yang sama dengan `status_prb`
 * pada surat kontrol BPJS dan keenam kolom klinis pada `skdp_bpjs`.
 *
 * Identitas pasien (`no_rkm_medis`, `nm_pasien`) MEMANG diambil, dan itu
 * keputusan sadar: rekap yang tidak menyebut siapa tidak bisa ditindaklanjuti
 * perawat mana pun. Konsekuensinya ditanggung di tingkat kebijakan --
 * `erm.penilaian_enabled` default MATI, dan tingkat rinciannya bisa diturunkan
 * jadi angka saja lewat `erm.penilaian_rincian`.
 */

/** Kolom vital yang boleh dipakai sebagai penanda "terisi". */
export const KOLOM_INTI = ['td', 'nadi', 'suhu', 'rr', 'gcs', 'bb', 'tb', 'keluhan_utama'] as const;
export type KolomInti = (typeof KOLOM_INTI)[number];

/**
 * Bawaannya empat tanda vital, dan `bb`/`tb` sengaja di luar -- lihat pengukuran
 * di kepala berkas. RS bisa menambah/menguranginya lewat `erm.penilaian_kolom_inti`.
 */
export const KOLOM_INTI_BAWAAN: KolomInti[] = ['td', 'nadi', 'suhu', 'rr'];

export type StatusPenilaian = 'belum' | 'sebagian' | 'lengkap';

export interface BarisPenilaian {
  noRawat: string;
  noRkmMedis: string;
  namaPasien: string | null;
  jamReg: string | null;
  kdPoli: string | null;
  namaPoli: string | null;
  namaDokter: string | null;
  status: StatusPenilaian;
  /** Kolom inti yang masih kosong. Kosong berarti lengkap. */
  kosong: KolomInti[];
  /** Kapan asesmennya disimpan. null bila belum ada. */
  diisiPada: string | null;
}

export interface FilterPenilaian {
  /** Tanggal awal (inklusif), bentuk `YYYY-MM-DD`. */
  dari: string;
  /** Tanggal akhir (inklusif), bentuk `YYYY-MM-DD`. */
  sampai: string;
  /**
   * Kode poli yang dicakup. Kosong = seluruh poli.
   *
   * Ada karena penilaian poli LAIN akan menyusul sebagai submenu tersendiri.
   * Selama hanya `UMUM` yang terpakai, kosong dan `['UMUM']` menghasilkan baris
   * yang sama persis -- tapi pada hari Poliklinik Gigi mulai dipakai, tanpa
   * penyaring ini pasiennya akan dilaporkan "belum mengisi asesmen umum"
   * padahal yang wajib untuknya asesmen gigi. Kegagalan itu tidak menghasilkan
   * galat, cuma daftar yang diam-diam salah.
   */
  kdPoli?: string[];
  /** Batasi ke golongan tertentu. Kosong = semua. */
  status?: StatusPenilaian[];
  kolomInti?: KolomInti[];
}

/**
 * Daftar SELECT dan JOIN dipakai BERSAMA oleh daftar halaman dan rekap.
 *
 * Yang dijaga di sini bukan kolom yang ADA melainkan kolom yang TIDAK ada. Dua
 * daftar yang menyimpang berarti satu jalur diam-diam mulai membaca rekam medis
 * sementara yang lain tidak -- dan yang paling mungkin menyimpang adalah rekap,
 * karena isinya tidak dilihat siapa pun sebelum terkirim.
 *
 * Pola yang sama dengan `SELECT_SURAT_KONTROL` (`khanza/kontrolUlang.ts`).
 */
const FROM_JOIN = `
  FROM reg_periksa r
  LEFT JOIN pasien ps ON ps.no_rkm_medis = r.no_rkm_medis
  LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
  LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
  LEFT JOIN penilaian_awal_keperawatan_ralan p ON p.no_rawat = r.no_rawat
 WHERE r.no_rawat >= :awal AND r.no_rawat < :akhir
   AND r.status_poli = 'Baru'
   AND r.status_lanjut = 'Ralan'`;

/**
 * `status_lanjut = 'Ralan'` WAJIB, walau di mesin ini nol baris Ranap.
 *
 * Tabel asesmennya `_ralan`; pasien rawat inap punya
 * `penilaian_awal_keperawatan_ranap` yang berbeda. Tanpa penyaring ini, hari RS
 * mulai melayani rawat inap seluruh pasiennya akan dilaporkan "belum mengisi"
 * terhadap tabel yang memang bukan miliknya.
 */

/**
 * Penyaring POLI dikerjakan di APLIKASI, bukan di SQL -- dan itu diukur.
 *
 * Bentuk `AND r.kd_poli IN (:kdPoli)` membuat MariaDB meninggalkan `range` pada
 * PRIMARY dan memilih `ref` pada indeks `kd_poli`: terukur **5.054 baris
 * diperiksa, berbanding 668** lewat jendela tanggalnya saja. Optimizer menilai
 * `kd_poli` selektif, padahal di rumah sakit ini nyaris seluruh kunjungan
 * bernilai `UMUM` -- jadi penyaring yang dimaksudkan mempersempit justru
 * melebarkan tujuh kali lipat.
 *
 * Menyaring di sisi Node bebas biaya di sini karena jendelanya SUDAH dibatasi
 * tanggal: paling banyak beberapa ratus baris, dan halaman ini dibuka staf
 * sesekali -- bukan berulang di latar. Yang ikut didapat lebih penting daripada
 * kecepatannya: SATU bentuk SQL berarti satu rencana yang dijaga `verify:plans`,
 * bukan dua yang salah satunya bisa memburuk tanpa ada yang melihat.
 *
 * Pertimbangan yang sama sudah dipakai untuk penyaring `status` di bawah.
 */
function bangunSql(kolomInti: KolomInti[], urut: boolean): string {
  // Nama kolom TIDAK pernah datang dari luar: ia disaring terhadap KOLOM_INTI
  // di `normalkanKolomInti()` sebelum sampai ke sini, jadi interpolasi di bawah
  // tidak bisa menyisipkan SQL. Parameter terikat tidak bisa dipakai untuk nama
  // kolom, jadi daftar-izin itulah pengamannya.
  const cekKosong = kolomInti.map((k) => `TRIM(p.\`${k}\`) = ''`).join(' OR ') || '0';
  const perKolom = kolomInti.map((k) => `TRIM(p.\`${k}\`) = '' AS \`kosong_${k}\``).join(',\n         ');

  return `
    SELECT r.no_rawat, r.no_rkm_medis, ps.nm_pasien, r.jam_reg,
           r.kd_poli, pk.nm_poli, d.nm_dokter,
           p.no_rawat IS NOT NULL AS ada_asesmen,
           p.tanggal AS diisi_pada,
           (${cekKosong}) AS ada_kosong${perKolom ? ',\n           ' + perKolom : ''}
    ${FROM_JOIN}
    ${urut ? 'ORDER BY r.no_rawat' : ''}`;
}

/** Menyaring kolom yang diminta terhadap daftar-izin. Kosong -> bawaan. */
export function normalkanKolomInti(diminta: readonly string[] | undefined): KolomInti[] {
  if (!diminta || diminta.length === 0) return [...KOLOM_INTI_BAWAAN];
  const sah = diminta.filter((k): k is KolomInti => (KOLOM_INTI as readonly string[]).includes(k));
  return sah.length > 0 ? sah : [...KOLOM_INTI_BAWAAN];
}

interface BarisMentah {
  no_rawat: string;
  no_rkm_medis: string;
  nm_pasien: string | null;
  jam_reg: string | null;
  kd_poli: string | null;
  nm_poli: string | null;
  nm_dokter: string | null;
  ada_asesmen: number;
  diisi_pada: string | null;
  ada_kosong: number;
  [k: string]: unknown;
}

function petakan(b: BarisMentah, kolomInti: KolomInti[]): BarisPenilaian {
  const ada = Number(b.ada_asesmen) === 1;
  const kosong = ada ? kolomInti.filter((k) => Number(b[`kosong_${k}`]) === 1) : [];
  return {
    noRawat: b.no_rawat,
    noRkmMedis: b.no_rkm_medis,
    namaPasien: b.nm_pasien,
    jamReg: b.jam_reg,
    kdPoli: b.kd_poli,
    namaPoli: b.nm_poli,
    namaDokter: b.nm_dokter,
    status: !ada ? 'belum' : kosong.length > 0 ? 'sebagian' : 'lengkap',
    kosong,
    diisiPada: ada ? b.diisi_pada : null,
  };
}

/**
 * Seluruh pasien Baru dalam rentang tanggal, berikut status kelengkapannya.
 *
 * Rentangnya dipangkas lewat PREFIX `no_rawat`, bukan `tgl_registrasi` -- kolom
 * tanggal Khanza tidak terindeks (§4.4), sementara `no_rawat` adalah PRIMARY KEY
 * yang menyandikan tanggalnya sebagai `YYYY/MM/DD/NNNNNN`.
 *
 * Prefiksnya EKSAK, dan itu diukur atas SELURUH 12.354 baris: cocok dengan
 * `tgl_registrasi` pada 12.354, menyimpang pada NOL. Sekelas `nota_jual`
 * (migrations/040), bukan sekelas `no_faktur` pengadaan yang butuh margin 31
 * hari. Tidak ada margin yang perlu ditambahkan.
 *
 * Terukur `type=range key=PRIMARY`, seluruh join `eq_ref` -- TANPA izin pindai
 * penuh, dan izinnya sengaja tidak ditulis walau "aman kalau ada": izin yang
 * menganggur adalah izin yang diam-diam menutupi kemunduran berikutnya.
 */
export async function daftarPenilaianAwal(f: FilterPenilaian): Promise<BarisPenilaian[]> {
  const kolomInti = normalkanKolomInti(f.kolomInti);
  const rows = await sik.query<BarisMentah>(bangunSql(kolomInti, true), {
    type: QueryTypes.SELECT,
    replacements: {
      // `formatRawatPrefix` yang SUDAH ada, bukan penurunan kedua: prefiks yang
      // dihitung dua tempat adalah prefiks yang cepat atau lambat berbeda satu
      // hari di salah satunya, dan yang muncul bukan galat melainkan pasien yang
      // hilang dari daftar.
      awal: formatRawatPrefix(keTanggal(f.dari)),
      akhir: formatRawatPrefix(keTanggal(tambahHari(f.sampai, 1))),
    },
  });

  let hasil = rows.map((b) => petakan(b, kolomInti));
  if (f.kdPoli && f.kdPoli.length > 0) {
    const poli = new Set(f.kdPoli);
    hasil = hasil.filter((b) => b.kdPoli !== null && poli.has(b.kdPoli));
  }
  if (f.status && f.status.length > 0) {
    const diminta = new Set(f.status);
    hasil = hasil.filter((b) => diminta.has(b.status));
  }
  return hasil;
}

export interface RingkasPenilaian {
  tanggal: string;
  total: number;
  belum: number;
  sebagian: number;
  lengkap: number;
  /** Yang perlu ditindaklanjuti: belum + sebagian. */
  perluDiisi: BarisPenilaian[];
}

/**
 * Rekap SATU hari, bentuk yang dipakai pesan terjadwal.
 *
 * Memanggil `daftarPenilaianAwal()` yang sama, bukan query kedua. Dua query yang
 * sama-sama menghitung "berapa yang belum" pasti menyimpang, dan yang muncul saat
 * menyimpang bukan galat melainkan halaman dan pesan WhatsApp yang menyebut angka
 * berbeda untuk hari yang sama.
 */
export async function rekapPenilaianAwal(
  tanggal: string,
  opsi: Pick<FilterPenilaian, 'kdPoli' | 'kolomInti'> = {},
): Promise<RingkasPenilaian> {
  const semua = await daftarPenilaianAwal({ dari: tanggal, sampai: tanggal, ...opsi });
  return {
    tanggal,
    total: semua.length,
    belum: semua.filter((b) => b.status === 'belum').length,
    sebagian: semua.filter((b) => b.status === 'sebagian').length,
    lengkap: semua.filter((b) => b.status === 'lengkap').length,
    perluDiisi: semua.filter((b) => b.status !== 'lengkap'),
  };
}

/** `YYYY-MM-DD` -> Date LOKAL. Bukan `new Date(str)`, yang menafsirkannya UTC. */
function keTanggal(tanggal: string): Date {
  const [y, m, d] = tanggal.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** `YYYY-MM-DD` + n hari, lewat setDate supaya pergantian bulan ditangani Node. */
function tambahHari(tanggal: string, n: number): string {
  const dt = keTanggal(tanggal);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * Ambangnya `MAX_ROWS_JENDELA_30_HARI`, sekelas QUEUE_REG -- ia memang membaca
 * jendela atas `reg_periksa` yang sama. Terukur 668 baris pada jendela 31 hari;
 * bawaan 500 akan gagal bukan karena query-nya buruk melainkan karena angka itu
 * memang tidak pernah dikalibrasi untuk tabel ini.
 */
registerPlanCheck({
  name: 'ERM_PENILAIAN_AWAL',
  sql: bangunSql(KOLOM_INTI_BAWAAN, true),
  replacements: { awal: '2026/07/01', akhir: '2026/08/01' },
  maxRows: MAX_ROWS_JENDELA_30_HARI,
});
