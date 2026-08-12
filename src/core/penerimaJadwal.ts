/**
 * MEMBUANG SEORANG PENERIMA dari sebuah jadwal broadcast.
 *
 * ==========================================================================
 * Kenapa ini bukan sekadar `daftar.filter(...)`
 * ==========================================================================
 *
 * Kebutuhannya sederhana dan nyata: staf membuat jadwal untuk SATU pasien
 * dengan mengetik namanya di kotak cari, lalu `LIKE '%nama%'` ternyata cocok
 * dengan dua orang. Yang kedua tidak dimaksudkan, dan sampai ada cara
 * membuangnya satu-satunya jalan adalah menghapus jadwalnya lalu menyusun
 * ulang dari nol.
 *
 * Yang membuatnya tidak sepele: pada jadwal bermode `semua`, penerimanya bukan
 * daftar melainkan HASIL FILTER. Tidak ada baris yang bisa dihapus -- yang ada
 * cuma filter yang menghasilkan orang itu. Karena itu membuang seseorang dari
 * jadwal semacam itu berarti MENGUBAH BENTUKNYA: dari "siapa pun yang cocok"
 * menjadi "orang-orang ini" (`mode: 'pilih'`, core/pilihanPasien.ts).
 *
 * Konversi itu memakai jalur yang SUDAH ADA dan sudah teruji -- tidak ada
 * semantik baru sama sekali. Bentuk yang satunya (menyimpan daftar
 * PENGECUALIAN yang dikurangkan dari hasil filter) sengaja ditolak: ia menaruh
 * cara KEDUA menentukan penerima di jalur terpanas proyek ini
 * (`fetchSegmentUntukJadwal`, dipakai worker + pratinjau + pemeriksaan simpan),
 * dan satu tempat yang lupa mengurangkannya berarti pasien yang sudah
 * dikeluarkan tetap dikirimi tanpa satu pun galat.
 *
 * Fungsi murni, dan masukannya dibentuk STRUKTURAL alih-alih mengimpor
 * `ScheduleFilterConfig` -- modul itu menarik `khanza/*` yang berujung ke
 * koneksi database. Pola `core/broadcastVars.ts` dan `core/suratOtomatis.ts`.
 */

export interface KonfigPenerima {
  mode?: 'semua' | 'pilih';
  noRkmMedis?: string[];
  windowMode?: 'rolling' | 'followup';
}

export type HasilHapusPenerima =
  | {
      boleh: true;
      /** Daftar no. RM yang tersisa -- pemanggil menyimpannya bersama `mode: 'pilih'`. */
      sisa: string[];
      /**
       * True bila jadwalnya berubah bentuk dari hasil-filter menjadi daftar
       * tetap. WAJIB dikatakan ke staf sebelum ia menekan: sesudahnya jadwal
       * berhenti menjaring pasien baru yang cocok dengan filter yang sama.
       */
      konversi: boolean;
    }
  | { boleh: false; alasan: string };

/**
 * Urutan pemeriksaannya MENGIKAT, dan tiap langkah menutup kegagalan yang
 * berbeda. Dipatok unit test satu per satu.
 */
export function hapusPenerima(input: {
  config: KonfigPenerima;
  /**
   * No. RM yang BENAR-BENAR jadi penerima saat ini, hasil menjalankan ulang
   * segmennya di server. Tidak pernah datang dari klien -- aturan "hasil
   * pratinjau tidak pernah jadi sumber kebenaran" berlaku utuh di sini.
   */
  penerimaSekarang: string[];
  buang: string;
  maxPilihan: number;
}): HasilHapusPenerima {
  const { config, penerimaSekarang, buang, maxPilihan } = input;
  const modePilih = config.mode === 'pilih' && (config.noRkmMedis?.length ?? 0) > 0;

  /**
   * [1] TINDAK LANJUT ditolak, dan ini bukan kehati-hatian berlebih.
   *
   * Daftar tetap dan tindak lanjut saling meniadakan by design
   * (`isFollowupSchedule` mengembalikan false begitu modenya `pilih`), jadi
   * mengubahnya jadi daftar akan DIAM-DIAM mematikan semantik tindak
   * lanjutnya: kunci idempotennya berhenti berkunci pada no. pendaftaran, dan
   * orang yang sama mulai menerima pesan tiap kali jadwal jalan. Lagi pula
   * penerimanya di sana berganti tiap hari -- membuang seseorang dari daftar
   * HARI INI tidak berarti apa-apa besok.
   */
  if (config.windowMode === 'followup' && !modePilih) {
    return {
      boleh: false,
      alasan:
        'Jadwal tindak lanjut menghitung ulang penerimanya tiap hari, jadi tidak ada daftar yang bisa dikurangi -- membuang seseorang hari ini tidak berpengaruh besok. Untuk menghentikan seorang pasien secara permanen, tambahkan nomornya di Daftar tolak.',
    };
  }

  /**
   * [2] Yang tidak ada di daftar tidak bisa dibuang. Menjaga tekan-ganda dan
   * halaman basi: tanpa ini, penekanan kedua melaporkan berhasil sambil
   * menyimpan daftar yang sama -- dan pada jadwal bermode `semua` ia bahkan
   * menulis ulang konversinya, sehingga "berhasil" berarti dua hal berbeda.
   */
  if (!penerimaSekarang.includes(buang)) {
    return {
      boleh: false,
      alasan:
        'Pasien ini sudah tidak ada di daftar penerima jadwal tersebut. Muat ulang halaman untuk melihat daftar yang sekarang.',
    };
  }

  const sisa = penerimaSekarang.filter((rm) => rm !== buang);

  /**
   * [3] PENERIMA TERAKHIR ditolak, dan inilah pemeriksaan yang paling mahal
   * kalau hilang. `isPilihSchedule()` menuntut daftarnya berisi; daftar KOSONG
   * membuatnya mengembalikan false, sehingga jadwalnya jatuh kembali menjadi
   * jadwal berfilter -- yaitu mengirim lagi ke SELURUH orang yang cocok dengan
   * filter aslinya. Membuang orang terakhir akan menghasilkan kebalikan persis
   * dari yang diminta, tanpa satu pun galat.
   */
  if (sisa.length === 0) {
    return {
      boleh: false,
      alasan:
        'Ini penerima terakhir. Jadwal tanpa penerima akan kembali memakai filter aslinya, bukan berhenti mengirim -- jadi jeda atau hapus jadwalnya kalau memang tidak dipakai lagi.',
    };
  }

  /**
   * [4] Segmen yang kelewat besar tidak bisa dibekukan jadi daftar. Batasnya
   * milik bentuk daftar itu sendiri (core/pilihanPasien.ts), dan menyimpan
   * lebih banyak berarti sisanya dipotong DIAM saat dibaca kembali.
   */
  if (!modePilih && penerimaSekarang.length > maxPilihan) {
    return {
      boleh: false,
      alasan: `Jadwal ini menyasar ${penerimaSekarang.length} pasien -- terlalu banyak untuk diubah jadi daftar tetap (batas ${maxPilihan}). Persempit filternya lebih dulu lewat halaman Broadcast terjadwal.`,
    };
  }

  return { boleh: true, sisa, konversi: !modePilih };
}
