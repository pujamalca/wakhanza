import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import type {
  BarisPenjualan,
  BarisDetailPenjualan,
  RingkasPenjualan,
  PenjualanTerpilih,
} from '@/core/penjualan';
import type { BarisRekapHeader, BarisRekapItem } from '@/core/penjualanRekap';

/**
 * PENJUALAN OBAT, ALKES & BHP -- nota penjualan apotek.
 *
 * Sumbernya menu "Transaksi Penjualan Obat, Alkes & BHP Medis" di Khanza
 * (`src/inventory/DlgPenjualan.java`), yang menulis satu baris `penjualan`
 * berikut sekian baris `detailjual`.
 *
 * ==========================================================================
 * TABEL INI PUNYA KOLOM PASIEN, dan itu yang membedakannya dari ketiga
 * pemicu farmasi lain -- baca ini sebelum menambah satu kolom pun
 * ==========================================================================
 *
 * `pengadaan.ts`, `pemesanan.ts`, dan `hibah.ts` semuanya membuka dengan
 * "tidak ada satu pun data pasien di sini, dan tidak bisa ada". Kalimat itu
 * benar di sana karena BENTUK TABELNYA -- tidak ada kolom yang menautkannya
 * dengan seorang pasien, jadi tidak ada disiplin yang perlu dijaga.
 *
 * Di sini kalimat itu TIDAK berlaku. `penjualan` punya `no_rkm_medis` dan
 * `nm_pasien`; `detailjual` punya nama obatnya. Digabung, keduanya persis
 * "obat APA yang diterima SIAPA" -- hal yang komentar pembuka `stokObat.ts`
 * ada untuk melarang, dan alasan `resep_obat` tidak pernah boleh disentuh
 * modul farmasi mana pun.
 *
 * Diukur atas seluruh 16.787 baris di database ini:
 *
 *   no_rkm_medis    7 nilai berbeda; '000' pada 16.779 baris (99,95%)
 *   nm_pasien      10 nilai berbeda; satu penanda tetap pada 16.545 baris
 *
 * Jadi dalam pemakaian sungguhan ini penjualan bebas di loket, bukan
 * penyerahan obat kepada pasien yang teridentifikasi. Tapi DELAPAN baris
 * membawa no. RM sungguhan, dan itu cukup: "hampir selalu kosong" bukan
 * jaminan apa pun terhadap baris berikutnya, dan yang menentukan bukan
 * seberapa sering melainkan apa yang terjadi ketika terisi.
 *
 * Karena itu KEDUA kolom itu -- berikut `nama_bayar` -- tidak pernah muncul di
 * satu pun SELECT di berkas ini. Merender identitas pembeli bukan terlarang
 * melainkan MUSTAHIL (ARCHITECTURE §5.2), pola yang sama dengan `status_prb`
 * pada surat kontrol BPJS dan keenam kolom klinis pada `skdp_bpjs`.
 *
 * `aturan_pakai` di `detailjual` tunduk aturan yang sama dan sekaligus lebih
 * jelas lagi: ia dosis, yaitu keterangan medis. Terukur kosong pada seluruh
 * 29.852 baris di sini, dan tetap tidak diambil.
 *
 * JANGAN menambahkan satu pun dari kolom itu ke query di bawah, dan jangan
 * menggabungkan modul ini dengan `resep_obat`, `detail_pemberian_obat`, atau
 * `reg_periksa`. Penggabungan itulah yang mengubah nota penjualan menjadi data
 * pasien.
 *
 * ==========================================================================
 * `keterangan` DIBACA, dan itu keputusan pemilik sistem -- bukan kelalaian
 * ==========================================================================
 *
 * Kolom ini dulu ada di daftar terlarang di atas, dengan alasan "teks bebas yang
 * diketik kasir". Alasan itu tidak gugur; yang berubah adalah siapa yang
 * menanggungnya -- pemilik sistem memintanya, dan isinya memang keterangan kerja
 * yang berguna bagi gudang ("obat rutin", "obat luar", "suntik").
 *
 * Yang perlu diketahui siapa pun yang menyentuhnya, dan ini DIUKUR atas seluruh
 * 16.859 baris di database ini:
 *
 *   kosong                                    9.603 baris
 *   terisi                                    7.256 baris
 *     - di antaranya penanda '-' milik Khanza 7.172 baris (98,8% dari yang terisi)
 *   nilai berbeda yang benar-benar terisi         38
 *   panjang terpanjang                            40 karakter
 *   mengandung baris baru                          0 baris
 *
 * Jadi dalam pemakaian sungguhan ia kosakata pendek, bukan karangan bebas. Tapi
 * dari 84 baris yang bukan penanda, sebagian BERISI NAMA ORANG dan sebagian lagi
 * catatan klinis -- persis dua hal yang seluruh berkas ini ada untuk menahan.
 * Tidak ada satu pun cara kode membedakannya dari "obat rutin", jadi yang
 * menahan bukan penyaring melainkan tiga pagar:
 *
 *   1. Dibaca HANYA lewat `ambilPenjualanTerpilih` -- yaitu untuk nota yang sudah
 *      lolos dedup dan kuota, paling banyak sekuota per siklus. Jendela pindai
 *      (~460 baris tiap siklus) tidak pernah menyentuhnya.
 *   2. Penanda Khanza dibuang lewat `isianSurat()` di `susunVarsPenjualan`, jadi
 *      98,8% yang terisi tetap dirender kosong.
 *   3. `{keterangan}` BUKAN anggota MULTILINE_VARIABLES, jadi ia lewat
 *      `sanitizeValue()` seperti nilai luar mana pun.
 *
 * Ia sengaja TIDAK ada di template bawaan -- lihat `PENJUALAN_TEMPLATE_VARIABLES`
 * di `core/template.ts` untuk sebabnya.
 *
 * ==========================================================================
 * Kelas PINDAI, sekali lagi karena tabelnya tidak punya stempel waktu
 * ==========================================================================
 *
 * `penjualan` tidak punya kolom jam sama sekali -- hanya `tgl_jual` bertipe
 * DATE, dan tanggal itu DIPILIH staf. Watermark karena itu mustahil benar, dan
 * yang dipakai adalah jendela yang dibaca ulang tiap siklus dengan dedup lewat
 * kunci idempoten. Bentuk yang sama dengan PENGADAAN, PEMESANAN, HIBAH, dan
 * SURAT_SAKIT, lewat sebab yang sama persis.
 */

/**
 * Batas baris jendela pindai.
 *
 * Diukur pada 60 hari terakhir: 16-46 nota per hari (33 pada 11 Agustus 2026).
 * Jendela tujuh hari ke dua arah karena itu berisi ~460 baris pada laju
 * sekarang, jadi batas ini BUKAN angka yang jauh di atas kepala seperti pada
 * pengadaan -- ia bisa benar-benar tersentuh bila apoteknya makin ramai atau
 * lookback-nya dilebarkan. Runner memperingatkan saat jendelanya terbaca penuh,
 * dan peringatan itu berarti ada nota tertua yang belum terjangkau.
 */
const BATAS_JENDELA = 1000;

/**
 * Pemangkas `no_nota` -- PRIMARY KEY, terurut leksikal, dan EKSAK.
 *
 * Bentuknya `PJ` + `YYYYMMDD` + urutan 3 digit.
 * `DlgPenjualan.java:3986` merakitnya lewat `Valid.autoNomer3` dari
 * `MAX(RIGHT(nota_jual,3))` untuk tanggal yang dipilih di kotak Tanggal.
 *
 * ==========================================================================
 * Ketepatannya diukur, dan ini pemangkas paling bersih di proyek ini
 * ==========================================================================
 *
 * Atas seluruh 16.787 baris (Maret 2024 s/d Agustus 2026):
 *
 *   prefiks cocok persis dengan `tgl_jual`   16.787 baris
 *   prefiks LEBIH MAJU daripada `tgl_jual`        0 baris
 *   prefiks LEBIH MUNDUR daripada `tgl_jual`      0 baris
 *
 * Bandingkan pengadaan (9 dari 910 menyimpang, sampai 31 hari) dan pembatalan
 * BPJS, yang simpangannya justru membuat prefiksnya TIDAK BOLEH dipakai sama
 * sekali. Di sini tidak ada margin yang perlu ditambahkan.
 *
 * Jendelanya tetap merentang KE DUA ARAH, dan itu bukan koreksi atas simpangan
 * yang terukur melainkan jaring pengaman terhadap yang belum pernah terjadi:
 * prefiksnya mengikuti kotak tanggal yang DIPILIH staf, jadi nota bertanggal
 * maju mungkin secara struktural walau nol kali muncul selama dua setengah
 * tahun. Nol pengamatan bukan bukti kemustahilan.
 */
function prefixNota(tanggal: string, akhir: boolean): string {
  const angka = tanggal.replace(/-/g, '');
  return `PJ${angka}${akhir ? '999' : '000'}`;
}

/**
 * Header jendela -- SENGAJA tanpa satu pun angka rupiah.
 *
 * Query ini berjalan tiap siklus atas seluruh jendela (~460 baris pada laju
 * sekarang), sementara yang benar-benar dikirim paling banyak sekuota. Angka
 * rupiahnya karena itu dibaca terpisah, hanya untuk nota yang lolos dedup dan
 * kuota -- lihat `ambilRingkasPenjualan`.
 *
 * Seluruh join LEFT, koreksi atas Khanza yang disengaja: layar Khanza memakai
 * INNER, sehingga nota yang petugasnya sudah dihapus dari master hilang sama
 * sekali dari daftar. Untuk layar yang dibuka orang, hilangnya satu baris
 * terlihat; untuk PEMICU, hilangnya berarti satu penjualan tidak pernah
 * diberitahukan tanpa satu pun galat.
 *
 * `nip` menunjuk `petugas.nip`, dan itu diperiksa bukan diasumsikan: atas 943
 * nota sejak Juli 2026, `petugas` menyelesaikan 943 dan `pegawai.nik` juga 943.
 * Keduanya cocok di sini, jadi `petugas` dipilih untuk seragam dengan pengadaan
 * dan hibah. (Bandingkan SURAT PEMESANAN, tempat keduanya BERBEDA -- 40/40 vs
 * 21/40 -- dan `pegawai` yang benar.)
 */
function buildHeaderSql(): string {
  return `
    SELECT
      p.nota_jual, p.tgl_jual, p.jns_jual, p.status,
      COALESCE(pt.nama, '')      AS nama_petugas,
      COALESCE(b.nm_bangsal, '') AS nm_bangsal
    FROM penjualan p
    LEFT JOIN petugas pt ON pt.nip = p.nip
    LEFT JOIN bangsal b  ON b.kd_bangsal = p.kd_bangsal
    WHERE p.nota_jual >= :awalPrefix AND p.nota_jual <= :akhirPrefix
    ORDER BY p.nota_jual ASC
    LIMIT ${BATAS_JENDELA}
  `;
}

export async function pollPenjualanJendela(dariTanggal: string, sampaiTanggal: string): Promise<BarisPenjualan[]> {
  return sikSelect<BarisPenjualan>(buildHeaderSql(), {
    awalPrefix: prefixNota(dariTanggal, false),
    akhirPrefix: prefixNota(sampaiTanggal, true),
  });
}

/**
 * Nomor nota yang MASIH ADA di dalam jendela -- dipakai deteksi penghapusan.
 *
 * Sengaja query TERSENDIRI yang cuma mengambil satu kolom, bukan memakai ulang
 * hasil `pollPenjualanJendela`. Keduanya memang menjawab pertanyaan yang sama
 * hari ini, tapi yang satu boleh dipersempit kapan saja (mis. menyaring
 * `jns_jual` tertentu) sementara yang ini TIDAK BOLEH: sebuah nota yang
 * tersaring keluar dari pembacaan akan terbaca sebagai nota yang DIHAPUS, dan
 * grup menerima pembatalan atas penjualan yang sebenarnya masih hidup.
 *
 * Memisahkannya membuat perbedaan itu terlihat sebagai dua fungsi berbeda alih-
 * alih tersembunyi sebagai satu pemakaian ulang yang kebetulan cocok.
 */
function buildAdaSql(): string {
  return `
    SELECT p.nota_jual
    FROM penjualan p
    WHERE p.nota_jual >= :awalPrefix AND p.nota_jual <= :akhirPrefix
  `;
}

export async function notaPenjualanYangAda(dariTanggal: string, sampaiTanggal: string): Promise<string[]> {
  const rows = await sikSelect<{ nota_jual: string }>(buildAdaSql(), {
    awalPrefix: prefixNota(dariTanggal, false),
    akhirPrefix: prefixNota(sampaiTanggal, true),
  });
  return rows.map((r) => r.nota_jual);
}

/**
 * Jumlah item dan subtotal per nota.
 *
 * TERPISAH dari daftar barangnya, dan selalu dijalankan -- termasuk saat
 * `farmasi.penjualan_harga` mati. Sebabnya sudah dibayar di 031: label angka
 * penutup ditulis di template sebagai baris tersendiri, jadi memutus angkanya
 * menyisakan "Total : " yang menggantung, dan pesan seperti itu terbaca sebagai
 * sistem rusak.
 *
 * `penjualan` sendiri TIDAK menyimpan totalnya -- hanya `ppn` dan `ongkir` --
 * jadi subtotal memang harus dijumlahkan dari `detailjual`. Yang dijumlahkan
 * `d.total`, dan itu kolom yang benar: terukur `total = subtotal - bsr_dis +
 * tambahan + embalase + tuslah` pada SELURUH 29.852 baris, jadi ia sudah
 * memperhitungkan potongan dan embalase sementara `subtotal` belum.
 */
function buildRingkasSql(): string {
  return `
    SELECT d.nota_jual,
           COUNT(*)                    AS jml_item,
           COALESCE(SUM(d.total), 0)   AS subtotal
    FROM detailjual d
    WHERE d.nota_jual IN (:notas)
    GROUP BY d.nota_jual
  `;
}

export async function ambilRingkasPenjualan(nota: string[]): Promise<RingkasPenjualan[]> {
  if (nota.length === 0) return [];
  return sikSelect<RingkasPenjualan>(buildRingkasSql(), { notas: nota });
}

/**
 * Kolom header yang hanya dipakai oleh nota yang BENAR-BENAR DIKIRIM.
 *
 * Dibaca terpisah dari `pollPenjualanJendela` supaya jendela penuh (~460 baris
 * tiap siklus) tidak menyeret kolom yang cuma dipakai oleh sekuota nota.
 * Terukur: `ppn` tidak pernah terisi pada satu baris pun (0 dari 16.787),
 * `ongkir` terisi pada 3.945 -- jadi yang kedua benar-benar dipakai dan tidak
 * boleh dihilangkan.
 *
 * Namanya BUKAN lagi "angka", dan itu bukan kerapian: sejak `keterangan` ikut,
 * nama yang menyebut angka akan berbohong tentang isinya, dan nama yang
 * berbohong adalah yang membuat kolom teks bebas menyelinap ke tempat yang
 * pembacanya kira cuma berisi rupiah.
 *
 * Di sinilah `keterangan` dibaca, dan HANYA di sini -- pagar pertama dari tiga
 * yang dijelaskan di kepala berkas ini. Menaikkannya ke `buildHeaderSql` akan
 * membuat teks bebas yang bisa memuat nama orang menyeberang untuk ratusan nota
 * tiap siklus, padahal yang dipakai paling banyak sekuota.
 */
function buildTerpilihSql(): string {
  return `
    SELECT p.nota_jual, p.ppn, p.ongkir, COALESCE(p.keterangan, '') AS keterangan
    FROM penjualan p
    WHERE p.nota_jual IN (:notas)
  `;
}

export async function ambilPenjualanTerpilih(nota: string[]): Promise<PenjualanTerpilih[]> {
  if (nota.length === 0) return [];
  return sikSelect<PenjualanTerpilih>(buildTerpilihSql(), { notas: nota });
}

/**
 * Daftar barang per nota.
 *
 * `sertakanHarga` menentukan kolom harga di-SELECT atau TIDAK SAMA SEKALI --
 * bentuk yang sama dengan `farmasi.pengadaan_harga` dan `sertakan_diagnosa`:
 * pengaturannya dibaca PEMANGGIL lalu diserahkan sebagai parameter, karena modul
 * `khanza/` tidak boleh menyentuh pengaturan (batas itu yang membuat
 * `npm run verify:db` bisa membuktikan `sik` hanya dibaca).
 *
 * `no_batch` dan `aturan_pakai` sengaja tidak diambil. Yang pertama kosong pada
 * seluruh 29.852 baris di sini; yang kedua adalah DOSIS, yaitu keterangan medis,
 * dan tunduk pada aturan privasi di kepala berkas ini -- ia tetap tidak diambil
 * seandainya suatu saat terisi.
 */
function buildDetailSql(sertakanHarga: boolean): string {
  return `
    SELECT
      d.nota_jual, d.kode_brng,
      COALESCE(br.nama_brng, '') AS nama_brng,
      COALESCE(sat.satuan, '')   AS satuan,
      d.jumlah${sertakanHarga ? ',\n      d.h_jual, d.total' : ''}
    FROM detailjual d
    LEFT JOIN databarang br  ON br.kode_brng = d.kode_brng
    LEFT JOIN kodesatuan sat ON sat.kode_sat = d.kode_sat
    WHERE d.nota_jual IN (:notas)
    ORDER BY d.nota_jual ASC, br.nama_brng ASC
  `;
}

export async function ambilDetailPenjualan(
  nota: string[],
  sertakanHarga: boolean,
): Promise<BarisDetailPenjualan[]> {
  if (nota.length === 0) return [];
  return sikSelect<BarisDetailPenjualan>(buildDetailSql(sertakanHarga), { notas: nota });
}

/** Jendela penuh terbaca = tanda ada yang mungkin luput; dipakai runner untuk memperingatkan. */
export const JENDELA_PENJUALAN_PENUH = BATAS_JENDELA;

/**
 * TANPA izin pindai penuh untuk kelimanya, dan itu bukan keberuntungan.
 *
 * Header dan pemeriksaan keberadaan masuk lewat PRIMARY (`nota_jual` adalah PK
 * dan prefiksnya terurut leksikal); ringkas, angka, dan rincian lewat indeks
 * `nota_jual` di `detailjual`. Terukur `range PRIMARY` / `range nota_jual` /
 * `eq_ref` pada seluruhnya.
 *
 * Izinnya sengaja TIDAK ditulis walau "aman kalau ada": izin pindai penuh yang
 * menganggur adalah izin yang diam-diam menutupi kemunduran berikutnya (lihat
 * catatan di `stokDarurat.ts`).
 */
registerPlanCheck({
  name: 'FARMASI_PENJUALAN',
  sql: buildHeaderSql(),
  replacements: { awalPrefix: prefixNota('2026-08-05', false), akhirPrefix: prefixNota('2026-08-19', true) },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PENJUALAN_ADA',
  sql: buildAdaSql(),
  replacements: { awalPrefix: prefixNota('2026-08-05', false), akhirPrefix: prefixNota('2026-08-19', true) },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PENJUALAN_RINGKAS',
  sql: buildRingkasSql(),
  replacements: { notas: ['PJ20260811020'] },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PENJUALAN_TERPILIH',
  sql: buildTerpilihSql(),
  replacements: { notas: ['PJ20260811020'] },
  maxRows: 5000,
});

/**
 * Varian berharga didaftarkan TERPISAH dari yang tanpa harga -- bentuk SQL yang
 * berbeda adalah bentuk yang belum terperiksa. Perbedaannya di sini cuma dua
 * kolom tambahan di SELECT yang memang tidak mengubah rencana; justru karena itu
 * pemeriksaannya murah, dan asumsi "tidak mengubah rencana" adalah hal yang
 * harus GAGAL berisik kalau suatu saat keliru.
 */
registerPlanCheck({
  name: 'FARMASI_PENJUALAN_DETAIL',
  sql: buildDetailSql(false),
  replacements: { notas: ['PJ20260811020'] },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PENJUALAN_DETAIL_HARGA',
  sql: buildDetailSql(true),
  replacements: { notas: ['PJ20260811020'] },
  maxRows: 5000,
});

/* ==========================================================================
 * REKAP HARIAN (migrations/041)
 *
 * Ditaruh di berkas INI, bukan di `khanza/penjualanRekap.ts` tersendiri, dan itu
 * keputusan yang disengaja: yang paling penting untuk dijaga di seluruh keluarga
 * penjualan adalah pagar privasi di kepala berkas ini, dan pagar itu berbunyi
 * "JANGAN menambahkan satu pun dari kolom itu ke query di bawah". Berkas kedua
 * berarti tempat kedua yang bisa menambahkan `nm_pasien` tanpa pernah membaca
 * kalimatnya. Menyatukannya membuat pagar itu berlaku secara FISIK, bukan lewat
 * ingatan penulis berikutnya.
 *
 * Kelas pemicunya berbeda (WAKTU, bukan pindai) dan itu memang alasan yang wajar
 * untuk memisah berkas -- tapi kelas pemicu tinggal di runner, sementara yang
 * tinggal di sini cuma bentuk SQL-nya, dan bentuk SQL-nya menyentuh tabel yang
 * sama persis dengan pagar yang sama persis.
 *
 * DUA query, bukan satu, dan penggabungannya sengaja di `core/penjualanRekap.ts`.
 * Satu query yang menjoinkan `penjualan` dengan `detailjual` lalu menjumlahkan
 * SEMUANYA akan menggandakan `ppn` dan `ongkir` sebanyak barang di dalam tiap
 * nota -- sebuah nota berisi 5 barang menyumbang penyesuaiannya LIMA KALI, tanpa
 * satu pun galat. Lihat `gabungRekap()`.
 * ========================================================================== */

/**
 * Agregat tingkat NOTA untuk satu hari, dikelompokkan per jenis penjualan.
 *
 * Hanya COUNT dan SUM; tidak satu pun baris per-transaksi meninggalkan SQL, dan
 * tidak satu pun kolom pasien disebut. Sifat agregatnya BUKAN yang menjaga --
 * yang menjaga tetap daftar SELECT yang tidak pernah memuatnya (§5.2).
 *
 * `GROUP BY p.jns_jual` dan bukan `ORDER BY` apa pun: urutan barisnya ditentukan
 * hasil penggabungan dua query ini, jadi tidak satu pun dari keduanya bisa
 * mengurutkannya dengan benar sendirian.
 */
function buildRekapHeaderSql(): string {
  return `
    SELECT
      COALESCE(p.jns_jual, '')        AS jns_jual,
      COUNT(*)                        AS jml_nota,
      COALESCE(SUM(p.ppn), 0)         AS ppn,
      COALESCE(SUM(p.ongkir), 0)      AS penyesuaian
    FROM penjualan p
    WHERE p.nota_jual >= :awalPrefix AND p.nota_jual <= :akhirPrefix
    GROUP BY p.jns_jual
  `;
}

/**
 * Agregat tingkat BARANG untuk satu hari, dikelompokkan per jenis penjualan.
 *
 * `jns_jual` hanya ada di `penjualan`, jadi join-nya memang perlu -- dan MariaDB
 * membalik arahnya sendiri: terukur `p` sebagai penggerak (`range PRIMARY`) lalu
 * `d` lewat `ref nota_jual`. Penyaringnya sengaja tetap ditulis pada `d.nota_jual`
 * seperti saat diukur; keduanya disamakan oleh join, dan bentuk yang berbeda dari
 * yang diperiksa adalah bentuk yang belum diperiksa.
 *
 * `SUM(d.total)` dan bukan `SUM(d.subtotal)` -- kolom yang benar, dan itu diukur:
 * `total = subtotal - bsr_dis + tambahan + embalase + tuslah` pada SELURUH 29.852
 * baris, jadi hanya `total` yang sudah memperhitungkan potongan dan embalase.
 */
function buildRekapItemSql(): string {
  return `
    SELECT
      COALESCE(p.jns_jual, '')        AS jns_jual,
      COUNT(*)                        AS jml_baris,
      COALESCE(SUM(d.jumlah), 0)      AS jml_barang,
      COALESCE(SUM(d.total), 0)       AS subtotal
    FROM detailjual d
    JOIN penjualan p ON p.nota_jual = d.nota_jual
    WHERE d.nota_jual >= :awalPrefix AND d.nota_jual <= :akhirPrefix
    GROUP BY p.jns_jual
  `;
}

/**
 * Agregat satu hari penuh.
 *
 * Batas harinya prefiks `no_nota` yang sama dipakai jendela pindai, dan sekali
 * lagi ia EKSAK: 16.787 dari 16.787 baris berprefiks sesuai `tgl_jual`, nol
 * menyimpang ke kedua arah. Jadi "penjualan tanggal X" di sini benar-benar
 * berarti penjualan tanggal X -- bukan perkiraan yang dilebarkan margin.
 *
 * Keduanya mengembalikan `[]` untuk hari tanpa satu nota pun (dibuktikan atas
 * 2026-08-09 di database ini), jadi "tidak ada penjualan" adalah keadaan yang
 * tidak ambigu -- bukan baris berisi nol yang bisa tertukar dengan hari yang
 * gagal dibaca.
 */
export async function rekapPenjualanHarian(
  tanggal: string,
): Promise<{ header: BarisRekapHeader[]; item: BarisRekapItem[] }> {
  const rep = { awalPrefix: prefixNota(tanggal, false), akhirPrefix: prefixNota(tanggal, true) };
  const [header, item] = await Promise.all([
    sikSelect<BarisRekapHeader>(buildRekapHeaderSql(), rep),
    sikSelect<BarisRekapItem>(buildRekapItemSql(), rep),
  ]);
  return { header, item };
}

/**
 * TANPA izin pindai penuh, dan itu tidak akan berubah saat tabelnya membesar:
 * `nota_jual` adalah PRIMARY KEY `penjualan` dan indeks pada `detailjual`, jadi
 * rentang satu hari selalu jatuh sebagai `range`. Terukur `range PRIMARY` (33
 * baris) dan `range PRIMARY` + `ref nota_jual`.
 *
 * `Using temporary; Using filesort` pada keduanya berasal dari `GROUP BY` atas
 * hasil rentang yang sudah kecil (puluhan baris), bukan dari pemindaian tabel.
 */
registerPlanCheck({
  name: 'FARMASI_PENJUALAN_REKAP_HEADER',
  sql: buildRekapHeaderSql(),
  replacements: { awalPrefix: prefixNota('2026-08-11', false), akhirPrefix: prefixNota('2026-08-11', true) },
  maxRows: 5000,
});

registerPlanCheck({
  name: 'FARMASI_PENJUALAN_REKAP_ITEM',
  sql: buildRekapItemSql(),
  replacements: { awalPrefix: prefixNota('2026-08-11', false), akhirPrefix: prefixNota('2026-08-11', true) },
  maxRows: 5000,
});
