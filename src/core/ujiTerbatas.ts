/**
 * MODE UJI TERBATAS -- membatasi berapa banyak PASIEN yang boleh menerima satu
 * pemicu dalam sehari, supaya menyalakan mode pasien tidak harus taruhan penuh.
 *
 * Kenapa perlu ada. `template.tujuan_mode` semua-atau-tidak: begitu diubah dari
 * `tujuan` ke `pasien_dan_tujuan`, SELURUH kejadian hari itu langsung berubah
 * jadi WhatsApp ke pasien. Di rumah sakit ini itu berarti ~22 orang asing
 * menerima pesan dari nomor RS pada hari pertama, tanpa ada satu pun cara
 * mencobanya lebih kecil dulu. Yang terjadi kemudian bisa saja benar -- tapi
 * kalau ada yang salah (kalimatnya keliru, nomornya milik orang lain, jam
 * kirimnya mengganggu), yang menanggungnya 22 orang sekaligus dan yang menerima
 * keluhannya loket.
 *
 * PRD Fase 5 menyebut ini "uji coba bertahap" dan selama ini diperlakukan
 * sebagai proses operasional semata. Sebagiannya memang begitu -- tapi
 * "bertahap" tidak bisa dijalankan sama sekali tanpa bentuk kodenya.
 *
 * Murni: keputusannya tidak menyentuh database, justru supaya keadaan yang
 * paling perlu dibuktikan (tepat di batas, dan batas nol) bisa diuji tanpa
 * membuat satu baris pun.
 */

/** 0 = tanpa batas. Bukan "tidak ada yang boleh lewat" -- lihat `bolehKirimKePasien`. */
export const TANPA_BATAS = 0;

export interface KeputusanUji {
  /** Boleh dikirim ke pasien. */
  boleh: boolean;
  /**
   * Sisa jatah SESUDAH kiriman ini, bila ada batasnya. `null` = tanpa batas.
   * Dipakai untuk mencatat "tinggal N lagi hari ini" ke log, supaya staf tidak
   * perlu menghitung sendiri kapan jatahnya akan habis.
   */
  sisa: number | null;
}

/**
 * Bolehkah satu pesan lagi dikirim ke pasien untuk pemicu ini hari ini.
 *
 * `batas <= 0` berarti TANPA BATAS, bukan nol -- dan pembedaan itu wajib.
 * Kolomnya bawaan 0 untuk seluruh baris yang sudah ada, jadi menafsirkan 0
 * sebagai "nol pesan" akan MEMATIKAN seluruh pemicu pasien yang sedang berjalan
 * pada saat migrasinya diterapkan, diam-diam, sebagai efek samping penambahan
 * fitur. Nilai negatif diperlakukan sama demi alasan yang sama: satu-satunya
 * cara membatasi adalah menuliskan angka positif dengan sengaja.
 *
 * `terpakai` dihitung dari baris `outbox` HARI INI yang benar-benar menuju
 * pasien -- salinan ke grup tidak ikut, karena yang dibatasi adalah paparan ke
 * pasien dan bukan lalu lintas pesan.
 */
export function bolehKirimKePasien(batas: number, terpakai: number): KeputusanUji {
  if (!Number.isFinite(batas) || batas <= TANPA_BATAS) return { boleh: true, sisa: null };

  const dipakai = Number.isFinite(terpakai) && terpakai > 0 ? Math.floor(terpakai) : 0;
  if (dipakai >= batas) return { boleh: false, sisa: 0 };

  return { boleh: true, sisa: batas - dipakai - 1 };
}

/**
 * Apakah angka batas yang diketik staf sah untuk disimpan.
 *
 * Batas atas 500 bukan angka teknis melainkan pernyataan: di atas itu ia bukan
 * lagi uji terbatas, dan yang sebenarnya diinginkan adalah mematikan batasnya
 * (0). Membiarkan angka raksasa tersimpan membuat halaman menampilkan "uji
 * terbatas aktif" untuk pemicu yang praktis tanpa batas -- keterangan yang
 * membohongi pembacanya sendiri.
 */
export const BATAS_MAKSIMAL = 500;

export function batasSah(nilai: number): boolean {
  return Number.isInteger(nilai) && nilai >= 0 && nilai <= BATAS_MAKSIMAL;
}
