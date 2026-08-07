/**
 * Jendela tanggal untuk pemicu kelas PINDAI.
 *
 * Dua pemicu memakainya -- SURAT_SAKIT (`core/suratOtomatis.ts`) dan PENGADAAN
 * (`core/pengadaan.ts`) -- dan keduanya sampai ke bentuk yang sama lewat sebab
 * yang sama: tabel sumbernya tidak punya stempel waktu penyimpanan, sehingga
 * watermark mustahil benar dan yang tersisa adalah jendela yang dipindai ulang
 * tiap siklus dengan dedup lewat kunci idempoten.
 *
 * Berdiri sebagai modulnya sendiri, bukan disalin ke keduanya. Menyalin adalah
 * bentuk kegagalan yang sudah dibayar berkali-kali di proyek ini
 * (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`,
 * `khanza/stokGudang.ts`): dua tempat menafsirkan sendiri satu aturan yang sama,
 * dan cukup satu yang menyimpang untuk membuat satu pemicu diam-diam melewatkan
 * baris tanpa satu pun galat.
 */

export interface JendelaPindai {
  /** `YYYY-MM-DD`, inklusif. */
  dari: string;
  /** `YYYY-MM-DD`, inklusif. */
  sampai: string;
}

function iso(d: Date): string {
  const bulan = String(d.getMonth() + 1).padStart(2, '0');
  const hari = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${bulan}-${hari}`;
}

/**
 * Jendela yang merentang KE DUA ARAH dari hari ini.
 *
 * Arah MAJU bukan kehati-hatian, melainkan konsekuensi dari cara Khanza merakit
 * nomor: prefiksnya diambil dari kotak tanggal yang dipilih staf, jadi sebuah
 * baris yang dibuat hari ini untuk tanggal pekan depan bernomor lebih BESAR
 * daripada prefiks hari ini. Batas atas yang berhenti di hari ini akan membuang
 * persis baris-baris itu, tanpa satu pun galat.
 *
 * Arah MUNDUR memberi kesempatan kedua pada siklus yang gagal (worker mati,
 * MariaDB terkunci SIMRS) tanpa perlu mekanisme percobaan ulang tersendiri, dan
 * menjaring baris yang tanggalnya digeser ke belakang.
 *
 * `sejak` adalah LANTAINYA -- tanggal saat sakelarnya dinyalakan. Tanpa itu,
 * menyalakan sebuah pemicu berarti seluruh isi jendela, termasuk yang sudah
 * berumur seminggu, langsung jadi pesan WhatsApp pada siklus berikutnya.
 * Pelajaran yang sama dengan `LAB_REQUEST`, yang bawaannya nonaktif justru
 * supaya pemicu yang baru menyala tidak mengirim sebulan penuh sekaligus.
 *
 * Konsekuensi yang HARUS disadari, dan yang wajib dikatakan di depan staf pada
 * halaman yang menyalakannya: apa pun yang bernomor sebelum hari aktivasi tidak
 * pernah terkirim otomatis, selamanya.
 */
export function hitungJendelaPindai(hariIni: Date, lookbackHari: number, sejak: string | null): JendelaPindai {
  const rentang = Math.max(0, lookbackHari);

  const mundur = new Date(hariIni);
  mundur.setDate(mundur.getDate() - rentang);
  const maju = new Date(hariIni);
  maju.setDate(maju.getDate() + rentang);

  const bawah = iso(mundur);
  // Lantai aktivasi menang bila ia lebih baru. Perbandingan string aman karena
  // keduanya `YYYY-MM-DD` berlebar tetap.
  const dari = sejak && sejak > bawah ? sejak : bawah;
  return { dari, sampai: iso(maju) };
}
