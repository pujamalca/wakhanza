/**
 * Bagian bersama dua NOTA BARANG: pengadaan (pembelian dari pemasok) dan hibah
 * (barang yang diterima sebagai pemberian).
 *
 * Keduanya lahir dari menu yang berbeda di Khanza dan menulis ke tabel yang
 * berbeda, tapi bentuk PESANNYA sama: satu kepala nota, satu daftar barang
 * berikut jumlah dan nilainya, lalu beberapa baris angka penutup. Yang
 * benar-benar berbeda cuma isi tiap barisnya -- dan itulah yang ditinggalkan di
 * `core/pengadaan.ts` dan `core/hibah.ts` masing-masing.
 *
 * Yang tinggal DI SINI adalah bagian yang kalau menyimpang tidak menghasilkan
 * galat melainkan dua bentuk pesan berbeda dari satu sistem: pembulatan rupiah,
 * penanda tanggal kosong Khanza, pengelompokan per nomor, dan aturan pemecahan
 * pesan panjang. Bentuk kegagalan yang sama sudah dibayar berkali-kali di proyek
 * ini (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`,
 * `khanza/stokGudang.ts`, `core/jendelaPindai.ts`).
 *
 * Seluruhnya fungsi murni -- tanpa database, tanpa WhatsApp -- supaya pratinjau
 * di `/farmasi` memakai fungsi yang SAMA dipakai worker saat benar-benar
 * mengirim.
 *
 * TIDAK ADA SATU PUN DATA PASIEN yang lewat sini, dan tidak bisa ada: kedua
 * tabel sumbernya tidak punya kolom yang menautkan sebuah transaksi dengan
 * seorang pasien. Lihat komentar pembuka `khanza/pengadaan.ts`.
 */

/**
 * Panjang maksimal daftar barang dalam SATU pesan WhatsApp; selebihnya dipecah.
 *
 * Angkanya bukan dibaca dari dokumentasi melainkan DIUKUR: pesan 13.035 karakter
 * dikirim lewat sesi whatsapp-web.js sungguhan di mesin ini dan terbukti
 * terkirim dalam 274 ms (bukti di VERIFICATION.md, seksi darurat stok).
 *
 * Dipakai BERSAMA oleh pengadaan dan hibah, dan itu berbeda dari keputusan yang
 * tercatat untuk `BATAS_KARAKTER_BAGIAN` milik darurat stok -- yang sengaja
 * menyalin angkanya alih-alih mengimpornya. Bedanya: darurat stok mengirim
 * DAFTAR KEKURANGAN, jenis pesan yang berbeda dan yang boleh punya anggaran
 * panjangnya sendiri; pengadaan dan hibah mengirim nota barang yang bentuknya
 * sama persis, dari gudang yang sama, ke grup yang sama. Anggaran yang berbeda
 * di antara keduanya tidak akan pernah bisa dijelaskan.
 */
export const BATAS_KARAKTER_NOTA = 12000;

/**
 * Ruang yang disisihkan di tiap bagian untuk penanda "(bagian i dari n)".
 * Penanda itu baru diketahui SESUDAH pemecahan selesai, jadi tanpa cadangan ini
 * bagian terakhir bisa melewati batas justru karena keterangan yang menjelaskan
 * bahwa ia terpecah.
 */
const CADANGAN_KETERANGAN = 80;

/**
 * `null`/`undefined`/string kosong ditolak SEBELUM `Number()` menyentuhnya, dan
 * itu bukan kerapian.
 *
 * `Number(null)` dan `Number('')` keduanya menjawab `0`, yang lolos
 * `Number.isFinite`. Jadi tanpa pemeriksaan ini, harga yang tidak tercatat
 * (kolomnya NULLABLE di Khanza, pada kedua tabel) akan dicetak sebagai **"Rp0"**
 * -- bukan "tidak diketahui" melainkan "gratis". Itu jawaban
 * percaya-diri-dan-keliru yang sama jenisnya dengan `detectPoli()` yang menebak
 * saat ambigu, dan di sini ia menyangkut angka yang dipakai gudang mencocokkan
 * barang dengan notanya.
 *
 * Ditemukan unit test, bukan diperkirakan.
 */
function keAngka(nilai: unknown): number | null {
  if (nilai === null || nilai === undefined || nilai === '') return null;
  const n = typeof nilai === 'number' ? nilai : Number(nilai);
  return Number.isFinite(n) ? n : null;
}

/**
 * Angka rupiah untuk dibaca manusia.
 *
 * MySQL `double` menyeberang lewat mysql2 kadang sebagai `number` dan kadang
 * sebagai string (tergantung driver dan besarannya), jadi keduanya diterima.
 * Yang bukan angka menghasilkan string KOSONG, bukan "Rp NaN" -- pesan yang
 * memuat NaN terbaca sebagai sistem rusak, dan sejak itu angka yang benar pun
 * tidak dipercaya.
 */
export function formatRupiah(nilai: unknown): string {
  const n = keAngka(nilai);
  if (n === null) return '';
  return `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n)}`;
}

/** Jumlah barang; pecahan dipertahankan karena kolom `jumlah` bertipe double. */
export function formatJumlah(nilai: unknown): string {
  const n = keAngka(nilai);
  if (n === null) return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
}

/**
 * Dua nilai rupiah dianggap sama untuk keperluan tampilan.
 *
 * Dipakai hibah, yang menyimpan DUA angka per barang (nilai yang disebut pemberi
 * dan nilai yang diakui RS) dan hanya perlu menampilkan keduanya saat memang
 * berbeda. Perbandingan lewat `keAngka` dan bukan `===` mentah karena keduanya
 * bisa datang sebagai string dari mysql2: `'20'` dan `20` adalah angka yang
 * sama, dan menampilkannya sebagai selisih akan membuat seluruh notanya terbaca
 * seperti ada yang salah.
 *
 * `null` di salah satu sisi berarti TIDAK bisa disebut sama -- angka yang tidak
 * tercatat bukan angka yang kebetulan cocok.
 */
export function nilaiSama(a: unknown, b: unknown): boolean {
  const x = keAngka(a);
  const y = keAngka(b);
  if (x === null || y === null) return false;
  return x === y;
}

/**
 * Tanggal `YYYY-MM-DD` dari Khanza jadi bentuk yang dibaca orang.
 *
 * Koneksi `sik` memakai `dateStrings: true`, jadi yang datang adalah string --
 * bukan `Date`. Penanda kosong Khanza (`'0000-00-00'`) dan nilai yang bentuknya
 * tidak dikenali dikembalikan sebagai string KOSONG, bukan diteruskan apa
 * adanya: "Tanggal : 0000-00-00" terbaca sebagai sistem rusak, dan perlakuannya
 * jadi sama dengan variabel lain yang memang tidak terisi.
 */
export function formatTanggalDokumen(tgl: string | null): string {
  if (!tgl) return '';
  const cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(tgl);
  if (!cocok || cocok[1] === '0000') return '';
  return `${cocok[3]}-${cocok[2]}-${cocok[1]}`;
}

/**
 * Mengelompokkan rincian menurut nomor dokumennya.
 *
 * Satu query mengembalikan rincian untuk SEKIAN dokumen sekaligus (`IN`), jadi
 * pengelompokannya harus terjadi di sini. `Map` dan bukan objek biasa: nomornya
 * adalah kunci yang datang dari database, dan objek biasa punya kunci bawaan
 * (`constructor`, `__proto__`) yang bisa bertabrakan dengannya.
 */
export function kelompokkanPerNomor<T>(rows: T[], ambilKunci: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const kunci = ambilKunci(r);
    const daftar = out.get(kunci);
    if (daftar) daftar.push(r);
    else out.set(kunci, [r]);
  }
  return out;
}

/**
 * Baris barang yang sudah jadi teks, dipecah menjadi SATU ATAU BEBERAPA pesan.
 *
 * Menerima baris yang sudah diformat -- bukan barisnya mentah -- justru supaya
 * seam-nya jatuh di tempat yang benar: ATURAN PEMECAHAN wajib sama untuk kedua
 * nota (kalau tidak, satu nota panjang terpotong berbeda dari yang lain tanpa
 * ada yang bisa menjelaskannya), sementara ISI tiap barisnya memang berbeda
 * karena kolom nilainya berbeda.
 *
 * Tidak pernah membelah satu baris barang, dan selalu memuat setidaknya satu
 * baris per bagian -- jaminan kedua itu yang membuat perulangannya pasti
 * berhenti sekalipun batasnya disetel lebih kecil daripada satu baris.
 */
export function pecahBarisBarang(baris: string[], batasKarakter: number): string[] {
  if (baris.length === 0) return [];

  const batas =
    Number.isFinite(batasKarakter) && batasKarakter > 0
      ? Math.max(1, Math.floor(batasKarakter) - CADANGAN_KETERANGAN)
      : Number.MAX_SAFE_INTEGER;

  const bagian: string[] = [];
  let buf: string[] = [];
  let panjang = 0;

  for (const b of baris) {
    const biaya = b.length + (buf.length === 0 ? 0 : 1);
    // Baris PERTAMA tiap bagian selalu ditulis tanpa syarat -- itu yang menjamin
    // perulangan ini maju walau batasnya dibuat tidak masuk akal.
    if (buf.length > 0 && panjang + biaya > batas) {
      bagian.push(buf.join('\n'));
      buf = [];
      panjang = 0;
    }
    panjang += b.length + (buf.length === 0 ? 0 : 1);
    buf.push(b);
  }
  if (buf.length > 0) bagian.push(buf.join('\n'));

  // Penanda hanya muncul saat memang terpecah. Pesan tunggal bertanda
  // "(bagian 1 dari 1)" membuat pembacanya menunggu bagian kedua yang tidak akan
  // pernah datang.
  if (bagian.length > 1) {
    return bagian.map((b, i) => `_(bagian ${i + 1} dari ${bagian.length})_\n${b}`);
  }
  return bagian;
}
