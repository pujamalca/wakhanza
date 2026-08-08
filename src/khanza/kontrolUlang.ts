import { sikSelect } from '@/db/sik';
import { tahunDariTanggal } from '@/core/bpjs';
import { registerPlanCheck } from './planChecks';

/**
 * SURAT KONTROL (menu "Surat Kontrol" di Khanza, `src/surat/SuratKontrol.java`)
 * -- pengingat kontrol untuk pasien yang TIDAK lewat kanal BPJS.
 *
 * ==========================================================================
 * Tabelnya bernama `skdp_bpjs`, dan nama itu MENYESATKAN
 * ==========================================================================
 *
 * Khanza punya DUA menu bernama mirip, dan keduanya menulis tabel berbeda:
 *
 *   "Surat Kontrol"         -> surat/SuratKontrol.java     -> `skdp_bpjs`
 *   "Surat Kontrol VClaim"  -> bridging/BPJSSuratKontrol   -> `bridging_surat_kontrol_bpjs`
 *
 * Yang kedua sudah ditangani `bpjsKontrol.ts` (pemicu BPJS_KONTROL). Yang
 * PERTAMA -- berkas ini -- adalah surat kontrol yang diterbitkan sendiri oleh
 * rumah sakit, tanpa bridging. Akhiran `_bpjs` pada nama tabelnya peninggalan
 * sejarah (SKDP = Surat Keterangan Dalam Perawatan, formulir BPJS lama); isinya
 * sekarang dipakai untuk pasien mana pun, dan justru pasien non-BPJS-lah yang
 * tidak punya jalur pengingat lain.
 *
 * Jangan menggabungkan keduanya. Sumber datanya berbeda, kolomnya berbeda, dan
 * satu-satunya yang sama adalah maksudnya.
 *
 * ==========================================================================
 * PRIVASI: enam kolom yang tidak pernah disentuh, dan semuanya di tabel ini
 * ==========================================================================
 *
 * `skdp_bpjs` menyimpan `diagnosa`, `terapi`, `alasan1`, `alasan2`, `rtl1`,
 * `rtl2` -- keenamnya rekam medis telanjang, dan keenamnya benar-benar TERCETAK
 * di surat yang dipegang pasien (`report/rptSuratSKDPBPJS.jrxml` memakai
 * `$F{temp4}`..`$F{temp9}` untuk itu). Surat kertas diserahkan ke satu orang di
 * loket; pesan WhatsApp diteruskan tanpa batas.
 *
 * Query di bawah TIDAK men-SELECT satu pun dari keenamnya. Ini penegakan §5.2,
 * bukan kerapian: `{diagnosa}` bukan sekadar terlarang di template, ia MUSTAHIL
 * -- datanya tidak pernah sampai ke proses ini. Kalau suatu saat ada yang ingin
 * menyebut diagnosis di pengingat, itu bukan perubahan template melainkan
 * perubahan kelas data yang beredar lewat WhatsApp, dan pintunya sengaja
 * ditutup di sini.
 */
export interface KontrolUlangRow {
  /** Tahun surat = kolom pertama PRIMARY KEY, dan sekaligus pemangkasnya. */
  tahun: number;
  /** Nomor surat, 6 digit urut per tahun. Tercetak sebagai "NO. SURAT". */
  no_antrian: string;
  no_rkm_medis: string | null;
  /** Tanggal pasien harus datang kembali (YYYY-MM-DD, `dateStrings: true`). */
  tgl_kontrol: string;
  /**
   * Tanggal suratnya dibuat (`tanggal_rujukan`). Namanya di Khanza menyesatkan
   * -- "rujukan" di sini berarti tanggal surat, bukan tanggal rujuk. Dibuktikan
   * dari `SuratKontrol.java`: parameter ke-10 diisi dari kotak **Tanggal
   * Surat**, sementara parameter ke-9 (`tanggal_datang`) dari kotak Tanggal
   * Periksa.
   *
   * Dipakai KONTROL_TERBIT sebagai jendela pindainya; ikut dibaca di sini
   * supaya daftar kolomnya SATU untuk kedua pemicu -- yang tidak boleh
   * menyimpang bukan kolom yang ada, melainkan keenam kolom klinis yang tidak
   * ada.
   */
  tgl_surat: string;
  nm_pasien: string | null;
  no_tlp: string | null;
  nm_dokter: string | null;
  /**
   * Kode poli -- yang dibaca `checkPrivacy()`.
   *
   * TIDAK ADA di `skdp_bpjs`. Satu-satunya jalan mendapatkannya adalah lewat
   * baris `booking_registrasi` yang dibuat Khanza bersamaan dengan suratnya,
   * dan itu hanya terjadi bila setelan Khanza `JADIKANBOOKINGSURATKONTROL`
   * bernilai `yes` (`setting/database.xml`, BUKAN tabel -- jadi tidak terlihat
   * dari sini sama sekali).
   *
   * Konsekuensi yang WAJIB disadari: di instalasi yang setelannya `no`, kolom
   * ini NULL, dan `checkPrivacy()` memperlakukan poli yang tidak diketahui
   * sebagai aman (`if (input.kdPoli && ...)`). Jadi penggantian pesan generik
   * untuk poli sensitif diam-diam tidak berlaku di sana. Runner-nya menghitung
   * dan mencatat berapa baris yang kehilangan poli justru supaya keadaan itu
   * TERLIHAT alih-alih senyap -- lihat `worker/kontrolUlangRunner.ts`.
   *
   * Di mesin ini setelannya `yes` dan terukur 253/253 surat punya bookingnya.
   */
  kd_poli: string | null;
  nm_poli: string | null;
}

/**
 * PEMANGKASNYA `tahun`, DAN IA EKSAK -- kasus paling bersih di proyek ini.
 *
 * PRIMARY KEY-nya `(tahun, no_antrian)`, jadi `tahun` adalah kolom pertama
 * indeks berkelompok. Yang membuatnya benar-benar bisa dipakai: `tahun` diisi
 * Khanza dari tahun kotak **Tanggal Periksa** yang sama persis yang mengisi
 * `tanggal_datang` (`SuratKontrol.java`: `TanggalPeriksa.substring(6,10)` untuk
 * `tahun`, `TanggalPeriksa` utuh untuk `tanggal_datang`) -- satu sumber, dua
 * kolom, jadi keduanya tidak bisa menyimpang.
 *
 * Diukur atas 275 baris di tiga database: **0 meleset**, 0 `tanggal_datang`
 * NULL. Bandingkan dengan prefiks `no_faktur` pengadaan (9 dari 910 menyimpang)
 * dan prefiks `nobooking` pembatalan BPJS (144 dari 1.808 menyimpang, sampai
 * 105 hari) -- yang terakhir itu justru yang membuat pemangkas prefiks di sana
 * TIDAK boleh dipakai. Di sini tidak ada margin yang perlu ditambahkan, dan
 * menambahkannya cuma akan membaca tahun yang tidak berisi apa-apa.
 *
 * `tahun` diserahkan sebagai LARIK, bukan satu nilai: setelan "7,1" pada 28
 * Desember menghasilkan tanggal sasaran di dua tahun berbeda, dan satu tahun
 * saja akan membuang yang seberang tanpa satu pun galat.
 *
 * ==========================================================================
 * `status = 'Menunggu'` WAJIB, dan Khanza sendiri yang menyediakan kolomnya
 * ==========================================================================
 *
 * Kolomnya enum tiga nilai: 'Menunggu', 'Sudah Periksa', 'Batal Periksa'.
 * Terukur di database rujukan: 151 'Menunggu' berbanding 102 'Sudah Periksa'.
 * Mengingatkan pasien yang sudah datang, atau yang kontrolnya sudah dibatalkan,
 * bukan sekadar mubazir -- ia membuat pasien datang untuk kedua kalinya. Sama
 * jenisnya dengan pelajaran `p.status='1'` pada jadwal dokter: baris yang sudah
 * tidak berlaku tetap ada di tabelnya, dan menjawabnya lengkap membuat orang
 * bertindak atas keterangan yang salah.
 *
 * ==========================================================================
 * TANPA izin pindai penuh, termasuk untuk `booking_registrasi`
 * ==========================================================================
 *
 * `booking_registrasi` adalah satu-satunya tabel yang punya izin pindai penuh
 * yang disengaja di proyek ini (§4.4) -- tapi izin itu ada karena BOOK_CONFIRM
 * memangkasnya lewat `tanggal_periksa >= today`, yang tidak terindeks. Di sini
 * ia dimasuki lewat PRIMARY KEY-nya sendiri `(no_rkm_medis, tanggal_periksa)`
 * dan keduanya terisi, jadi ia `eq_ref`. Terbukti lewat EXPLAIN: `s` = `ref
 * PRIMARY`, keempat join = `eq_ref`. Izinnya sengaja TIDAK ditulis walau "aman
 * kalau ada" -- izin pindai penuh yang menganggur adalah izin yang diam-diam
 * menutupi kemunduran berikutnya.
 */
/**
 * Daftar kolom + join, DIPAKAI BERSAMA oleh kedua pemicu surat kontrol
 * (KONTROL_ULANG di berkas ini, KONTROL_TERBIT di `kontrolTerbit.ts`).
 *
 * Berdiri sebagai fragmen bersama, bukan disalin, dan yang dijaga bukan kolom
 * yang ADA melainkan keenam yang TIDAK ada: `diagnosa`, `terapi`, `alasan1`,
 * `alasan2`, `rtl1`, `rtl2`. Dua daftar kolom yang menyimpang berarti satu
 * pemicu diam-diam mulai membaca rekam medis sementara yang lain tidak, dan
 * tidak ada satu pun galat yang menandainya.
 *
 * `status = 'Menunggu'` ikut di sini dengan alasan yang sama: ia berlaku untuk
 * keduanya. Mengingatkan pasien yang kontrolnya sudah dibatalkan, atau
 * mengabarkan surat yang batal, sama-sama membuat orang bertindak atas
 * keterangan yang salah.
 */
export const SELECT_SURAT_KONTROL = `
  SELECT
    s.tahun,
    s.no_antrian,
    s.no_rkm_medis,
    DATE(s.tanggal_datang) AS tgl_kontrol,
    DATE(s.tanggal_rujukan) AS tgl_surat,
    p.nm_pasien,
    p.no_tlp,
    d.nm_dokter,
    b.kd_poli,
    pk.nm_poli
  FROM skdp_bpjs s
  LEFT JOIN pasien p ON p.no_rkm_medis = s.no_rkm_medis
  LEFT JOIN dokter d ON d.kd_dokter = s.kd_dokter
  LEFT JOIN booking_registrasi b
    ON b.no_rkm_medis = s.no_rkm_medis
   AND b.tanggal_periksa = DATE(s.tanggal_datang)
  LEFT JOIN poliklinik pk ON pk.kd_poli = b.kd_poli
`;

const SQL_KONTROL_ULANG = `
  ${SELECT_SURAT_KONTROL}
  WHERE s.tahun IN (:tahun)
    AND DATE(s.tanggal_datang) IN (:tanggalTarget)
    AND s.status = 'Menunggu'
  ORDER BY s.tanggal_datang, s.no_antrian
  LIMIT 500
`;

/**
 * @param tanggalTarget daftar tanggal kontrol (YYYY-MM-DD) yang jatuh tempo
 *   diingatkan hari ini. Kosong = tidak ada yang perlu dibaca; `IN ()` juga
 *   bukan SQL yang sah.
 */
export async function pollKontrolUlang(tanggalTarget: string[]): Promise<KontrolUlangRow[]> {
  if (tanggalTarget.length === 0) return [];
  const tahun = tahunDariTanggal(tanggalTarget);
  if (tahun.length === 0) return [];
  return sikSelect<KontrolUlangRow>(SQL_KONTROL_ULANG, { tahun, tanggalTarget });
}

/**
 * `maxRows` 20000 -- kira-kira dua tahun surat kontrol di rumah sakit yang
 * benar-benar memakai menu ini, karena setelan yang merentang pergantian tahun
 * memang membaca dua tahun sekaligus.
 *
 * Yang dijaga ambang ini BUKAN "apakah jendelanya membengkak" (jendelanya
 * tanggal, dan selalu sempit) melainkan "apakah satu tahun masih irisan yang
 * wajar dibaca sekali sehari". Kalau ia berbunyi, yang perlu ditinjau adalah
 * memangkas lewat `tanggal_datang` yang terindeks -- bukan sekadar menaikkan
 * angkanya.
 */
registerPlanCheck({
  name: 'KONTROL_ULANG',
  sql: SQL_KONTROL_ULANG,
  replacements: { tahun: [new Date().getFullYear()], tanggalTarget: ['2026-01-01'] },
  maxRows: 20000,
});
