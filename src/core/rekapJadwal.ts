/**
 * JADWAL REKAP HARIAN -- matematika jam dan tanggal yang dipakai BERSAMA oleh
 * setiap rekap harian, apa pun isinya. Fungsi murni, tanpa database.
 *
 * ==========================================================================
 * Kenapa dipisah ke berkas sendiri
 * ==========================================================================
 *
 * Ketiganya lahir di `core/penjualanRekap.ts` waktu rekap harian cuma ada satu.
 * Begitu rekap KEDUA (resep, migrations/042) datang, ada dua pilihan: menyalinnya,
 * atau mengangkatnya ke sini.
 *
 * Menyalinnya adalah bentuk kegagalan yang sudah berkali-kali dibayar di proyek
 * ini (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`,
 * `core/tujuanPemicu.ts`, `core/tujuanPemicu.ts`): beberapa tempat berjauhan
 * menafsirkan sendiri satu hal yang sama, dan cukup SATU yang berbeda untuk
 * membuat satu jalur diam-diam berperilaku lain. Di sini bentuk penyimpangannya
 * bisa dibayangkan persis -- dua salinan `hariRekap()` yang berbeda satu baris
 * dalam menangani pergantian bulan menghasilkan DUA REKAP yang tidak sepakat
 * tanggal berapa "kemarin", dikirim ke grup yang sama, pada malam yang sama.
 * Tanpa satu pun galat.
 *
 * Membiarkannya di `penjualanRekap.ts` lalu mengimpornya dari modul resep juga
 * salah, dan bukan cuma soal nama: berkas itu berisi `gabungRekap()` yang penuh
 * pengetahuan tentang `jns_jual` dan rupiah, jadi setiap penyunting berikutnya
 * yang membuka `resepRekap.ts` akan menemukan impor dari sebuah modul penjualan
 * dan wajar menyimpulkan ada keterkaitan yang sebenarnya tidak ada.
 *
 * `penjualanRekap.ts` ME-RE-EXPORT ketiganya, jadi tidak satu pun impor yang
 * sudah ada berubah dan fitur yang sedang berjalan di produksi tidak tersentuh.
 *
 * ==========================================================================
 * Yang SENGAJA tidak ikut pindah: jam bawaan
 * ==========================================================================
 *
 * `JAM_REKAP_BAWAAN` (21:00 penjualan) dan `JAM_REKAP_RESEP_BAWAAN` (22:00)
 * tetap tinggal di modul fiturnya masing-masing. Keduanya BUKAN kesepakatan
 * bersama melainkan hasil pengukuran yang berbeda -- penjualan berhenti pukul
 * 20:00 dengan jam 21 benar-benar nol, sementara peresepan punya ekor tipis
 * sampai 23:11. Menyatukannya jadi satu konstanta berarti satu pengukuran
 * diam-diam dipakai untuk membenarkan yang lain, dan angka yang kehilangan
 * asal-usulnya adalah angka yang tidak bisa dipertanggungjawabkan saat
 * dipertanyakan.
 */

export interface JamRekap {
  jam: number;
  menit: number;
}

/**
 * Baca "HH:MM" dari pengaturan.
 *
 * Mengembalikan `null` untuk apa pun yang tidak berbentuk jam yang sah, dan
 * PEMANGGIL yang memutuskan artinya -- dua kelas pemanggilnya memang harus
 * berbeda:
 *
 * - Server action saat MENYIMPAN menolaknya di depan orang yang bisa
 *   memperbaikinya seketika.
 * - Worker, yang berjalan tengah malam tanpa siapa-siapa untuk diberi tahu,
 *   jatuh ke jam bawaan fiturnya dan mencatat `warn`. Menolak diam berarti
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
