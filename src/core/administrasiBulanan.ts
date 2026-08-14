import { formatJumlah } from './notaBarang';
import { labelBulan } from './rekapBulan';
import { isianSurat } from './suratDoc';
import { sanitizeValue } from './template';

/**
 * REKAP BULANAN ADMINISTRASI -- penggabungan dan bentuk angkanya. Fungsi murni,
 * tanpa database dan tanpa WhatsApp.
 *
 * Dipisah ke `core/` dengan alasan yang sama seperti `farmasiBulanan.ts`, dan di
 * sini ada satu tambahan yang menentukan: modul ini merangkai NAMA dari `sik`
 * (nama penjamin) ke dalam variabel berbaris banyak, sementara `farmasiBulanan.ts`
 * secara tegas tidak merangkai satu pun. Kewajiban menyanitasinya karena itu
 * berlaku penuh di sini, dan uji perilakunya yang menegakkannya -- lihat
 * `formatRincianCaraBayar()`.
 *
 * ==========================================================================
 * Kenapa TIDAK menumpang `gabungBulanan()` milik farmasi
 * ==========================================================================
 *
 * Bentuk luarnya mirip -- sekumpulan agregat sebulan jadi satu ringkasan -- dan
 * justru kemiripan itu yang menyesatkan. Yang farmasi gabungkan adalah sepuluh
 * agregat dari SEPULUH tabel yang tidak berhubungan (resep, telaah, pembelian,
 * pemesanan, hibah, penjualan); yang di sini digabung berangkat dari SATU
 * populasi, yaitu kunjungan bulan itu, sehingga hampir setiap angkanya adalah
 * pecahan dari `jmlKunjungan`.
 *
 * Perbedaan itu punya akibat nyata: di sini persentase punya arti dan pembaginya
 * selalu sama, sementara di farmasi "3 hibah" dan "685 resep" tidak punya
 * pembagi bersama sama sekali. Memaksakan keduanya lewat satu fungsi berarti
 * fungsi yang separuh parameternya selalu kosong pada tiap pemanggil -- bentuk
 * yang membuat pemanggil berikutnya salah menebak apa yang wajib diisi.
 */

/** Satu penjamin dan porsinya bulan itu. */
export interface BarisCaraBayar {
  kode: string;
  /** Sudah dibersihkan dan disanitasi. Kosong bila masternya tidak menyebutkan apa pun. */
  nama: string;
  kunjungan: number;
  pasien: number;
}

export interface RingkasAdmBulanan {
  bulan: string;
  /* --- kunjungan & pasien --- */
  jmlKunjungan: number;
  jmlPasien: number;
  jmlBatal: number;
  jmlBaru: number;
  jmlLama: number;
  jmlBerulang: number;
  jmlKunjunganBerulang: number;
  caraBayar: BarisCaraBayar[];
  /* --- kelengkapan berkas --- */
  jmlBaruTanpaAsesmen: number;
  jmlBaruAdaAsesmen: number;
  jmlAdaResep: number;
  jmlTanpaResep: number;
  jmlAdaDiagnosa: number;
  jmlAdaSoapie: number;
  jmlAdaResume: number;
  jmlBelumBayar: number;
  /* --- dokumen --- */
  jmlSuratSakit: number;
  jmlSuratKontrol: number;
  /** Bulan itu tidak ada satu pun kunjungan. Menentukan template mana yang dipakai. */
  kosong: boolean;
}

/**
 * mysql2 menyerahkan `COUNT()`/`SUM()` kadang sebagai number dan kadang sebagai
 * string. Yang bukan angka jadi 0, dan di sini itu benar: semuanya hasil agregat
 * atas sekumpulan baris, dan agregat yang tidak menghasilkan apa-apa memang
 * bernilai nol. Bandingkan `keAngka()` di `notaBarang.ts`, yang justru
 * mengembalikan null supaya harga satu barang yang tidak tercatat tidak dicetak
 * "Rp0" alias "gratis".
 */
function angka(nilai: unknown): number {
  if (nilai === null || nilai === undefined || nilai === '') return 0;
  const n = typeof nilai === 'number' ? nilai : Number(nilai);
  return Number.isFinite(n) ? n : 0;
}

/** Bentuk mentah tiap agregat, sebagaimana datang dari SQL. */
export interface AdmBulananMentah {
  kunjungan?: {
    jml_kunjungan?: number | string | null;
    jml_pasien?: number | string | null;
    jml_batal?: number | string | null;
    jml_baru?: number | string | null;
    jml_belum_bayar?: number | string | null;
    ada_resep?: number | string | null;
    ada_diagnosa?: number | string | null;
    ada_soapie?: number | string | null;
    ada_resume?: number | string | null;
    baru_tanpa_asesmen?: number | string | null;
  } | null;
  caraBayar?: {
    kd_pj?: string | null;
    png_jawab?: string | null;
    jml_kunjungan?: number | string | null;
    jml_pasien?: number | string | null;
  }[];
  berulang?: {
    jml_pasien_berulang?: number | string | null;
    jml_kunjungan_berulang?: number | string | null;
  } | null;
  suratSakit?: { jml?: number | string | null } | null;
  kontrolSkdp?: { jml?: number | string | null } | null;
  kontrolBridging?: { jml?: number | string | null } | null;
}

/**
 * Enam agregat jadi satu ringkasan.
 *
 * TIGA angka DITURUNKAN, tidak pernah di-query sendiri -- aturan yang sama yang
 * membuat `jmlDiserahkan`/`jmlAdaTelaah` diturunkan di `gabungBulanan()` dan
 * `jmlBelumSerah` di `gabungRekapResep()`:
 *
 *   jmlLama           = kunjungan - baru
 *   jmlTanpaResep     = kunjungan - adaResep
 *   jmlBaruAdaAsesmen = baru      - baruTanpaAsesmen
 *
 * Query terpisah untuk masing-masing akan benar hari ini dan berhenti benar pada
 * hari pertama Khanza memakai penanda yang berbeda, dan yang muncul bukan galat
 * melainkan dua angka yang tidak berjumlah. Dengan diturunkan, ketiga pasangannya
 * berjumlah secara ARITMETIKA -- sehingga pembaca bisa menjumlahkannya sendiri di
 * layar tanpa membuka Khanza, dan itulah yang membuat angkanya bisa dipercaya.
 *
 * Ketiganya dijepit di nol: penghitung yang entah bagaimana melebihi pembaginya
 * akan menghasilkan angka negatif, dan "-3 pasien lama" jauh lebih merusak
 * kepercayaan daripada nol yang sedikit meleset.
 */
export function gabungAdmBulanan(bulan: string, m: AdmBulananMentah): RingkasAdmBulanan {
  const k = m.kunjungan;
  const jmlKunjungan = angka(k?.jml_kunjungan);
  const jmlBaru = angka(k?.jml_baru);
  const jmlAdaResep = angka(k?.ada_resep);
  const jmlBaruTanpaAsesmen = angka(k?.baru_tanpa_asesmen);

  return {
    bulan,
    jmlKunjungan,
    jmlPasien: angka(k?.jml_pasien),
    jmlBatal: angka(k?.jml_batal),
    jmlBaru,
    jmlLama: Math.max(0, jmlKunjungan - jmlBaru),
    jmlBerulang: angka(m.berulang?.jml_pasien_berulang),
    jmlKunjunganBerulang: angka(m.berulang?.jml_kunjungan_berulang),
    caraBayar: (m.caraBayar ?? []).map((b) => ({
      kode: String(b.kd_pj ?? '').trim(),
      /**
       * `isianSurat()` lebih dulu, `sanitizeValue()` sesudahnya, dan urutan itu
       * mengikat. `penjab.png_jawab` bisa berisi penanda `'-'` milik Khanza --
       * pola yang sama dengan `pasien.pekerjaan` dan `hibah.nama_pemberi` -- dan
       * `sanitizeValue('-')` akan meloloskannya apa adanya, sehingga baris
       * rekapnya berbunyi "- : 49 kunjungan".
       */
      nama: sanitizeValue(isianSurat(b.png_jawab)),
      kunjungan: angka(b.jml_kunjungan),
      pasien: angka(b.jml_pasien),
    })),
    jmlBaruTanpaAsesmen,
    jmlBaruAdaAsesmen: Math.max(0, jmlBaru - jmlBaruTanpaAsesmen),
    jmlAdaResep,
    jmlTanpaResep: Math.max(0, jmlKunjungan - jmlAdaResep),
    jmlAdaDiagnosa: angka(k?.ada_diagnosa),
    jmlAdaSoapie: angka(k?.ada_soapie),
    jmlAdaResume: angka(k?.ada_resume),
    jmlBelumBayar: angka(k?.jml_belum_bayar),
    jmlSuratSakit: angka(m.suratSakit?.jml),
    /**
     * Kedua sumber surat kontrol DIJUMLAHKAN jadi satu angka -- alasannya di
     * kepala `khanza/administrasiBulanan.ts`. Ringkasnya: memisahkannya
     * menghasilkan dua baris yang keduanya berbunyi 0 setiap bulan, dan baris yang
     * selamanya nol mengajari pembacanya melewati bagian itu.
     */
    jmlSuratKontrol: angka(m.kontrolSkdp?.jml) + angka(m.kontrolBridging?.jml),
    /**
     * KOSONG ditentukan JUMLAH KUNJUNGAN, bukan salah satu pecahannya.
     *
     * Berbeda dari `gabungBulanan()` farmasi, yang harus memeriksa lima jalur
     * sekaligus karena kelimanya berdiri sendiri: bulan tanpa resep tapi dengan
     * 700 nota penjualan jelas ada isinya. Di sini seluruh angka adalah pecahan
     * dari kunjungan, jadi nol kunjungan berarti nol segalanya -- dan itu berarti
     * rumah sakit benar-benar tidak menerima seorang pasien pun sebulan penuh.
     */
    kosong: jmlKunjungan === 0,
  };
}

/**
 * Persentase terhadap sebuah pembagi, dalam kurung, atau string KOSONG bila
 * pembaginya nol.
 *
 * Nol pembagi menghasilkan baris TANPA persentase, bukan "NaN%" atau "0%".
 * Keduanya berbohong ke arah yang berbeda -- yang pertama terbaca sebagai sistem
 * rusak, yang kedua sebagai fakta. Aturan yang sama sudah dipakai
 * `formatRincianMutu()` (migrations/046).
 */
function persen(n: number, dari: number): string {
  if (dari <= 0) return '';
  const p = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format((n / dari) * 100);
  return ` (${p}%)`;
}

/**
 * `{rincian_cara_bayar}` -- porsi tiap penjamin bulan itu.
 *
 * SANITASI WAJIB, dan ini satu-satunya variabel berbaris banyak di rekap ini yang
 * memuat nilai dari `sik`. `penjab.png_jawab` adalah input bebas petugas Khanza;
 * nama yang memuat baris baru bisa menyisipkan barisnya sendiri ke dalam pesan
 * dan memalsukan struktur pengumuman resmi RS (§9.2). `sanitizeValue()` dipanggil
 * di `gabungAdmBulanan()` -- bukan di sini -- supaya nilainya sudah bersih di
 * mana pun `BarisCaraBayar` dipakai, termasuk di tabel pratinjau dashboard yang
 * tidak melewati fungsi ini sama sekali. Dipatok uji PERILAKU di
 * `administrasiBulanan.test.ts`.
 *
 * Penjamin yang namanya tidak terbaca dari master ditampilkan lewat KODENYA, bukan
 * dibuang dan bukan pula sebagai baris tanpa label. Membuangnya membuat jumlah
 * pecahannya lebih kecil daripada `{jumlah_kunjungan}` tanpa satu pun keterangan;
 * baris tanpa label membuat angkanya tidak bisa ditelusuri ke mana pun.
 *
 * Jumlah PASIEN ikut disebut karena ia menjawab pertanyaan yang berbeda dari
 * kunjungan: 473 kunjungan umum bisa berarti 473 orang atau 300 orang yang
 * bolak-balik, dan yang kedua adalah beban kerja loket yang sama sekali lain.
 */
export function formatRincianCaraBayar(r: RingkasAdmBulanan): string {
  if (r.caraBayar.length === 0) return '(tidak ada kunjungan)';
  return r.caraBayar
    .map((b) => {
      const label = b.nama || `(kode ${sanitizeValue(b.kode) || 'kosong'})`;
      return (
        `• ${label} : ${formatJumlah(b.kunjungan)} kunjungan` +
        `${persen(b.kunjungan, r.jmlKunjungan)}, ${formatJumlah(b.pasien)} pasien`
      );
    })
    .join('\n');
}

/**
 * `{rincian_berkas}` -- seberapa lengkap berkas kunjungan bulan itu terisi.
 *
 * Ditulis dari sisi yang TERISI, bukan sisi yang belum, dan itu kebalikan dari
 * `formatRincianMutu()` milik farmasi. Sebabnya laju dasarnya: di farmasi yang
 * belum diserahkan 2-25%, jadi sisi "belum" adalah daftar pendek berisi pekerjaan.
 * Di sini terukur diagnosa terisi pada 0,4% kunjungan dan resume pada 0% -- sisi
 * "belum" akan berbunyi "99,6%" dan "100%", angka yang terbaca sebagai sistem
 * rusak alih-alih sebagai keadaan, dan sejak itu baris yang benar pun tidak
 * dipercaya. Pelajaran yang sama dengan label total hibah tanpa angka
 * (migrations/031).
 *
 * Ketiga angka yang menuntut TINDAKAN tetap punya variabelnya sendiri
 * (`{jumlah_tanpa_resep}`, `{jumlah_baru_tanpa_asesmen}`, `{jumlah_belum_bayar}`),
 * jadi RS yang ingin menonjolkannya tinggal menaruhnya di badan pesan -- pembagian
 * yang sama dengan `{rincian_mutu}` dan `{jumlah_belum_serah}` di 046.
 *
 * Asesmen awal pembaginya PASIEN BARU, bukan seluruh kunjungan, dan pembagi itu
 * DISEBUT di barisnya. Tanpa itu "94 (14,1%)" terbaca seolah 86% kunjungan
 * melanggar aturan yang sebenarnya tidak berlaku bagi mereka.
 *
 * TIDAK memanggil `sanitizeValue()`, dan itu bukan kelalaian -- setiap potongan
 * teks di sini literal yang ditulis di berkas ini sendiri, dan setiap angka lewat
 * `formatJumlah`/`persen` yang keluarannya cuma digit dan pemisah. Tidak ada satu
 * pun nilai dari `sik` yang masuk. Jangan tambahkan nama poli, nama dokter, atau
 * nama pasien ke sini tanpa menyanitasinya.
 */
export function formatRincianBerkas(r: RingkasAdmBulanan): string {
  const baris = [
    `• Resep : ${formatJumlah(r.jmlAdaResep)}${persen(r.jmlAdaResep, r.jmlKunjungan)}`,
    `• SOAPIE : ${formatJumlah(r.jmlAdaSoapie)}${persen(r.jmlAdaSoapie, r.jmlKunjungan)}`,
    `• Diagnosa : ${formatJumlah(r.jmlAdaDiagnosa)}${persen(r.jmlAdaDiagnosa, r.jmlKunjungan)}`,
    `• Resume : ${formatJumlah(r.jmlAdaResume)}${persen(r.jmlAdaResume, r.jmlKunjungan)}`,
    `• Asesmen awal : ${formatJumlah(r.jmlBaruAdaAsesmen)} dari ${formatJumlah(r.jmlBaru)} pasien baru` +
      `${persen(r.jmlBaruAdaAsesmen, r.jmlBaru)}`,
  ];
  return baris.join('\n');
}

/**
 * `{rincian_pasien}` -- pecahan populasi bulan itu.
 *
 * Baru/lama dan berulang ditaruh berdampingan JUSTRU karena keduanya gampang
 * tertukar, dan barisnya menyebutkan bedanya alih-alih mengandalkan pembacanya
 * mengingat: "pasien lama" adalah orang yang pernah ke poli ini sebelumnya --
 * bisa saja setahun lalu, dan cuma datang sekali bulan ini. "Pasien berulang"
 * adalah orang yang bolak-balik DI DALAM bulan yang direkap. Terukur Juli 2026:
 * 477 kunjungan pasien lama, sementara yang berulang cuma 81 orang.
 *
 * Batal ikut di sini, bukan di rincian berkas: ia keadaan KUNJUNGAN, bukan
 * kelengkapan dokumen, dan menaruhnya di daftar yang seluruh barisnya berjudul
 * "terisi" akan membuatnya terbaca sebagai berkas yang belum diisi.
 */
export function formatRincianPasien(r: RingkasAdmBulanan): string {
  return [
    `• Pasien baru : ${formatJumlah(r.jmlBaru)} kunjungan${persen(r.jmlBaru, r.jmlKunjungan)}`,
    `• Pasien lama : ${formatJumlah(r.jmlLama)} kunjungan${persen(r.jmlLama, r.jmlKunjungan)}`,
    `• Datang lebih dari sekali bulan ini : ${formatJumlah(r.jmlBerulang)} pasien` +
      `${persen(r.jmlBerulang, r.jmlPasien)}, ${formatJumlah(r.jmlKunjunganBerulang)} kunjungan`,
    `• Batal periksa : ${formatJumlah(r.jmlBatal)}${persen(r.jmlBatal, r.jmlKunjungan)}`,
  ].join('\n');
}

/** Nama bulan untuk judul pesan. Satu pintu, supaya bentuknya tidak bercabang. */
export function judulBulanAdm(r: RingkasAdmBulanan): string {
  return labelBulan(r.bulan);
}
