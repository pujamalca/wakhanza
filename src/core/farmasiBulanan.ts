import { formatJumlah, formatRupiah } from './notaBarang';
import { labelBulan } from './rekapBulan';

/**
 * REKAP BULANAN FARMASI -- penggabungan dan bentuk angkanya. Fungsi murni, tanpa
 * database dan tanpa WhatsApp.
 *
 * Dipisah ke `core/` dengan alasan yang sama seperti `resepRekap.ts` dan
 * `penjualanRekap.ts`, dan di sini alasannya lebih kuat: yang paling perlu
 * dibuktikan adalah perilaku pada bulan yang salah satu bagiannya KOSONG --
 * pemesanan dan hibah terukur nol pada setiap bulan di instalasi ini, jadi
 * cabang "ada isinya" untuk keduanya tidak akan pernah dijalankan produksi sini.
 * Membuktikannya lewat database berarti menunggu rumah sakit mulai memakai menu
 * yang sudah dua tahun tidak disentuh.
 *
 * ==========================================================================
 * Kenapa TIDAK menumpang `gabungRekapResep()`
 * ==========================================================================
 *
 * Rekap harian resep memecah per DOKTER dan menggabungkan empat agregat yang
 * masing-masing punya banyak baris. Yang ini tidak punya dimensi sama sekali --
 * sepuluh agregat, masing-masing tepat satu baris, dan tidak ada yang
 * dikelompokkan. Memaksakan keduanya lewat satu fungsi berarti fungsi yang
 * separuh parameternya selalu kosong pada tiap pemanggil, dan itu bentuk yang
 * membuat pemanggil berikutnya salah menebak apa yang wajib diisi.
 */

/** Satu jalur barang: berapa dokumen dan berapa rupiah. */
export interface RingkasDokumen {
  jml: number;
  nilai: number;
}

export interface RingkasBulanan {
  bulan: string;
  /* --- resep --- */
  jmlResep: number;
  jmlPasien: number;
  jmlKunjungan: number;
  jmlBaris: number;
  jmlObat: number;
  jmlRacikan: number;
  jmlBelumValidasi: number;
  jmlBelumSerah: number;
  jmlDiserahkan: number;
  jmlTanpaTelaah: number;
  jmlAdaTelaah: number;
  nilaiObat: number;
  /* --- barang --- */
  pengadaan: RingkasDokumen;
  pemesanan: RingkasDokumen;
  hibah: RingkasDokumen;
  penjualan: RingkasDokumen;
  /**
   * Bulan itu tidak ada satu pun kegiatan farmasi -- bukan cuma nol resep.
   * Menentukan template mana yang dipakai.
   */
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

/** Bentuk mentah satu jalur barang, sebagaimana datang dari SQL. */
export interface DokumenMentah {
  jml?: number | string | null;
  nilai?: number | string | null;
}

function dokumen(baris: DokumenMentah | null | undefined, nilaiLain?: unknown): RingkasDokumen {
  return {
    jml: angka(baris?.jml),
    nilai: nilaiLain === undefined ? angka(baris?.nilai) : angka(nilaiLain),
  };
}

/** Bentuk mentah agregat resep. */
export interface BulananMentah {
  resep?: {
    jml_resep?: number | string | null;
    jml_kunjungan?: number | string | null;
    belum_validasi?: number | string | null;
    belum_serah?: number | string | null;
    tanpa_telaah?: number | string | null;
  } | null;
  item?: { jml_baris?: number | string | null; jml_obat?: number | string | null } | null;
  racikan?: { jml_racikan?: number | string | null } | null;
  nilai?: { nilai_obat?: number | string | null } | null;
  pasien?: { jml_pasien?: number | string | null } | null;
  pengadaan?: DokumenMentah | null;
  pemesanan?: DokumenMentah | null;
  hibah?: DokumenMentah | null;
  penjualan?: DokumenMentah | null;
  penjualanNilai?: { nilai_obat?: number | string | null; nilai?: number | string | null } | null;
}

/**
 * Sepuluh agregat jadi satu ringkasan.
 *
 * `jmlDiserahkan` dan `jmlAdaTelaah` DITURUNKAN, tidak pernah di-query sendiri --
 * aturan yang sama yang membuat `jmlBelumSerah` diturunkan di `gabungRekapResep()`.
 * Query terpisah untuk masing-masing akan benar hari ini dan berhenti benar pada
 * hari pertama Khanza memakai penanda yang berbeda, dan yang muncul bukan galat
 * melainkan dua angka yang tidak berjumlah. Dengan diturunkan,
 * `diserahkan + belum = resep` dan `ada telaah + tanpa telaah = resep` dijamin
 * secara aritmetika, sehingga pembaca bisa menjumlahkannya sendiri di layar tanpa
 * membuka Khanza. Itulah yang membuat angkanya bisa dipercaya.
 *
 * Keduanya dijepit di nol: penghitung yang entah bagaimana melebihi jumlah resep
 * akan menghasilkan angka negatif, dan "-3 sudah ditelaah" jauh lebih merusak
 * kepercayaan daripada nol yang sedikit meleset.
 */
export function gabungBulanan(bulan: string, m: BulananMentah): RingkasBulanan {
  const jmlResep = angka(m.resep?.jml_resep);
  const jmlBelumSerah = angka(m.resep?.belum_serah);
  const jmlTanpaTelaah = angka(m.resep?.tanpa_telaah);

  const pengadaan = dokumen(m.pengadaan);
  const pemesanan = dokumen(m.pemesanan);
  const hibah = dokumen(m.hibah);
  /**
   * Nilai penjualan datang dari query TERPISAH (`detailjual`), bukan dari kolom
   * `nilai` pada barisnya sendiri -- `penjualan` tidak menyimpan totalnya. Lihat
   * `buildBulananPenjualanNilaiSql()`.
   */
  const penjualan = dokumen(m.penjualan, m.penjualanNilai?.nilai ?? m.penjualanNilai?.nilai_obat);

  const ringkas: RingkasBulanan = {
    bulan,
    jmlResep,
    jmlPasien: angka(m.pasien?.jml_pasien),
    jmlKunjungan: angka(m.resep?.jml_kunjungan),
    jmlBaris: angka(m.item?.jml_baris),
    jmlObat: angka(m.item?.jml_obat),
    jmlRacikan: angka(m.racikan?.jml_racikan),
    jmlBelumValidasi: angka(m.resep?.belum_validasi),
    jmlBelumSerah,
    jmlDiserahkan: Math.max(0, jmlResep - jmlBelumSerah),
    jmlTanpaTelaah,
    jmlAdaTelaah: Math.max(0, jmlResep - jmlTanpaTelaah),
    nilaiObat: angka(m.nilai?.nilai_obat),
    pengadaan,
    pemesanan,
    hibah,
    penjualan,
    /**
     * KOSONG hanya bila SELURUH kegiatan farmasi nol, bukan hanya resepnya.
     *
     * Rekap harian resep memakai `jmlResep === 0` dan itu benar di sana -- isinya
     * memang cuma resep. Di sini bulan tanpa resep tapi dengan 700 nota penjualan
     * adalah bulan yang jelas ada isinya, dan mendiamkannya menyembunyikan justru
     * keadaan yang paling perlu dilihat: peresepan berhenti sementara loket
     * tetap berjalan.
     */
    kosong: false,
  };
  ringkas.kosong =
    jmlResep === 0 &&
    pengadaan.jml === 0 &&
    pemesanan.jml === 0 &&
    hibah.jml === 0 &&
    penjualan.jml === 0;

  return ringkas;
}

/**
 * `{rincian_barang}` -- keempat jalur barang sebagai daftar.
 *
 * SELURUHNYA disebut, termasuk yang nol, dan itu permintaan eksplisit pemilik
 * sistem. Aturan "sebut hanya bila ada" yang dipakai racikan pada rekap harian
 * TIDAK berlaku di sini, dan bedanya nyata: nol racikan adalah keadaan lazim yang
 * tidak menuntut tindakan apa pun, sementara nol pemesanan bulan ini berarti
 * tidak satu pun pesanan dikirim ke pemasok -- keadaan yang orang gudang justru
 * ingin tahu. Menyembunyikannya membuat "tidak ada pesanan" tidak bisa dibedakan
 * dari "fiturnya tidak membaca pesanan".
 *
 * Terukur di instalasi ini: pemesanan dan hibah NOL pada setiap bulan (menunya
 * masing-masing praktis belum dipakai), pengadaan 20-42 faktur, penjualan
 * 307-765 nota.
 *
 * Rupiah selalu disertakan, dengan alasan yang sudah dibayar di
 * `formatRincianDokter()`: baris yang kadang menyebut rupiah dan kadang tidak
 * membuat penjumlahannya mustahil.
 *
 * TIDAK memanggil `sanitizeValue()`, dan itu bukan kelalaian -- setiap potongan
 * teks di sini adalah literal yang ditulis di berkas ini sendiri, dan setiap
 * angka lewat `formatJumlah`/`formatRupiah` yang keluarannya cuma digit dan
 * pemisah. Tidak ada satu pun nilai dari `sik` yang masuk. Itulah syarat yang
 * membuatnya aman berada di `MULTILINE_VARIABLES`; jangan tambahkan nama
 * pemasok, nama gudang, atau nama petugas ke sini tanpa menyanitasinya.
 */
export function formatRincianBarang(r: RingkasBulanan): string {
  const baris: [string, RingkasDokumen, string][] = [
    ['Pengadaan', r.pengadaan, 'faktur'],
    ['Pemesanan', r.pemesanan, 'surat'],
    ['Hibah', r.hibah, 'penerimaan'],
    ['Penjualan', r.penjualan, 'nota'],
  ];
  return baris
    .map(
      ([nama, d, satuan]) =>
        `• ${nama} : ${formatJumlah(d.jml)} ${satuan}, ${formatRupiah(d.nilai)}`,
    )
    .join('\n');
}

/**
 * `{rincian_mutu}` -- ketiga angka "yang tidak", berikut persentasenya.
 *
 * Persentase ada karena angka telanjang tidak bisa dinilai tanpa pembaginya: 175
 * resep belum diserahkan berarti hal yang sangat berbeda pada bulan 685 resep
 * (25%) dan pada bulan 3.000 resep (6%). Terukur, angka inilah yang paling
 * bergerak di instalasi ini -- belum diserahkan naik dari 9 (Februari) ke 175
 * (Juli), dan tanpa telaah dari 30 ke 145. Tren seperti itu tidak terlihat sama
 * sekali dari rekap harian.
 *
 * Pembagi nol menghasilkan baris TANPA persentase, bukan "NaN%" atau "0%".
 * Keduanya berbohong ke arah yang berbeda -- yang pertama terbaca sebagai sistem
 * rusak, yang kedua sebagai kabar baik.
 */
export function formatRincianMutu(r: RingkasBulanan): string {
  const persen = (n: number): string =>
    r.jmlResep > 0 ? ` (${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format((n / r.jmlResep) * 100)}%)` : '';

  return [
    `• Belum divalidasi : ${formatJumlah(r.jmlBelumValidasi)}${persen(r.jmlBelumValidasi)}`,
    `• Belum diserahkan : ${formatJumlah(r.jmlBelumSerah)}${persen(r.jmlBelumSerah)}`,
    `• Belum ditelaah : ${formatJumlah(r.jmlTanpaTelaah)}${persen(r.jmlTanpaTelaah)}`,
  ].join('\n');
}

/** Nama bulan untuk judul pesan. Satu pintu, supaya bentuknya tidak bercabang. */
export function judulBulan(r: RingkasBulanan): string {
  return labelBulan(r.bulan);
}
