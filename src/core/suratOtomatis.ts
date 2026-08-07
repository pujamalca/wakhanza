/**
 * PENGIRIMAN OTOMATIS surat keterangan sakit -- keputusannya, tanpa database.
 *
 * ==========================================================================
 * Kenapa kelas PINDAI, bukan sisip -- dan kenapa itu bukan pilihan bebas
 * ==========================================================================
 *
 * Sepuluh pemicu lain berangkat dari baris yang punya stempel waktu, jadi
 * watermark bekerja: proses sampai T, lain kali mulai dari T. `suratsakit`
 * tidak punya satu pun kolom waktu -- ia hanya berisi `no_surat`, `no_rawat`,
 * dua tanggal istirahat, dan lama sakit. Yang tersedia sebagai penanda urutan
 * cuma `no_surat`, dan tanggal di dalamnya BUKAN tanggal barisnya tersimpan
 * (lihat `khanza/suratPasien.ts` -- diukur: cocok `tanggalawal` 13/18, cocok
 * tanggal kunjungan 15/18, jadi tidak andal keduanya).
 *
 * Watermark di atas nomor yang tidak monoton terhadap urutan penyimpanan akan
 * MELEWATI surat secara permanen, tanpa galat, tanpa baris `outbox`, tanpa
 * satu pun tanda di layar. Itu kelas kegagalan yang paling mahal di proyek ini
 * dan sudah dibayar di prefiks `nobooking`. Karena itu: jendela yang dipindai
 * ulang tiap siklus, dedup murni lewat kunci idempoten -- pola BOOK_CANCEL dan
 * BPJS_BATAL.
 *
 * Fungsi-fungsi di sini sengaja MURNI. Yang paling perlu dibuktikan justru
 * keadaan yang mahal disiapkan di database: pasien tanpa nomor, poli sensitif,
 * jendela yang lebih penuh daripada kuota, dan hari pertama sakelarnya
 * dinyalakan. Unit test satu-satunya jalan yang tidak menuntut mengarang baris
 * `suratsakit` di database rumah sakit.
 */

/**
 * Satu surat berikut DUA hal yang hanya bisa dijawab database, sudah dijawab.
 *
 * Nomornya WAJIB sudah diselesaikan lewat `resolvePhone()`, bukan diambil
 * mentah dari `pasien.no_tlp`. Bedanya bukan halus: koreksi manual yang
 * dimasukkan petugas lewat `/nomor-bermasalah` MENGALAHKAN normalisasi otomatis
 * (F2.1-F2.3), jadi keputusan yang berangkat dari `no_tlp` akan menolak persis
 * pasien yang nomornya sudah dibetulkan -- di rumah sakit ini 40% nomor tidak
 * terpakai, jadi itu bukan kasus pinggiran melainkan alasan halaman koreksi
 * nomor ada. Karena itu bentuknya dipaksa lewat tipe: fungsi ini tidak punya
 * jalan untuk membaca `no_tlp` sendiri walau ia mau.
 */
export interface KandidatSurat<T> {
  baris: T;
  kdPoli: string | null;
  /** Hasil `resolvePhone()`; null berarti tidak ada nomor yang bisa dipakai. */
  phoneE164: string | null;
  /** Nomor ini sudah meminta berhenti kirim otomatis. */
  optOut: boolean;
}

/**
 * Kenapa sebuah surat di dalam jendela tidak jadi dikirim -- dan ketiganya
 * berakibat BERBEDA di sisi pemanggil, jadi jangan digabung:
 *
 *   `poli_sensitif`  tidak dikirim, dan TIDAK menulis baris `outbox` apa pun.
 *                    Menulis barisnya berarti `enqueueMessage` merender template
 *                    generik lalu benar-benar mengirimkannya -- kebalikan dari
 *                    yang diminta. Akibatnya ia dipertimbangkan ulang tiap
 *                    siklus selama masih di dalam jendela; itu murah (satu
 *                    pencarian di himpunan atas baris yang sudah terbaca) dan
 *                    tab Surat sakit sudah menandainya di layar.
 *   `nomor`/`opt_out` DICATAT sebagai baris `outbox` tanpa lampiran. Statusnya
 *                    ditentukan `enqueueMessage` sendiri (`skipped_no_contact` /
 *                    `skipped_opt_out`), jadi ia terlihat di Antrean DAN tersaring
 *                    dari siklus berikutnya lewat kunci idempoten. Tanpa lampiran
 *                    berarti tanpa peluncuran Chromium untuk berkas yang toh tidak
 *                    akan pergi ke mana pun.
 *   `kuota`          BUKAN penolakan sama sekali -- suratnya dikirim siklus
 *                    berikutnya. Tetap dikembalikan supaya masuk = kirim + lewat
 *                    selalu genap; selisih yang tidak tercatat adalah persis cara
 *                    sebuah surat hilang diam-diam.
 */
export type AlasanLewatSurat = 'poli_sensitif' | 'nomor' | 'opt_out' | 'kuota';

export interface LewatSurat<T> {
  kandidat: KandidatSurat<T>;
  alasan: AlasanLewatSurat;
}

export interface KeputusanSuratOtomatis<T> {
  kirim: Array<KandidatSurat<T>>;
  lewat: Array<LewatSurat<T>>;
}

export interface OpsiSuratOtomatis {
  /** Kode poli yang ditandai sensitif (F4.3). */
  poliSensitif: Iterable<string>;
  /** Berapa banyak yang boleh dikirim satu siklus. <= 0 berarti tidak ada yang dikirim. */
  kuota: number;
}

/**
 * Membagi jendela jadi yang dikirim dan yang tidak.
 *
 * URUTAN pemeriksaannya mengikat, dan alasannya sama dengan urutan di aksi
 * kirim manual: yang paling sering gagal diperiksa paling awal supaya tidak ada
 * PDF yang telanjur dirender untuk surat yang tidak akan pergi ke mana pun.
 * Kuota diperiksa PALING AKHIR justru karena ia bukan penolakan -- menghitung
 * surat yang toh ditolak sebagai pemakai jatah akan membuat satu pasien poli
 * sensitif di depan antrean menunda surat pasien lain tanpa sebab yang bisa
 * dilihat siapa pun.
 *
 * Poli sensitif MENOLAK, bukan diganti template generik. Alasannya sama persis
 * dengan jalur manual (`administrasi/actions.ts`): yang menyertai pesan adalah
 * BERKAS berisi identitas lengkap, jadi mengganti kalimat pengantarnya tidak
 * menyembunyikan apa pun selama lampirannya tetap ikut.
 */
export function putuskanSuratOtomatis<T>(
  kandidat: Array<KandidatSurat<T>>,
  opsi: OpsiSuratOtomatis,
): KeputusanSuratOtomatis<T> {
  const sensitif = new Set(opsi.poliSensitif);
  const kirim: Array<KandidatSurat<T>> = [];
  const lewat: Array<LewatSurat<T>> = [];

  for (const k of kandidat) {
    if (k.kdPoli && sensitif.has(k.kdPoli)) {
      lewat.push({ kandidat: k, alasan: 'poli_sensitif' });
      continue;
    }
    if (!k.phoneE164) {
      lewat.push({ kandidat: k, alasan: 'nomor' });
      continue;
    }
    if (k.optOut) {
      lewat.push({ kandidat: k, alasan: 'opt_out' });
      continue;
    }
    if (kirim.length >= Math.max(0, opsi.kuota)) {
      lewat.push({ kandidat: k, alasan: 'kuota' });
      continue;
    }
    kirim.push(k);
  }

  return { kirim, lewat };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface JendelaSurat {
  dari: string;
  sampai: string;
}

/**
 * Jendela tanggal yang dipindai, dan ia merentang KE DUA ARAH dari hari ini.
 *
 * Arah MAJU bukan kehati-hatian: nomor surat dirakit Khanza dari kotak "tanggal
 * awal", jadi surat yang ditulis hari ini untuk istirahat mulai pekan depan
 * bernomor lebih BESAR daripada prefiks hari ini. Batas atas yang berhenti di
 * hari ini akan membuang persis surat-surat itu -- dan diukur di database ini,
 * `tanggalawal` mendahului kunjungan sampai 6 hari.
 *
 * Arah MUNDUR ada untuk surat yang tanggal awalnya digeser ke belakang, dan
 * untuk memberi kesempatan kedua pada siklus yang gagal (worker mati, MariaDB
 * terkunci) tanpa perlu mekanisme percobaan ulang tersendiri.
 *
 * `sejak` adalah LANTAINYA, dan ia yang mencegah "hari pertama mengirim seluruh
 * arsip". Tanpa itu, menyalakan sakelarnya berarti setiap surat di dalam
 * jendela -- termasuk milik pasien yang sudah pulang seminggu lalu -- langsung
 * jadi berkas WhatsApp. Pelajaran yang sama dengan `LAB_REQUEST`, yang
 * bawaannya nonaktif justru supaya pemicu yang baru menyala tidak mengirim
 * sebulan penuh sekaligus.
 *
 * Konsekuensi yang HARUS disadari: surat yang nomornya bertanggal sebelum hari
 * sakelarnya dinyalakan tidak pernah terkirim otomatis, selamanya. Itu memang
 * yang diinginkan untuk arsip, tapi ia juga menjaring surat yang ditulis hari
 * ini untuk istirahat yang sudah dimulai kemarin. Jalur manual di tab Surat
 * sakit adalah pemulihnya, dan halaman Pengaturan mengatakan ini di depan staf.
 */
export function jendelaSuratOtomatis(hariIni: Date, lookbackHari: number, sejak: string | null): JendelaSurat {
  const mundur = new Date(hariIni);
  mundur.setDate(mundur.getDate() - Math.max(0, lookbackHari));
  const maju = new Date(hariIni);
  maju.setDate(maju.getDate() + Math.max(0, lookbackHari));

  const bawah = iso(mundur);
  // Lantai aktivasi menang bila ia lebih baru. Perbandingan string aman karena
  // keduanya `YYYY-MM-DD` berlebar tetap.
  const dari = sejak && sejak > bawah ? sejak : bawah;
  return { dari, sampai: iso(maju) };
}
