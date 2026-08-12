import { sanitizeValue } from './template';
import { formatRupiah, formatJumlah } from './notaBarang';

/**
 * REKAP HARIAN PENJUALAN -- fungsi murni, tanpa database dan tanpa WhatsApp.
 *
 * Dipisah ke `core/` dengan alasan yang sama seperti `core/pantauPenjualan.ts`:
 * yang paling perlu dibuktikan di sini adalah perilaku di sekitar batas -- hari
 * tanpa satu pun penjualan, penyesuaian yang NEGATIF, jam yang salah ketik staf,
 * pergantian bulan pada offset hari -- dan membuktikannya lewat database berarti
 * menunggu keadaan itu benar-benar terjadi.
 *
 * Sekaligus: pratinjau di `/farmasi` memakai fungsi yang SAMA dipakai worker.
 * Pratinjau yang berbeda dari kenyataan lebih buruk daripada tanpa pratinjau --
 * pelajaran yang sudah dibayar di kotak uji balasan otomatis, balasan stok, dan
 * darurat stok.
 *
 * TIDAK ADA SATU PUN DATA PASIEN yang lewat sini: masukannya sudah berupa
 * agregat per `jns_jual`, dan `khanza/penjualan.ts` memang tidak pernah
 * men-SELECT `no_rkm_medis`/`nm_pasien`. Lihat komentar pembuka berkas itu.
 */

/** Satu baris agregat dari `penjualan`, dikelompokkan per jenis penjualan. */
export interface BarisRekapHeader {
  jns_jual: string;
  jml_nota: number | string;
  ppn: number | string | null;
  penyesuaian: number | string | null;
}

/** Satu baris agregat dari `detailjual`, dikelompokkan per jenis penjualan. */
export interface BarisRekapItem {
  jns_jual: string;
  jml_baris: number | string;
  jml_barang: number | string | null;
  subtotal: number | string | null;
}

export interface BarisJenis {
  jenis: string;
  jmlNota: number;
  jmlBaris: number;
  jmlBarang: number;
  subtotal: number;
  penyesuaian: number;
  ppn: number;
  total: number;
}

export interface RingkasRekap {
  jmlNota: number;
  jmlBaris: number;
  jmlBarang: number;
  subtotal: number;
  penyesuaian: number;
  ppn: number;
  total: number;
  perJenis: BarisJenis[];
  /** Hari itu tidak ada satu nota pun. Menentukan template mana yang dipakai. */
  kosong: boolean;
}

/**
 * mysql2 menyerahkan `SUM()` kadang sebagai number dan kadang sebagai string
 * (`DECIMAL`/`double` tergantung driver dan besarannya), jadi keduanya diterima.
 *
 * Yang bukan angka jadi 0, dan di SINI itu benar -- berbeda dari `keAngka()` di
 * `core/notaBarang.ts`, yang sengaja mengembalikan null supaya harga yang tidak
 * tercatat tidak dicetak "Rp0" alias "gratis". Bedanya: di sana nilainya adalah
 * FAKTA TENTANG SATU BARANG yang bisa saja belum diisi; di sini ia hasil
 * `COALESCE(SUM(...), 0)` atas sekumpulan baris, dan penjumlahan yang tidak
 * menghasilkan apa-apa memang bernilai nol. Nota tanpa PPN benar-benar
 * menyumbang nol pada PPN hari itu.
 */
function angka(nilai: unknown): number {
  if (nilai === null || nilai === undefined || nilai === '') return 0;
  const n = typeof nilai === 'number' ? nilai : Number(nilai);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gabungkan kedua agregat jadi satu ringkasan.
 *
 * DUA query dan bukan satu, dan penggabungannya di sini justru karena itu:
 * `penjualan` menyimpan angka per NOTA (ppn, penyesuaian) sementara `detailjual`
 * menyimpan angka per BARANG (subtotal). Satu query yang menjoinkan keduanya
 * akan menggandakan ppn dan penyesuaian sebanyak barang di dalam notanya lalu
 * menjumlahkan hasil gandaan itu -- sebuah nota berisi 5 barang menyumbang
 * penyesuaiannya LIMA KALI. Kesalahan yang tidak menghasilkan galat apa pun,
 * cuma angka total yang keliru.
 *
 * Jenis yang muncul hanya di salah satu sisi tetap dipertahankan: nota tanpa satu
 * baris rincian pun benar-benar ada (terukur 1 dari 16.787), dan membuangnya
 * membuat `jmlNota` di rekap tidak cocok dengan jumlah nota yang sungguhan.
 */
export function gabungRekap(header: BarisRekapHeader[], item: BarisRekapItem[]): RingkasRekap {
  const per = new Map<string, BarisJenis>();

  const ambil = (jenis: string): BarisJenis => {
    const ada = per.get(jenis);
    if (ada) return ada;
    const baru: BarisJenis = {
      jenis,
      jmlNota: 0,
      jmlBaris: 0,
      jmlBarang: 0,
      subtotal: 0,
      penyesuaian: 0,
      ppn: 0,
      total: 0,
    };
    per.set(jenis, baru);
    return baru;
  };

  for (const h of header) {
    const b = ambil(h.jns_jual ?? '');
    b.jmlNota += angka(h.jml_nota);
    b.ppn += angka(h.ppn);
    b.penyesuaian += angka(h.penyesuaian);
  }
  for (const i of item) {
    const b = ambil(i.jns_jual ?? '');
    b.jmlBaris += angka(i.jml_baris);
    b.jmlBarang += angka(i.jml_barang);
    b.subtotal += angka(i.subtotal);
  }

  for (const b of per.values()) b.total = b.subtotal + b.ppn + b.penyesuaian;

  /**
   * Diurutkan di SINI, bukan lewat `ORDER BY` di SQL.
   *
   * Yang menentukan urutan adalah angka HASIL PENGGABUNGAN dua query, jadi tidak
   * satu pun dari keduanya bisa mengurutkannya sendiri dengan benar. Nomor dua
   * (nama, menaik) supaya dua jenis berjumlah sama tidak bertukar tempat antar
   * hari -- rekap yang barisnya berpindah-pindah tanpa sebab membuat pembacanya
   * mengira ada yang berubah.
   */
  const perJenis = [...per.values()].sort(
    (a, b) => b.jmlNota - a.jmlNota || a.jenis.localeCompare(b.jenis),
  );

  const jumlah = (pilih: (b: BarisJenis) => number): number =>
    perJenis.reduce((t, b) => t + pilih(b), 0);

  const jmlNota = jumlah((b) => b.jmlNota);

  return {
    jmlNota,
    jmlBaris: jumlah((b) => b.jmlBaris),
    jmlBarang: jumlah((b) => b.jmlBarang),
    subtotal: jumlah((b) => b.subtotal),
    penyesuaian: jumlah((b) => b.penyesuaian),
    ppn: jumlah((b) => b.ppn),
    total: jumlah((b) => b.total),
    perJenis,
    /**
     * Ditentukan JUMLAH NOTA, bukan totalnya.
     *
     * Hari yang notanya ada tapi berjumlah nol rupiah (barang gratis, atau
     * potongan yang menghabiskan nilainya) tetap hari yang ada penjualannya, dan
     * mendiamkannya sebagai "tidak ada penjualan" menyembunyikan justru keadaan
     * yang paling perlu dilihat orang.
     */
    kosong: jmlNota === 0,
  };
}

/**
 * `{rincian_jenis}` -- satu baris per jenis penjualan.
 *
 * `sanitizeValue()` dipanggil untuk `jenis`, dan itu keharusan bukan kerapian:
 * variabel ini masuk `MULTILINE_VARIABLES` di `core/template.ts`, yang artinya
 * `renderTemplate()` TIDAK menyanitasinya lagi. Isinya berasal dari kolom
 * `penjualan.jns_jual` milik Khanza, jadi setiap baris baru pada hasil akhir
 * harus dipasang kode ini -- kalau tidak, satu nilai yang memuat baris baru bisa
 * dipakai memalsukan struktur pesan supaya tampak seperti pengumuman resmi RS
 * (ARCHITECTURE §9.2).
 *
 * Jenis yang kosong diberi nama "(tanpa jenis)" alih-alih dibiarkan kosong:
 * baris yang dibuka tanda hubung tanpa nama terbaca sebagai pesan rusak, dan
 * angkanya jadi tidak bisa dipertanggungjawabkan ke mana pun.
 */
export function formatRincianJenis(rows: BarisJenis[]): string {
  return rows
    .map((b) => {
      const nama = sanitizeValue(b.jenis) || '(tanpa jenis)';
      return `• ${nama} : ${formatJumlah(b.jmlNota)} nota, ${formatRupiah(b.total)}`;
    })
    .join('\n');
}

export interface JamRekap {
  jam: number;
  menit: number;
}

/** Jam kirim bawaan bila pengaturannya kosong atau tidak terbaca. Lihat migrations/041. */
export const JAM_REKAP_BAWAAN: JamRekap = { jam: 21, menit: 0 };

/**
 * Baca "HH:MM" dari pengaturan.
 *
 * Mengembalikan `null` untuk apa pun yang tidak berbentuk jam yang sah, dan
 * PEMANGGIL yang memutuskan artinya -- dua pemanggilnya memang harus berbeda:
 *
 * - Server action saat MENYIMPAN menolaknya di depan orang yang bisa
 *   memperbaikinya seketika.
 * - Worker, yang berjalan tengah malam tanpa siapa-siapa untuk diberi tahu,
 *   jatuh ke `JAM_REKAP_BAWAAN` dan mencatat `warn`. Menolak diam berarti
 *   rekapnya berhenti selamanya tanpa satu pun tanda -- kegagalan senyap yang
 *   sama jenisnya dengan sakelar menyala tanpa tujuan tercentang.
 *
 * Bentuk `H:M` (satu digit) diterima; `24:00` tidak, karena tidak ada waktu
 * seperti itu dalam sehari dan menerimanya berarti jadwal yang tidak pernah
 * jatuh tempo.
 */
export function bacaJamRekap(raw: string | null | undefined): JamRekap | null {
  if (!raw) return null;
  const cocok = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})\s*$/.exec(raw);
  if (!cocok) return null;
  const jam = Number(cocok[1]);
  const menit = Number(cocok[2]);
  if (!Number.isInteger(jam) || !Number.isInteger(menit)) return null;
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
  return { jam, menit };
}

/** Bentuk normal untuk disimpan kembali ke pengaturan. */
export function tulisJamRekap(j: JamRekap): string {
  return `${String(j.jam).padStart(2, '0')}:${String(j.menit).padStart(2, '0')}`;
}

/**
 * Tanggal yang direkap, dihitung mundur dari hari saat rekapnya dikirim.
 *
 * `setDate` dipakai apa adanya (bukan aritmetika milidetik) supaya pergantian
 * bulan, tahun, dan tahun kabisat ditangani Node, bukan oleh kita -- pola yang
 * sama dengan `sasaranKontrol()` di `core/bpjs.ts`.
 *
 * Offset negatif dianggap 0: "merekap hari besok" tidak punya arti, dan
 * membiarkannya lewat berarti rekap yang selamanya kosong.
 */
export function hariRekap(sekarang: Date, offsetHari: number): string {
  const n = Number.isFinite(offsetHari) ? Math.max(0, Math.floor(offsetHari)) : 0;
  const d = new Date(sekarang);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
