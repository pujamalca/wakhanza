import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { formatRawatPrefix, lookbackDate } from './common';

/**
 * Surat keterangan SAKIT dan SEHAT, untuk dikirim ke pasien sebagai berkas PDF.
 *
 * ==========================================================================
 * KEDUANYA BERBEDA BENTUK, dan itu bukan detail -- ia menentukan halamannya
 * ==========================================================================
 *
 * Dibuktikan dari sumber Khanza sendiri (`src/surat/SuratSakit.java` dan
 * `src/simrskhanza/DlgReg.java`), bukan disimpulkan dari nama tabel:
 *
 *   Surat sakit   `suratsakit`     ADA catatannya: no_surat, tanggal, lama.
 *                                  Dokter sudah memutuskan dan menyimpannya.
 *   Surat sehat   -- tidak ada --  `rptSuratSehat.jasper` dicetak LANGSUNG dari
 *                                  layar registrasi atas `reg_periksa` +
 *                                  `pasien` + `dokter`. Tidak ada nomor surat,
 *                                  tidak ada baris yang tersimpan.
 *
 * Itulah sebabnya `surat_keterangan_sehat` KOSONG di kedua database di mesin
 * ini (0 baris di `alca` maupun `sik`) sementara `suratsakit` berisi 18 baris:
 * tabel itu milik FORMULIR LAIN (`SuratKeteranganSehat.java` ->
 * `rptDataSuratKeteranganSehat.jasper`), bukan milik surat yang dirujuk.
 *
 * Akibat yang harus disadari siapa pun yang menyentuh ini: mengirim surat
 * sakit berarti MENGANTARKAN ULANG keputusan yang sudah diambil dokter dan
 * tercatat. Mengirim surat sehat berarti MENERBITKAN surat atas kunjungan --
 * tidak ada baris di database yang menyatakan dokter menyimpulkan "sehat".
 * Karena itu kesimpulannya diambil dari `surat_keterangan_sehat` bila barisnya
 * kebetulan ada, dan halamannya mewajibkan staf menekan kirim satu per satu.
 * Batas ini tidak bisa diselesaikan kode -- lihat CLAUDE.md §"Yang masih perlu
 * keputusan rumah sakit".
 *
 * ==========================================================================
 * PRIVASI
 * ==========================================================================
 *
 * `kd_poli` diambil sebagai KODE dan hanya untuk `checkPrivacy()`, seperti
 * pemicu pasien lain. Yang TIDAK pernah diambil: `diagnosa_pasien` /
 * `penyakit` -- kecuali RS menyalakannya sendiri, dan saat mati kolomnya tidak
 * ikut di-SELECT sama sekali sehingga merendernya mustahil, bukan sekadar
 * terlarang (§5.2). Bentuk yang sama dengan `farmasi.stok_pakai_batch`:
 * keputusannya dibaca PEMANGGIL lalu diserahkan sebagai parameter, karena
 * modul `khanza/` tidak boleh menyentuh pengaturan -- batas itu yang membuat
 * `npm run verify:db` bisa membuktikan `sik` hanya dibaca.
 */

export interface BarisSuratSakit {
  no_surat: string;
  no_rawat: string;
  tanggalawal: string | null;
  tanggalakhir: string | null;
  lamasakit: string | null;
  tgl_registrasi: string | null;
  umurdaftar: number | null;
  sttsumur: string | null;
  no_rkm_medis: string;
  /** Kode saja, untuk checkPrivacy() -- nama polinya tidak pernah masuk surat. */
  kd_poli: string | null;
  nm_pasien: string | null;
  jk: string | null;
  no_tlp: string | null;
  alamat: string | null;
  nm_kel: string | null;
  nm_kec: string | null;
  nm_kab: string | null;
  pekerjaan: string | null;
  nama_perusahaan: string | null;
  nm_dokter: string | null;
  /**
   * Dipakai HANYA sebagai baris "ID" di dalam QR pengesahan, mengikuti
   * `finger` milik Khanza -- lihat `teksAsalUsul()` di `core/suratDoc.ts`,
   * termasuk kenapa `sidikjari` sengaja tidak ikut dibaca.
   */
  kd_dokter: string | null;
  /** Hanya terisi bila pemanggil meminta diagnosa; NULL/absen bila tidak. */
  diagnosa?: string | null;
}

export interface BarisSuratSehat {
  no_rawat: string;
  tgl_registrasi: string | null;
  umurdaftar: number | null;
  sttsumur: string | null;
  no_rkm_medis: string;
  kd_poli: string | null;
  nm_pasien: string | null;
  jk: string | null;
  tgl_lahir: string | null;
  no_tlp: string | null;
  alamat: string | null;
  nm_kel: string | null;
  nm_kec: string | null;
  nm_kab: string | null;
  pekerjaan: string | null;
  nm_dokter: string | null;
  /**
   * Dipakai HANYA sebagai baris "ID" di dalam QR pengesahan, mengikuti
   * `finger` milik Khanza -- lihat `teksAsalUsul()` di `core/suratDoc.ts`,
   * termasuk kenapa `sidikjari` sengaja tidak ikut dibaca.
   */
  kd_dokter: string | null;
  /** Dari `surat_keterangan_sehat` bila barisnya ada -- kosong di mesin ini. */
  kesimpulan: string | null;
  butawarna: string | null;
  keperluan: string | null;
}

/**
 * Bagian identitas pasien, dipakai KEDUA surat.
 *
 * Satu penurunan, bukan dua salinan yang berbeda satu kolom -- bentuk kegagalan
 * yang sudah dibayar berkali-kali di proyek ini (`respectsOptOut()`,
 * `core/outboxStatus.ts`, `kunciPesanMasuk()`).
 *
 * Wilayah lewat LEFT JOIN, dan itu KOREKSI atas Khanza yang disengaja: query
 * cetak miliknya memakai INNER JOIN ke `kelurahan`, `kecamatan`, `kabupaten`,
 * DAN `perusahaan_pasien` sekaligus, sehingga pasien yang salah satunya belum
 * diisi tidak bisa dicetak surat sama sekali -- gagal tanpa menyebut sebab.
 */
const IDENTITAS_SELECT = `
      r.tgl_registrasi, r.umurdaftar, r.sttsumur, r.no_rkm_medis, r.kd_poli,
      p.nm_pasien, p.jk, p.no_tlp, p.alamat, p.pekerjaan,
      kel.nm_kel, kec.nm_kec, kab.nm_kab,
      d.nm_dokter, d.kd_dokter`;

const IDENTITAS_JOIN = `
    JOIN reg_periksa r ON r.no_rawat = ss.no_rawat
    LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
    LEFT JOIN kelurahan kel ON kel.kd_kel = p.kd_kel
    LEFT JOIN kecamatan kec ON kec.kd_kec = p.kd_kec
    LEFT JOIN kabupaten kab ON kab.kd_kab = p.kd_kab
    LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter`;

/**
 * Sub-query diagnosa, disisipkan HANYA bila RS menyalakannya.
 *
 * Bentuknya mengikuti Khanza persis (`concat(kd_penyakit,' ',nm_penyakit)`,
 * `prioritas` menaik) supaya surat yang dikirim wakhanza menyebut diagnosa yang
 * sama dengan yang dicetak di loket -- dua sistem yang menyebut diagnosa
 * berbeda untuk satu kunjungan jauh lebih buruk daripada satu yang diam.
 *
 * Dipisah sebagai string yang ditempel bersyarat, bukan kolom yang selalu ada
 * lalu disaring belakangan: yang tidak pernah dibaca dari database tidak bisa
 * bocor lewat log, pesan galat, maupun baris `outbox`.
 */
const DIAGNOSA_SELECT = `,
      (
        SELECT CONCAT(dp.kd_penyakit, ' ', pny.nm_penyakit)
        FROM diagnosa_pasien dp
        JOIN penyakit pny ON pny.kd_penyakit = dp.kd_penyakit
        WHERE dp.no_rawat = r.no_rawat
        ORDER BY dp.prioritas
        LIMIT 1
      ) AS diagnosa`;

/**
 * Tiga bentuk, satu penurunan.
 *
 *   `satu`      satu surat lewat PK -- pratinjau dan kirim manual
 *   `rentang`   daftar di layar, TERBARU dulu (yang dicari staf ada di atas)
 *   `otomatis`  jendela pindai milik worker, TERTUA dulu
 *
 * Urutan `otomatis` sengaja terbalik dari `rentang`, dan itu bukan selera: bila
 * jendelanya berisi lebih banyak surat daripada yang boleh dikirim satu siklus,
 * yang dikerjakan lebih dulu harus yang paling lama menunggu. Terbaru-dulu akan
 * membuat surat tertua di jendela didorong keluar oleh yang lebih baru setiap
 * siklus, dan ia tidak pernah terkirim tanpa satu pun galat.
 */
type BentukSuratSakit = 'satu' | 'rentang' | 'otomatis';

/**
 * Batas baris jendela pindai otomatis.
 *
 * Lebih longgar daripada 200 milik daftar layar karena keduanya menjawab hal
 * berbeda: 200 di layar adalah sebanyak yang masuk akal DIBACA orang, sementara
 * yang ini sebanyak yang perlu DIPERIKSA mesin -- dan yang sudah pernah dikirim
 * disaring sesudahnya, jadi jumlah baris di sini bukan jumlah pesan.
 */
const BATAS_JENDELA_OTOMATIS = 500;

function buildSuratSakitSql(sertakanDiagnosa: boolean, bentuk: BentukSuratSakit): string {
  const satuSurat = bentuk === 'satu';
  return `
    SELECT
      ss.no_surat, ss.no_rawat, ss.tanggalawal, ss.tanggalakhir, ss.lamasakit,
      ${IDENTITAS_SELECT},
      pr.nama_perusahaan${sertakanDiagnosa ? DIAGNOSA_SELECT : ''}
    FROM suratsakit ss
    ${IDENTITAS_JOIN}
    LEFT JOIN perusahaan_pasien pr ON pr.kode_perusahaan = p.perusahaan_pasien
    WHERE ${satuSurat ? 'ss.no_surat = :noSurat' : 'ss.no_surat >= :awalPrefix AND ss.no_surat <= :akhirPrefix'}
    ORDER BY ss.no_surat ${bentuk === 'otomatis' ? 'ASC' : 'DESC'}
    LIMIT ${satuSurat ? 1 : bentuk === 'otomatis' ? BATAS_JENDELA_OTOMATIS : 200}
  `;
}

/**
 * Pemangkas `no_surat` -- berindeks sempurna, tapi TANGGALNYA TIDAK EKSAK.
 * Bacalah bagian kedua sebelum memakainya sebagai penanda kejadian.
 *
 * Bentuknya `SKS` + `YYYYMMDD` + urutan 3 digit: terurut leksikal lintas tahun,
 * dan ia PRIMARY KEY, jadi rentang tanggal jatuh langsung jadi `range` pada
 * PRIMARY tanpa kolom bantu apa pun. Sebagai PEMANGKAS ia sempurna.
 *
 * ==========================================================================
 * Tanggal apa yang sebenarnya tersandi di sana -- diukur, bukan disimpulkan
 * ==========================================================================
 *
 * Berkas ini sempat menyatakan "yang disandikannya tanggal surat DIBUAT". Itu
 * keliru, dan sumber Khanza sendiri yang membantahnya: `SuratSakit.java` (`Valid
 * .autoNomer3`) merakit prefiksnya dari isi kotak **Tanggal Awal** pada saat
 * nomornya dibuatkan -- bukan dari tanggal hari ini, dan bukan pula dari nilai
 * `tanggalawal` yang akhirnya tersimpan (staf masih bisa menggeser tanggalnya
 * sesudah nomornya keluar).
 *
 * Diukur atas 18 baris di database ini, tanggal di nomor surat cocok dengan:
 *
 *   `tanggalawal`              13 dari 18
 *   `reg_periksa.tgl_registrasi` 15 dari 18
 *
 * -- jadi ia bukan salah satunya secara andal, melainkan "isi kotak tanggal
 * awal saat nomor dibuatkan", yang biasanya (tidak selalu) jatuh pada hari
 * suratnya ditulis. Selisih `tanggalawal` terhadap tanggal kunjungan terentang
 * 0 sampai 6 hari.
 *
 * DUA akibat yang mengikat siapa pun yang menyentuh ini:
 *
 * 1. Untuk DAFTAR di layar ia tetap pemangkas yang benar dan cukup baik -- staf
 *    mencari surat "sekitar tanggal sekian", dan meleset sehari tertutup oleh
 *    rentang yang memang mereka atur sendiri. `tanggalawal` tidak dipakai
 *    sebagai penyaring karena kolom itu tidak terindeks (§4.4).
 *
 * 2. Untuk PEMICU ia TIDAK boleh dipakai sebagai watermark. Nomor yang tidak
 *    monoton terhadap urutan penyimpanan berarti satu surat yang tersimpan hari
 *    ini bisa bernomor lebih kecil daripada watermark, lalu dilewati selamanya
 *    tanpa satu pun galat -- kelas kegagalan yang sama persis dengan prefiks
 *    `nobooking` pada pembatalan BPJS. Karena itu pengiriman otomatis memakai
 *    JENDELA yang dipindai ulang tiap siklus dengan dedup murni lewat kunci
 *    idempoten, bukan watermark yang maju sekali jalan.
 */
function prefixSurat(tanggal: string, akhir: boolean): string {
  const angka = tanggal.replace(/-/g, '');
  return `SKS${angka}${akhir ? '999' : '000'}`;
}

export async function cariSuratSakit(dariTanggal: string, sampaiTanggal: string): Promise<BarisSuratSakit[]> {
  return sikSelect<BarisSuratSakit>(buildSuratSakitSql(false, 'rentang'), {
    awalPrefix: prefixSurat(dariTanggal, false),
    akhirPrefix: prefixSurat(sampaiTanggal, true),
  });
}

export async function ambilSuratSakit(noSurat: string, sertakanDiagnosa: boolean): Promise<BarisSuratSakit | null> {
  const rows = await sikSelect<BarisSuratSakit>(buildSuratSakitSql(sertakanDiagnosa, 'satu'), { noSurat });
  return rows[0] ?? null;
}

/**
 * Jendela pindai untuk PENGIRIMAN OTOMATIS.
 *
 * Query-nya sama persis dengan daftar layar -- hanya urutan dan batasnya yang
 * beda -- dan itu disengaja: yang dikirim otomatis wajib surat yang sama dengan
 * yang dilihat staf di tab Surat sakit, termasuk identitas dan alamat yang
 * dirakit LEFT JOIN. Dua penurunan untuk satu hal adalah bentuk kegagalan yang
 * sudah dibayar berkali-kali di proyek ini.
 *
 * Jendelanya merentang KE DUA ARAH dari hari ini, dan arah majunya bukan
 * kehati-hatian melainkan konsekuensi dari § di atas: sebuah surat yang ditulis
 * hari ini untuk istirahat mulai pekan depan bernomor lebih BESAR daripada
 * prefiks hari ini. Batas atas yang berhenti di hari ini akan membuang persis
 * surat-surat itu.
 */
export async function pollSuratSakitJendela(
  dariTanggal: string,
  sampaiTanggal: string,
  sertakanDiagnosa: boolean,
): Promise<BarisSuratSakit[]> {
  return sikSelect<BarisSuratSakit>(buildSuratSakitSql(sertakanDiagnosa, 'otomatis'), {
    awalPrefix: prefixSurat(dariTanggal, false),
    akhirPrefix: prefixSurat(sampaiTanggal, true),
  });
}

/** Jendela penuh terbaca = tanda ada yang mungkin luput; dipakai runner untuk memperingatkan. */
export const JENDELA_OTOMATIS_PENUH = BATAS_JENDELA_OTOMATIS;

/**
 * Kunjungan yang bisa diterbitkan surat sehat.
 *
 * Berangkat dari `reg_periksa` dan dipangkas prefix `no_rawat` (§4.4) -- bukan
 * `tgl_registrasi`, yang tidak terindeks. `status_lanjut` tidak disaring:
 * pasien rawat inap pun bisa meminta surat sehat setelah pulang.
 */
const SEHAT_SQL = `
    SELECT
      ss.no_rawat,
      ${IDENTITAS_SELECT},
      p.tgl_lahir,
      sks.kesimpulan, sks.butawarna, sks.keperluan
    FROM reg_periksa ss
    ${IDENTITAS_JOIN}
    LEFT JOIN surat_keterangan_sehat sks ON sks.no_rawat = ss.no_rawat
    WHERE ss.no_rawat >= :awalPrefix AND ss.no_rawat < :akhirPrefix
    ORDER BY ss.no_rawat DESC
    LIMIT 200
  `;

const SEHAT_SATU_SQL = `
    SELECT
      ss.no_rawat,
      ${IDENTITAS_SELECT},
      p.tgl_lahir,
      sks.kesimpulan, sks.butawarna, sks.keperluan
    FROM reg_periksa ss
    ${IDENTITAS_JOIN}
    LEFT JOIN surat_keterangan_sehat sks ON sks.no_rawat = ss.no_rawat
    WHERE ss.no_rawat = :noRawat
    LIMIT 1
  `;

/** Tanggal lokal + N hari, untuk batas atas prefix yang eksklusif. */
function tambahHari(tanggal: string, hari: number): Date {
  const d = new Date(`${tanggal}T00:00:00`);
  d.setDate(d.getDate() + hari);
  return d;
}

export async function cariKunjunganSehat(dariTanggal: string, sampaiTanggal: string): Promise<BarisSuratSehat[]> {
  return sikSelect<BarisSuratSehat>(SEHAT_SQL, {
    awalPrefix: formatRawatPrefix(tambahHari(dariTanggal, 0)),
    // Batas ATAS eksklusif: prefix hari BERIKUTNYA, supaya seluruh kunjungan
    // pada `sampaiTanggal` ikut terbaca berapa pun nomor urutnya. Memakai
    // `<= prefix(sampai)` akan membuang semuanya, karena `2026/08/06` secara
    // leksikal lebih kecil daripada `2026/08/06/000001`.
    akhirPrefix: formatRawatPrefix(tambahHari(sampaiTanggal, 1)),
  });
}

export async function ambilKunjunganSehat(noRawat: string): Promise<BarisSuratSehat | null> {
  const rows = await sikSelect<BarisSuratSehat>(SEHAT_SATU_SQL, { noRawat });
  return rows[0] ?? null;
}

const CONTOH_TGL_AWAL = formatRawatPrefix(lookbackDate(30));
const CONTOH_TGL_AKHIR = formatRawatPrefix(lookbackDate(-1));

/**
 * Keduanya didaftarkan TANPA izin pindai penuh, dan itu memang tidak
 * dibutuhkan: `suratsakit` masuk lewat PRIMARY (`range`), `reg_periksa` lewat
 * PRIMARY juga, dan seluruh join identitas `eq_ref`.
 *
 * Bentuk berdiagnosa TIDAK didaftarkan terpisah: ia menambahkan sub-query
 * berkorelasi yang jalan sekali untuk SATU baris (`ambilSuratSakit` selalu
 * `LIMIT 1` lewat PK), bukan mengubah jalur akses tabel dasarnya.
 */
registerPlanCheck({
  name: 'ADMINISTRASI_SURAT_SAKIT',
  sql: buildSuratSakitSql(false, 'rentang'),
  replacements: { awalPrefix: 'SKS20260101000', akhirPrefix: 'SKS20261231999' },
  maxRows: 3000,
});

/**
 * Jendela otomatis, didaftarkan BERIKUT diagnosanya menyala -- dan itu yang
 * membuatnya bukan pemeriksaan kembar yang mubazir.
 *
 * Bentuk berdiagnosa sengaja tidak didaftarkan untuk `ambilSuratSakit` karena di
 * sana sub-query berkorelasinya jalan sekali untuk SATU baris lewat PK. Di sini
 * tidak: ia jalan untuk SETIAP baris di dalam jendela, di dalam proses worker
 * yang berbagi kolam `sik` ber-`pool.max: 2` dengan SIMRS yang sedang melayani
 * pasien. Yang murah pada satu baris belum tentu murah pada lima ratus, dan
 * justru bentuk yang lebih mahal itulah yang perlu dijaga -- bentuk tanpa
 * diagnosa adalah himpunan bagiannya.
 */
registerPlanCheck({
  name: 'ADMINISTRASI_SURAT_SAKIT_OTOMATIS',
  sql: buildSuratSakitSql(true, 'otomatis'),
  replacements: { awalPrefix: 'SKS20260101000', akhirPrefix: 'SKS20261231999' },
  maxRows: 3000,
});

/**
 * `allowFullScan` untuk alias `sks` (= `surat_keterangan_sehat`), dan alasannya
 * SEMENTARA -- layak dibaca sebelum ada yang menirunya.
 *
 * Tabelnya KOSONG di kedua database di mesin ini (0 baris), dan MariaDB
 * memindai tabel kosong alih-alih membuka indeksnya. Sama seperti
 * `permintaan_lab` di `alca`: pindai penuhnya keputusan optimizer yang benar
 * atas tabel yang belum berisi, bukan jalur akses yang salah.
 *
 * DIBUKTIKAN, bukan diasumsikan -- karena tidak ada database di sini yang berisi
 * tabel itu, mekanismenya diuji terhadap SALINAN berstruktur sama yang diisi
 * 3.000 baris:
 *
 *   kosong (alca)  -> type=ALL,  key=NULL
 *   3.000 baris    -> type=ref,  key=no_rawat, rows~1
 *
 * Jadi izin ini akan berhenti terpakai dengan sendirinya begitu rumah sakit
 * mulai memakai formulir surat keterangan sehat Khanza. `maxRows` yang jadi
 * penjaga sebenarnya, bukan izin ini.
 */
registerPlanCheck({
  name: 'ADMINISTRASI_SURAT_SEHAT',
  sql: SEHAT_SQL,
  replacements: { awalPrefix: CONTOH_TGL_AWAL, akhirPrefix: CONTOH_TGL_AKHIR },
  allowFullScan: ['sks'],
  maxRows: 3000,
});
