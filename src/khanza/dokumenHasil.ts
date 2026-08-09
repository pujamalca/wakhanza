import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';

/**
 * ISI hasil lab, hasil radiologi, dan nota tagihan -- untuk dikirim ke pasien
 * sebagai berkas PDF (migrations/038).
 *
 * ==========================================================================
 * Modul ini MEMBACA persis kolom yang seluruh proyek ini menolak membacanya
 * ==========================================================================
 *
 * §5.2 berbunyi: nama pemeriksaan lab, hasil, nama obat, dan diagnosis tidak
 * pernah di-SELECT dari `sik`, sehingga merendernya bukan terlarang melainkan
 * MUSTAHIL. `khanza/penunjang.ts` mengambil `kd_jenis_prw` sebagai KODE dan
 * tidak pernah namanya; `khanza/farmasi.ts` tidak pernah menyentuh nama obat.
 *
 * Berkas ini adalah pengecualiannya, dan pengecualian itu berdiri di atas SATU
 * hal: **penerimanya pasien itu sendiri.** Alasan yang sama membolehkan
 * `administrasi.sertakan_diagnosa` (026). Aturan §5.2 lahir dari pesan yang
 * bisa terbaca orang lain -- pratinjau notifikasi di layar kunci, ponsel yang
 * dipegang bergantian, dan sejak `template_target` (018) juga grup WhatsApp.
 *
 * DUA batas yang menegakkannya, dan keduanya di luar berkas ini karena memang
 * bukan urusan modul `khanza/`:
 *
 *   1. Ketiga sakelarnya default MATI. Selama mati, tidak satu pun fungsi di
 *      sini pernah dipanggil -- kolomnya tidak sekadar tidak dirender, ia tidak
 *      pernah meninggalkan MariaDB.
 *   2. Lampiran TIDAK PERNAH ikut ke salinan grup. Ditegakkan
 *      `enqueuePemicuPasien()`, bukan pengaturan, karena satu centang di
 *      /template tidak boleh bisa mengubah hasil lab seorang pasien menjadi
 *      berkas yang diterima setiap anggota sebuah grup.
 *
 * ==========================================================================
 * Yang TETAP tidak diambil
 * ==========================================================================
 *
 * `diagnosa_pasien`/`penyakit` tidak disentuh sama sekali di sini -- diagnosis
 * bukan bagian dari ketiga dokumen ini pada Khanza sendiri, dan menambahkannya
 * berarti mengulang keputusan yang sudah punya sakelarnya sendiri di jalur
 * surat. `pasien.no_ktp` juga tidak, walau `rptPeriksaLab` mencetaknya: nomor
 * identitas nasional di dalam berkas yang diteruskan tanpa batas lewat WhatsApp
 * adalah bahan pencurian identitas, dan ia tidak menambah apa pun bagi pasien
 * yang sedang membaca hasil pemeriksaannya sendiri.
 */

// ---------------------------------------------------------------------------
// Identitas kunjungan -- satu penurunan, dipakai KETIGA dokumen
// ---------------------------------------------------------------------------

export interface BarisIdentitasDokumen {
  no_rawat: string;
  tgl_registrasi: string | null;
  jam_reg: string | null;
  umurdaftar: number | null;
  sttsumur: string | null;
  no_rkm_medis: string;
  /** Kode saja, untuk checkPrivacy() -- nama polinya dipakai di kepala dokumen. */
  kd_poli: string | null;
  nm_poli: string | null;
  nm_pasien: string | null;
  jk: string | null;
  tgl_lahir: string | null;
  no_tlp: string | null;
  alamat: string | null;
  nm_kel: string | null;
  nm_kec: string | null;
  nm_kab: string | null;
  png_jawab: string | null;
  nm_dokter: string | null;
  kd_dokter: string | null;
}

/**
 * Wilayah lewat LEFT JOIN, KOREKSI atas Khanza yang disengaja -- sama seperti
 * `khanza/suratPasien.ts`. Query cetak Khanza memakai INNER JOIN, sehingga
 * pasien yang salah satu kolom wilayahnya belum diisi tidak bisa dicetak sama
 * sekali. Di sini yang hilang cuma barisnya, bukan dokumennya.
 *
 * Penandanya sendiri (`kelurahan.nm_kel = 'KELURAHAN'` pada 89% pasien)
 * dibersihkan `isianSurat()` di sisi murni, bukan di SQL.
 */
const SQL_IDENTITAS = `
  SELECT r.no_rawat, r.tgl_registrasi, r.jam_reg, r.umurdaftar, r.sttsumur,
         r.no_rkm_medis, r.kd_poli,
         pk.nm_poli,
         p.nm_pasien, p.jk, p.tgl_lahir, p.no_tlp, p.alamat,
         kel.nm_kel, kec.nm_kec, kab.nm_kab,
         pj.png_jawab,
         d.nm_dokter, d.kd_dokter
  FROM reg_periksa r
  LEFT JOIN poliklinik pk ON pk.kd_poli = r.kd_poli
  LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis
  LEFT JOIN kelurahan kel ON kel.kd_kel = p.kd_kel
  LEFT JOIN kecamatan kec ON kec.kd_kec = p.kd_kec
  LEFT JOIN kabupaten kab ON kab.kd_kab = p.kd_kab
  LEFT JOIN penjab pj ON pj.kd_pj = r.kd_pj
  LEFT JOIN dokter d ON d.kd_dokter = r.kd_dokter
  WHERE r.no_rawat = :noRawat
  LIMIT 1
`;

export async function ambilIdentitasKunjungan(noRawat: string): Promise<BarisIdentitasDokumen | null> {
  const rows = await sikSelect<BarisIdentitasDokumen>(SQL_IDENTITAS, { noRawat });
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// HASIL LABORATORIUM
// ---------------------------------------------------------------------------

export interface BarisHasilLab {
  /** Nama panel/paket pemeriksaan, mis. "Glukosa Puasa" -- dari jns_perawatan_lab. */
  panel: string | null;
  /** Nama parameter di dalam panel, mis. "Gula Darah Puasa". */
  pemeriksaan: string | null;
  nilai: string | null;
  satuan: string | null;
  nilai_rujukan: string | null;
  keterangan: string | null;
  nm_petugas: string | null;
  nm_dokter_pj: string | null;
  kd_dokter_pj: string | null;
}

/**
 * Nilai rujukan diambil dari `detail_periksa_lab`, BUKAN dihitung ulang dari
 * `template_laboratorium`.
 *
 * Katalognya menyimpan EMPAT rentang untuk tiap parameter -- `nilai_rujukan_ld`
 * / `_la` / `_pd` / `_pa`, yaitu laki-laki dewasa, laki-laki anak, perempuan
 * dewasa, perempuan anak -- dan Khanza memilih salah satunya menurut jenis
 * kelamin serta umur pasien SAAT pemeriksaan dilakukan, lalu menyalin hasil
 * pilihannya ke baris detailnya.
 *
 * Memilih ulang di sini berarti menurunkan sendiri aturan dewasa-vs-anak yang
 * tidak tertulis di mana pun, terhadap umur pasien HARI INI alih-alih umurnya
 * saat diperiksa. Yang muncul bukan galat melainkan rentang rujukan yang
 * berbeda antara lembar yang dicetak di loket dan berkas yang diterima lewat
 * WhatsApp -- dua jawaban berbeda dari satu sistem, kegagalan yang bentuknya
 * sama persis dengan `khanza/stokGudang.ts`. Yang tersimpan sudah benar; yang
 * perlu dilakukan cuma membacanya.
 *
 * `satuan` memang tetap dari katalog: ia tidak ikut disalin ke baris detail,
 * dan satuan sebuah parameter tidak bergantung pada pasiennya.
 *
 * Diurutkan `tl.urut` -- kolom urutan milik katalog, yang dipakai Khanza sendiri
 * (`order by template_laboratorium.urut`). Tanpa itu parameter darah lengkap
 * keluar dalam urutan id_template, dan pembacanya kehilangan pengelompokan yang
 * membuat sebuah panel bisa dibaca sekilas.
 */
const SQL_HASIL_LAB = `
  SELECT jp.nm_perawatan AS panel,
         tl.Pemeriksaan AS pemeriksaan,
         d.nilai, tl.satuan, d.nilai_rujukan, d.keterangan,
         ptg.nama AS nm_petugas,
         dr.nm_dokter AS nm_dokter_pj, dr.kd_dokter AS kd_dokter_pj
  FROM detail_periksa_lab d
  JOIN periksa_lab pl
    ON pl.no_rawat = d.no_rawat AND pl.kd_jenis_prw = d.kd_jenis_prw
   AND pl.tgl_periksa = d.tgl_periksa AND pl.jam = d.jam
  JOIN template_laboratorium tl ON tl.id_template = d.id_template
  LEFT JOIN jns_perawatan_lab jp ON jp.kd_jenis_prw = d.kd_jenis_prw
  LEFT JOIN petugas ptg ON ptg.nip = pl.nip
  LEFT JOIN dokter dr ON dr.kd_dokter = pl.kd_dokter
  WHERE d.no_rawat = :noRawat AND d.tgl_periksa = :tglPeriksa
  ORDER BY jp.nm_perawatan, tl.urut, tl.Pemeriksaan
  LIMIT 300
`;

export async function ambilHasilLab(noRawat: string, tglPeriksa: string): Promise<BarisHasilLab[]> {
  return sikSelect<BarisHasilLab>(SQL_HASIL_LAB, { noRawat, tglPeriksa });
}

// ---------------------------------------------------------------------------
// HASIL RADIOLOGI
// ---------------------------------------------------------------------------

export interface BarisHasilRadiologi {
  jam: string;
  /** Narasi bacaan dokter radiologi -- kalimat bebas, kolom `text`. */
  hasil: string | null;
}

export interface BarisPemeriksaanRadiologi {
  jam: string;
  nm_perawatan: string | null;
  nm_dokter_pj: string | null;
  kd_dokter_pj: string | null;
}

/**
 * Bacaannya DIPISAH dari daftar pemeriksaannya, dan itu bentuk tabelnya --
 * bukan pilihan.
 *
 * `hasil_radiologi` berkunci (no_rawat, tgl_periksa, jam) dengan satu kolom
 * `hasil` bertipe `text`, sementara `periksa_radiologi` berkunci (no_rawat,
 * kd_jenis_prw, tgl_periksa, jam) -- satu baris per JENIS pemeriksaan. Satu
 * bacaan karena itu bisa mencakup beberapa pemeriksaan sekaligus.
 *
 * Menggabungkannya lewat satu JOIN akan menggandakan narasinya sebanyak jenis
 * pemeriksaannya, dan narasi radiologi bukan satu-dua kata: hasilnya bukan
 * sekadar boros melainkan dokumen yang mengulang bacaan yang sama tiga kali.
 */
const SQL_HASIL_RADIOLOGI = `
  SELECT h.jam, h.hasil
  FROM hasil_radiologi h
  WHERE h.no_rawat = :noRawat AND h.tgl_periksa = :tglPeriksa
  ORDER BY h.jam
  LIMIT 20
`;

const SQL_PEMERIKSAAN_RADIOLOGI = `
  SELECT pr.jam, jp.nm_perawatan,
         dr.nm_dokter AS nm_dokter_pj, dr.kd_dokter AS kd_dokter_pj
  FROM periksa_radiologi pr
  LEFT JOIN jns_perawatan_radiologi jp ON jp.kd_jenis_prw = pr.kd_jenis_prw
  LEFT JOIN dokter dr ON dr.kd_dokter = pr.kd_dokter
  WHERE pr.no_rawat = :noRawat AND pr.tgl_periksa = :tglPeriksa
  ORDER BY pr.jam
  LIMIT 50
`;

export async function ambilHasilRadiologi(
  noRawat: string,
  tglPeriksa: string,
): Promise<{ bacaan: BarisHasilRadiologi[]; pemeriksaan: BarisPemeriksaanRadiologi[] }> {
  const [bacaan, pemeriksaan] = await Promise.all([
    sikSelect<BarisHasilRadiologi>(SQL_HASIL_RADIOLOGI, { noRawat, tglPeriksa }),
    sikSelect<BarisPemeriksaanRadiologi>(SQL_PEMERIKSAAN_RADIOLOGI, { noRawat, tglPeriksa }),
  ]);
  return { bacaan, pemeriksaan };
}

// ---------------------------------------------------------------------------
// NOTA / TAGIHAN
// ---------------------------------------------------------------------------

/**
 * Satu baris nota, dan KETIGA kolom teksnya punya peran berbeda.
 *
 * Diukur atas 12.142 nota di database ini, bukan disimpulkan dari namanya:
 *
 *   `no`             LABEL KIRI. Terisi hanya pada baris judul kelompok
 *                    ("Registrasi", "Tindakan", "Obat & BHP", "Potongan
 *                    Biaya"). Pada baris item SELALU kosong -- 0 dari 80.477
 *                    baris item menyimpang.
 *   `nm_perawatan`   Nama layanan/barang pada baris item; ':' belaka pada baris
 *                    judul; dan pada baris subtotal (`status` berawalan 'Ttl')
 *                    justru berisi ANGKANYA yang sudah diformat Khanza
 *                    ("31,655"), bukan sebuah nama.
 *   `pemisah`        ':' menandai baris ITEM. Inilah satu-satunya penanda yang
 *                    andal untuk membedakan item dari judul.
 *
 * Namanya menyesatkan ke arah yang mahal: membaca `nm_perawatan` sebagai label
 * menghasilkan nota yang seluruh judul kelompoknya berbunyi ":" dan subtotalnya
 * jadi baris bernama "31,655" tanpa angka. Ketahuan dari `npm run
 * dryrun:dokumen` atas nota sungguhan, bukan dari membaca skema.
 */
export interface BarisNota {
  noindex: number;
  /** Label kiri; `no` adalah nama kolomnya di Khanza. */
  no_baris: string | null;
  nm_perawatan: string | null;
  pemisah: string | null;
  biaya: number | null;
  jumlah: number | null;
  tambahan: number | null;
  totalbiaya: number | null;
  status: string | null;
}

/**
 * `billing` adalah nota yang SUDAH terangkai oleh Khanza, baris demi baris.
 *
 * Itu keberuntungan yang menentukan bentuk fitur ini: nota tidak perlu
 * disusun ulang dari belasan tabel transaksi (`rawat_jl_dr`, `detail_pemberian_obat`,
 * `periksa_lab`, ...) dengan risiko menghasilkan angka yang BERBEDA dari yang
 * dibayar pasien di kasir. Yang dibaca di sini adalah baris yang sama persis
 * dengan yang dicetak Khanza, jadi angkanya tidak bisa menyimpang.
 *
 * Tujuh baris pertama tiap nota ber-`status = '-'` dan berisi kepala notanya
 * (No.Nota, Unit/Instansi, Tanggal & Jam, No.RM, Nama Pasien, Alamat Pasien,
 * Dokter) yang sudah dirangkai jadi teks. Keduanya SENGAJA tidak dipakai dan
 * disaring di sisi murni, bukan di SQL -- alamatnya di sana dirangkai Khanza
 * apa adanya sehingga berbunyi "..., KELURAHAN, KECAMATAN, KABUPATEN" untuk 89%
 * pasien, dan kepala dokumen di sini dibangun dari `ambilIdentitasKunjungan()`
 * yang penandanya sudah dibersihkan.
 *
 * Disaring di sisi murni supaya `npm run poll:dryrun` dan pratinjau dashboard
 * tetap bisa memperlihatkan baris mentahnya saat ada yang mempertanyakan sebuah
 * angka -- yang dibuang di SQL tidak bisa diperiksa lagi oleh siapa pun.
 */
const SQL_NOTA = `
  SELECT b.noindex, b.\`no\` AS no_baris, b.nm_perawatan, b.pemisah, b.biaya,
         b.jumlah, b.tambahan, b.totalbiaya, b.status
  FROM billing b
  WHERE b.no_rawat = :noRawat
  ORDER BY b.noindex
  LIMIT 400
`;

export interface BarisPembayaranNota {
  nama_bayar: string;
  besarppn: number | null;
  besar_bayar: number | null;
}

/**
 * Rincian cara pembayaran, dari `detail_nota_jalan` / `detail_nota_inap`.
 *
 * Dua tabel karena Khanza memisahkan rawat jalan dan rawat inap, dan pemicunya
 * (`BILLING_READY`) sudah tahu mana yang berlaku lewat kolom `sumber` hasil
 * UNION ALL di `khanza/billing.ts`. Diserahkan sebagai parameter alih-alih
 * ditebak dari ada-tidaknya baris: nota rawat inap yang belum punya rincian
 * pembayaran akan salah dibaca sebagai nota rawat jalan, dan yang muncul bukan
 * galat melainkan bagian pembayaran yang diam-diam kosong.
 */
function sqlPembayaran(sumber: 'rajal' | 'ranap'): string {
  const tabel = sumber === 'rajal' ? 'detail_nota_jalan' : 'detail_nota_inap';
  return `
    SELECT dn.nama_bayar, dn.besarppn, dn.besar_bayar
    FROM ${tabel} dn
    WHERE dn.no_rawat = :noRawat
    ORDER BY dn.nama_bayar
    LIMIT 20
  `;
}

export async function ambilNota(
  noRawat: string,
  sumber: 'rajal' | 'ranap',
): Promise<{ baris: BarisNota[]; pembayaran: BarisPembayaranNota[] }> {
  const [baris, pembayaran] = await Promise.all([
    sikSelect<BarisNota>(SQL_NOTA, { noRawat }),
    sikSelect<BarisPembayaranNota>(sqlPembayaran(sumber), { noRawat }),
  ]);
  return { baris, pembayaran };
}

// ---------------------------------------------------------------------------
// Contoh terbaru -- untuk PRATINJAU di dashboard
// ---------------------------------------------------------------------------

/**
 * Kejadian TERBARU dari tiap jenis, dipakai tombol pratinjau di /administrasi.
 *
 * Ada karena ketiga sakelarnya default MATI dan yang harus diputuskan rumah
 * sakit adalah "apa persisnya yang akan diterima pasien". Tanpa contoh, satu-
 * satunya cara mengetahuinya adalah menyalakan sakelarnya lalu menunggu
 * kejadian sungguhan -- yaitu mengirimkannya lebih dulu, persis yang ingin
 * dihindari.
 *
 * `LIMIT 1` atas indeks yang sudah ada, dan hanya jalan saat staf membuka
 * tabnya. TIDAK diberi izin pindai penuh: `periksa_lab` dan `hasil_radiologi`
 * masuk lewat prefiks PRIMARY-nya, `nota_jalan` lewat indeks `tanggal` --
 * lihat catatan pada `SQL_CONTOH_NOTA` untuk bentuk ORDER BY yang mengikat.
 */
export interface ContohKejadian {
  no_rawat: string;
  tanggal: string;
  no_nota?: string | null;
}

const SQL_CONTOH_LAB = `
  SELECT pl.no_rawat, pl.tgl_periksa AS tanggal
  FROM periksa_lab pl
  ORDER BY pl.tgl_periksa DESC, pl.jam DESC
  LIMIT 1
`;

const SQL_CONTOH_RADIOLOGI = `
  SELECT h.no_rawat, h.tgl_periksa AS tanggal
  FROM hasil_radiologi h
  ORDER BY h.tgl_periksa DESC, h.jam DESC
  LIMIT 1
`;

/**
 * Diurutkan `tanggal` SAJA, tanpa `jam` -- dan itu bukan kelalaian.
 *
 * `nota_jalan` punya indeks pada `tanggal` tapi tidak pada `(tanggal, jam)`,
 * jadi menambahkan `jam` ke ORDER BY membuat MariaDB memindai seluruh tabel
 * lalu menyortirnya: terukur `type=ALL, rows=10.071` -- untuk mengambil SATU
 * baris contoh. Ketahuan dari `npm run verify:plans`, bukan dari membaca SQL;
 * komentar di berkas ini sempat mengklaim indeksnya terpakai, dan klaim itu
 * keliru.
 *
 * Yang hilang cuma ketepatan urutan di dalam satu hari yang sama, dan itu tidak
 * berarti apa-apa untuk sebuah CONTOH: yang dibutuhkan staf adalah bentuk
 * notanya, bukan nota terbaru sampai ke detiknya.
 */
const SQL_CONTOH_NOTA = `
  SELECT n.no_rawat, n.tanggal, n.no_nota
  FROM nota_jalan n
  ORDER BY n.tanggal DESC
  LIMIT 1
`;

export async function ambilContohKejadian(jenis: 'lab' | 'radiologi' | 'nota'): Promise<ContohKejadian | null> {
  const sql = jenis === 'lab' ? SQL_CONTOH_LAB : jenis === 'radiologi' ? SQL_CONTOH_RADIOLOGI : SQL_CONTOH_NOTA;
  const rows = await sikSelect<ContohKejadian>(sql);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pemeriksaan rencana query
// ---------------------------------------------------------------------------
//
// Nilai contoh sengaja BUKAN nilai yang ada di database -- rencana query tidak
// bergantung pada isinya, dan baris EXPLAIN ber-`table = NULL` ("Impossible
// WHERE...") justru bukti bahwa optimizer menyelesaikannya tanpa membaca apa
// pun (§"Izin pindai penuh diberikan per TABEL").
//
// TANPA izin pindai penuh untuk satu tabel pun, dan itu bukan keberuntungan:
// keempat query di atas masuk lewat kunci yang memang ada -- `reg_periksa` dan
// `billing` lewat `no_rawat`, `detail_periksa_lab` dan `hasil_radiologi` lewat
// prefiks PRIMARY KEY-nya, `detail_nota_*` lewat PRIMARY KEY-nya. Izin pindai
// penuh yang menganggur adalah izin yang diam-diam menutupi kemunduran
// berikutnya.

const CONTOH = { noRawat: '2026/01/01/000001', tglPeriksa: '2026-01-01' };

registerPlanCheck({ name: 'DOKUMEN_IDENTITAS', sql: SQL_IDENTITAS, replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_HASIL_LAB', sql: SQL_HASIL_LAB, replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_HASIL_RADIOLOGI', sql: SQL_HASIL_RADIOLOGI, replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_PERIKSA_RADIOLOGI', sql: SQL_PEMERIKSAAN_RADIOLOGI, replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_NOTA', sql: SQL_NOTA, replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_NOTA_BAYAR_RAJAL', sql: sqlPembayaran('rajal'), replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_NOTA_BAYAR_RANAP', sql: sqlPembayaran('ranap'), replacements: CONTOH });
registerPlanCheck({ name: 'DOKUMEN_CONTOH_LAB', sql: SQL_CONTOH_LAB, replacements: {} });
registerPlanCheck({ name: 'DOKUMEN_CONTOH_RADIOLOGI', sql: SQL_CONTOH_RADIOLOGI, replacements: {} });
registerPlanCheck({ name: 'DOKUMEN_CONTOH_NOTA', sql: SQL_CONTOH_NOTA, replacements: {} });
