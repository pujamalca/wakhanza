import { sanitizeValue } from './template';
import { formatJumlah, formatRupiah } from './notaBarang';
import { isianSurat } from './suratDoc';
import type { JamRekap } from './rekapJadwal';

/**
 * REKAP HARIAN RESEP -- fungsi murni, tanpa database dan tanpa WhatsApp.
 *
 * Dipisah ke `core/` dengan alasan yang sama seperti `core/penjualanRekap.ts`:
 * yang paling perlu dibuktikan di sini adalah perilaku di sekitar batas -- hari
 * tanpa satu pun resep, resep yang tidak punya satu baris obat pun, dokter yang
 * cuma muncul di salah satu dari tiga agregatnya -- dan membuktikannya lewat
 * database berarti menunggu keadaan itu benar-benar terjadi.
 *
 * Sekaligus: pratinjau di `/farmasi?tab=resep` memakai fungsi yang SAMA dipakai
 * worker. Pratinjau yang berbeda dari kenyataan lebih buruk daripada tanpa
 * pratinjau -- pelajaran yang sudah dibayar di kotak uji balasan otomatis,
 * balasan stok, dan darurat stok.
 *
 * ==========================================================================
 * PRIVASI -- yang lewat sini, dan yang tidak akan pernah
 * ==========================================================================
 *
 * `resep_obat` adalah tabel yang seluruh proyek ini jaga sejak Fase 0. Yang
 * masuk ke modul ini cuma ANGKA plus nama DOKTER (staf, bukan pasien). Tidak
 * ada satu pun nama obat, jumlah per obat, aturan pakai, nama racikan, nama
 * pasien, nomor rekam medis, maupun poli -- dan itu ditegakkan di hulu, di
 * daftar SELECT `khanza/farmasiStaf.ts`, bukan di sini (ARCHITECTURE §5.2).
 *
 * Yang menjaga BUKAN sifat agregatnya. Sebuah COUNT tidak menyebut siapa pun,
 * tapi itu bukan alasan melonggarkan daftar SELECT-nya: yang menjaga adalah
 * kolom yang tidak pernah diambil. Lihat migrations/042.
 *
 * NILAI RUPIAH (migrations/043) tidak mengubah satu pun kalimat di atas: ia satu
 * angka per dokter, dijumlahkan dari `detail_pemberian_obat.total` di hulu.
 * `reg_periksa` dan `pasien` tetap tidak pernah disebut, dan `no_rawat` yang
 * dipakai menjoinkannya tidak pernah keluar dari SQL.
 */

/** Jam kirim bawaan bila pengaturannya kosong atau tidak terbaca. Lihat migrations/042. */
export const JAM_REKAP_RESEP_BAWAAN: JamRekap = { jam: 22, menit: 0 };

/**
 * Agregat tingkat RESEP dari `resep_obat`, dikelompokkan per dokter.
 *
 * `jml_serah` dihitung dari `tgl_penyerahan <> '0000-00-00'` -- penanda "belum
 * diserahkan" milik Khanza, bukan NULL. Lihat komentar pembuka `farmasiStaf.ts`.
 */
export interface BarisRekapResepHeader {
  kd_dokter: string;
  nm_dokter: string | null;
  jml_resep: number | string;
  jml_serah: number | string | null;
}

/** Agregat tingkat BARIS OBAT dari `resep_dokter`, dikelompokkan per dokter. */
export interface BarisRekapResepItem {
  kd_dokter: string;
  jml_baris: number | string;
  jml_obat: number | string | null;
}

/** Agregat RACIKAN dari `resep_dokter_racikan`, dikelompokkan per dokter. */
export interface BarisRekapResepRacikan {
  kd_dokter: string;
  jml_racikan: number | string;
}

/**
 * Agregat RUPIAH dari `detail_pemberian_obat`, dikelompokkan per dokter.
 *
 * Bukan harga katalog melainkan yang BENAR-BENAR ditagihkan, dibekukan Khanza saat
 * apotek memvalidasi. Alasan lengkap kenapa katalog ditolak ada di
 * `khanza/farmasiStaf.ts`'s `buildRekapResepNilaiSql()`.
 */
export interface BarisRekapResepNilai {
  kd_dokter: string;
  nilai_obat: number | string | null;
}

export interface BarisRekapResepCaraBayar {
  kd_pj: string | null;
  png_jawab: string | null;
  jml_resep: number | string;
  nilai_obat: number | string | null;
}

/** Satu penjamin dan porsinya hari itu. */
export interface BarisCaraBayarResep {
  kode: string;
  /** Sudah dibersihkan dan disanitasi. Kosong bila masternya tidak menyebutkan apa pun. */
  nama: string;
  jmlResep: number;
  nilaiObat: number;
}

export interface BarisDokter {
  kdDokter: string;
  namaDokter: string;
  jmlResep: number;
  jmlSerah: number;
  jmlBelumSerah: number;
  jmlBaris: number;
  jmlObat: number;
  jmlRacikan: number;
  /** Rupiah yang sudah masuk penagihan atas resep dokter ini hari itu. */
  nilaiObat: number;
}

export interface RingkasRekapResep {
  jmlResep: number;
  jmlSerah: number;
  jmlBelumSerah: number;
  jmlBaris: number;
  jmlObat: number;
  jmlRacikan: number;
  nilaiObat: number;
  perDokter: BarisDokter[];
  /**
   * Pecahan per CARA BAYAR (migrations/049) -- BPJS berupa piutang, umum berupa
   * kas, dan `nilaiObat` di atas mencampur keduanya jadi satu angka.
   */
  perCaraBayar: BarisCaraBayarResep[];
  /** Hari itu tidak ada satu resep pun. Menentukan template mana yang dipakai. */
  kosong: boolean;
}

/**
 * mysql2 menyerahkan `COUNT()`/`SUM()` kadang sebagai number dan kadang sebagai
 * string, jadi keduanya diterima.
 *
 * Yang bukan angka jadi 0, dan di SINI itu benar -- berbeda dari `keAngka()` di
 * `core/notaBarang.ts`, yang sengaja mengembalikan null supaya harga yang tidak
 * tercatat tidak dicetak "Rp0" alias "gratis". Bedanya: di sana nilainya FAKTA
 * TENTANG SATU BARANG yang bisa saja belum diisi; di sini ia hasil
 * `COALESCE(SUM(...), 0)` atas sekumpulan baris, dan penjumlahan yang tidak
 * menghasilkan apa-apa memang bernilai nol. Resep tanpa satu baris obat pun
 * -- terukur 135 dari 12.422 -- benar-benar menyumbang nol baris obat hari itu.
 */
function angka(nilai: unknown): number {
  if (nilai === null || nilai === undefined || nilai === '') return 0;
  const n = typeof nilai === 'number' ? nilai : Number(nilai);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gabungkan ketiga agregat jadi satu ringkasan.
 *
 * TIGA query dan bukan satu, dengan alasan yang sama persis dengan `gabungRekap()`
 * milik penjualan: `resep_obat`, `resep_dokter`, dan `resep_dokter_racikan` adalah
 * tiga tingkat yang berbeda, dan satu query yang menjoinkan semuanya akan
 * menggandakan jumlah resep sebanyak baris obat di dalamnya lalu menjumlahkan
 * hasil gandaan itu. Sebuah resep berisi 5 obat akan terhitung LIMA RESEP.
 * Kesalahan yang tidak menghasilkan galat apa pun, cuma angka yang keliru -- dan
 * di sini keliru dengan cara yang paling gampang dipercaya, karena hasilnya tetap
 * masuk akal.
 *
 * Dokter yang muncul hanya di salah satu sisi tetap dipertahankan, dan itu BUKAN
 * kehati-hatian kosong: terukur 135 resep tidak punya satu baris `resep_dokter`
 * pun (69 di antaranya tidak punya racikan juga, 66 sisanya racikan saja).
 * Membuang sisi yang kosong berarti resep racikan-saja lenyap dari hitungan, dan
 * `{jumlah_resep}` berhenti cocok dengan jumlah resep yang sungguhan.
 *
 * Arah sebaliknya -- dokter yang muncul di `item`/`racikan` tapi tidak di
 * `header` -- secara struktur tidak bisa terjadi, karena kedua agregat itu
 * mengambil `kd_dokter`-nya DARI `resep_obat` lewat join pada rentang yang sama.
 * Tetap ditoleransi alih-alih dibuang diam-diam: klaim "tidak mungkin" tentang
 * database milik orang lain adalah klaim yang menua dengan buruk, dan baris yang
 * dibuang tanpa suara adalah persis bentuk kegagalan yang paling mahal di sini.
 */
export function gabungRekapResep(
  header: BarisRekapResepHeader[],
  item: BarisRekapResepItem[],
  racikan: BarisRekapResepRacikan[],
  nilai: BarisRekapResepNilai[],
  caraBayar: BarisRekapResepCaraBayar[] = [],
): RingkasRekapResep {
  const per = new Map<string, BarisDokter>();

  const ambil = (kdDokter: string): BarisDokter => {
    const ada = per.get(kdDokter);
    if (ada) return ada;
    const baru: BarisDokter = {
      kdDokter,
      namaDokter: '',
      jmlResep: 0,
      jmlSerah: 0,
      jmlBelumSerah: 0,
      jmlBaris: 0,
      jmlObat: 0,
      jmlRacikan: 0,
      nilaiObat: 0,
    };
    per.set(kdDokter, baru);
    return baru;
  };

  for (const h of header) {
    const b = ambil(h.kd_dokter ?? '');
    // Nama diambil dari sisi HEADER saja -- satu-satunya yang men-JOIN `dokter`.
    // Diisi hanya bila belum ada, supaya nama tidak berkedip antar baris kalau
    // suatu saat query-nya mengembalikan lebih dari satu baris per dokter.
    if (!b.namaDokter && h.nm_dokter) b.namaDokter = h.nm_dokter;
    b.jmlResep += angka(h.jml_resep);
    b.jmlSerah += angka(h.jml_serah);
  }
  for (const i of item) {
    const b = ambil(i.kd_dokter ?? '');
    b.jmlBaris += angka(i.jml_baris);
    b.jmlObat += angka(i.jml_obat);
  }
  for (const r of racikan) {
    const b = ambil(r.kd_dokter ?? '');
    b.jmlRacikan += angka(r.jml_racikan);
  }
  for (const n of nilai) {
    const b = ambil(n.kd_dokter ?? '');
    b.nilaiObat += angka(n.nilai_obat);
  }

  /**
   * "Belum diserahkan" DITURUNKAN, tidak pernah di-query sendiri.
   *
   * Query terpisah untuk `tgl_penyerahan = '0000-00-00'` akan benar hari ini dan
   * berhenti benar pada hari pertama Khanza menyimpan penanda yang berbeda --
   * dan yang muncul bukan galat melainkan dua angka yang tidak berjumlah. Dengan
   * diturunkan, `diserahkan + belum = resep` dijamin secara aritmetika, dan
   * pembaca pesan bisa menjumlahkannya sendiri. Itulah yang membuat angkanya
   * bisa dipercaya tanpa membuka Khanza.
   *
   * Dijepit di nol: `jml_serah` yang entah bagaimana melebihi `jml_resep` akan
   * menghasilkan angka negatif, dan "-3 belum diserahkan" jauh lebih merusak
   * kepercayaan daripada nol yang sedikit meleset.
   */
  for (const b of per.values()) b.jmlBelumSerah = Math.max(0, b.jmlResep - b.jmlSerah);

  /**
   * Diurutkan di SINI, bukan lewat `ORDER BY` di SQL.
   *
   * Yang menentukan urutan adalah angka HASIL PENGGABUNGAN tiga query, jadi tidak
   * satu pun dari ketiganya bisa mengurutkannya sendiri dengan benar. Nomor dua
   * (nama, menaik) supaya dua dokter berjumlah sama tidak bertukar tempat antar
   * hari -- rekap yang barisnya berpindah-pindah tanpa sebab membuat pembacanya
   * mengira ada yang berubah.
   */
  const perDokter = [...per.values()].sort(
    (a, b) => b.jmlResep - a.jmlResep || a.namaDokter.localeCompare(b.namaDokter),
  );

  const jumlah = (pilih: (b: BarisDokter) => number): number =>
    perDokter.reduce((t, b) => t + pilih(b), 0);

  const jmlResep = jumlah((b) => b.jmlResep);
  const jmlSerah = jumlah((b) => b.jmlSerah);

  return {
    jmlResep,
    jmlSerah,
    jmlBelumSerah: Math.max(0, jmlResep - jmlSerah),
    jmlBaris: jumlah((b) => b.jmlBaris),
    jmlObat: jumlah((b) => b.jmlObat),
    jmlRacikan: jumlah((b) => b.jmlRacikan),
    /**
     * DIJUMLAHKAN dari baris per dokter, bukan di-query terpisah sebagai total.
     *
     * Alasan yang sama yang membuat `jmlBelumSerah` diturunkan: pembaca pesan
     * melihat `{nilai_obat}` di atas dan daftar per dokter di bawahnya, lalu
     * menjumlahkan sendiri. Total yang datang dari query terpisah bisa berbeda
     * dari jumlah barisnya -- dan yang muncul bukan galat melainkan rekap yang
     * tidak bisa dipercaya justru karena angkanya terlihat teliti.
     */
    nilaiObat: jumlah((b) => b.nilaiObat),
    perDokter,
    /**
     * Dipetakan APA ADANYA dari barisnya, tidak diturunkan dari `perDokter` --
     * keduanya memecah populasi yang sama menurut sumbu yang berbeda dan tidak
     * saling menyimpulkan.
     *
     * `isianSurat()` lebih dulu, `sanitizeValue()` sesudahnya, dan urutan itu
     * mengikat: `penjab.png_jawab` bisa berisi penanda `'-'` milik Khanza, dan
     * `sanitizeValue('-')` akan meloloskannya apa adanya sehingga barisnya
     * berbunyi "- : 49 resep". Pola yang sama dengan `gabungAdmBulanan()`.
     */
    perCaraBayar: caraBayar.map((b) => ({
      kode: String(b.kd_pj ?? '').trim(),
      nama: sanitizeValue(isianSurat(b.png_jawab)),
      jmlResep: angka(b.jml_resep),
      nilaiObat: angka(b.nilai_obat),
    })),
    /**
     * Ditentukan JUMLAH RESEP, bukan jumlah baris obatnya.
     *
     * Hari yang resepnya ada tapi tidak satu pun punya baris obat (terukur:
     * keadaan itu nyata, 135 resep) tetap hari yang ada resepnya, dan
     * mendiamkannya sebagai "tidak ada resep" menyembunyikan justru keadaan yang
     * paling perlu dilihat orang -- resep masuk tapi isinya tidak tercatat.
     */
    kosong: jmlResep === 0,
  };
}

/**
 * `{rincian_dokter}` -- satu baris per dokter.
 *
 * `sanitizeValue()` dipanggil untuk nama dokter, dan itu keharusan bukan
 * kerapian: variabel ini masuk `MULTILINE_VARIABLES` di `core/template.ts`, yang
 * artinya `renderTemplate()` TIDAK menyanitasinya lagi. Isinya berasal dari kolom
 * `dokter.nm_dokter` milik Khanza -- input bebas petugas -- jadi setiap baris baru
 * pada hasil akhir harus dipasang kode ini. Kalau tidak, satu nama yang memuat
 * baris baru bisa dipakai memalsukan struktur pesan supaya tampak seperti
 * pengumuman resmi RS (ARCHITECTURE §9.2).
 *
 * Dokter tanpa nama diberi kode dokternya, dan baru "(tanpa nama)" bila kodenya
 * pun kosong: baris yang dibuka tanda titik tanpa nama terbaca sebagai pesan
 * rusak, dan angkanya jadi tidak bisa dipertanggungjawabkan ke mana pun. Kode
 * dokter lebih berguna daripada kata "(tanpa nama)" -- dengannya staf masih bisa
 * mencarinya di Khanza.
 *
 * Racikan disebut HANYA bila ada. Menyebut "0 racikan" di setiap baris pada
 * apotek yang meracik beberapa kali setahun cuma menambah panjang untuk
 * informasi nol, dan mengajari pembacanya melewati bagian itu -- sehingga hari
 * dengan lima racikan ikut terlewat. Pelajaran `nilaiSama()` pada nota hibah.
 *
 * RUPIAH justru KEBALIKANNYA: selalu disebut, termasuk saat nol. Aturan "sebut
 * hanya bila ada" benar untuk racikan karena nol di sana adalah keadaan LAZIM
 * yang tidak menuntut tindakan apa pun. Di sini nol berarti tidak satu rupiah pun
 * masuk penagihan atas resep dokter itu -- entah karena apotek belum memvalidasi,
 * entah karena ada yang salah -- dan itu persis keadaan yang paling perlu
 * terlihat. Menyembunyikannya membuatnya tidak bisa dibedakan dari dokter yang
 * memang tidak punya baris di daftar itu.
 *
 * Sekaligus ia yang membuat `{nilai_obat}` di kepala pesan bisa dicocokkan:
 * jumlahkan kolom rupiah di daftar ini, hasilnya harus sama persis. Baris yang
 * kadang menyebut rupiah dan kadang tidak membuat penjumlahan itu mustahil.
 */
export function formatRincianDokter(rows: BarisDokter[]): string {
  return rows
    .map((b) => {
      const nama = sanitizeValue(b.namaDokter) || sanitizeValue(b.kdDokter) || '(tanpa nama)';
      const bagian = [`${formatJumlah(b.jmlResep)} resep`, `${formatJumlah(b.jmlBaris)} baris obat`];
      if (b.jmlRacikan > 0) bagian.push(`${formatJumlah(b.jmlRacikan)} racikan`);
      bagian.push(formatRupiah(b.nilaiObat));
      return `• ${nama} : ${bagian.join(', ')}`;
    })
    .join('\n');
}

/**
 * `{rincian_cara_bayar}` -- pecahan resep hari itu per penjamin (migrations/049).
 *
 * Lahir dari kebutuhan AKUNTANSI, bukan dari perancangan: BPJS berupa PIUTANG,
 * umum berupa KAS. Tanpa pecahan ini `{nilai_obat}` adalah satu angka yang
 * mencampur uang yang sudah masuk dengan uang yang belum -- terukur Juli 2026,
 * dari Rp17.539.001 ternyata Rp2.181.685 (12,4%) milik pasien BPJS.
 *
 * RUPIAH selalu disebut, termasuk saat nol, dengan alasan yang sama persis yang
 * ditulis untuk `formatRincianDokter()`: ia yang membuat `{nilai_obat}` di kepala
 * pesan bisa dicocokkan -- jumlahkan kolom rupiah di daftar ini, hasilnya harus
 * sama persis. Baris yang kadang menyebut rupiah dan kadang tidak membuat
 * penjumlahan itu mustahil. Jumlah RESEP-nya pun berjumlah dengan
 * `{jumlah_resep}`; terukur Juli 2026: 500 + 185 = 685.
 *
 * `sanitizeValue()` sudah dipanggil di `gabungRekapResep()`, bukan di sini --
 * supaya nilainya sudah bersih juga di mana pun `BarisCaraBayarResep` dipakai
 * langsung. Variabel ini masuk `MULTILINE_VARIABLES`, jadi `renderTemplate()`
 * TIDAK menyanitasinya lagi.
 *
 * Penjamin yang namanya tidak terbaca dari master ditampilkan lewat KODENYA,
 * bukan dibuang dan bukan pula sebagai baris tanpa label -- membuangnya membuat
 * jumlah pecahannya lebih kecil daripada `{jumlah_resep}` tanpa satu pun
 * keterangan.
 */
export function formatRincianCaraBayarResep(rows: BarisCaraBayarResep[]): string {
  if (rows.length === 0) return '(tidak ada resep)';
  return rows
    .map((b) => {
      const label = b.nama || `(kode ${sanitizeValue(b.kode) || 'kosong'})`;
      return `• ${label} : ${formatJumlah(b.jmlResep)} resep, ${formatRupiah(b.nilaiObat)}`;
    })
    .join('\n');
}
