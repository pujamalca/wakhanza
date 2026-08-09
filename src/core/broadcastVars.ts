import type { TemplateVariable } from './template';
import { isianSurat, formatTanggalSurat } from './suratDoc';

/**
 * Pemetaan satu baris segmen pasien -> variabel template BROADCAST.
 *
 * Berkas ini ada karena pemetaan yang sama sebelumnya ditulis EMPAT KALI:
 * kirim manual (`broadcast/actions.ts`), kirim terjadwal
 * (`worker/broadcastScheduleRunner.ts`), dan dua pratinjau (`broadcast/page.tsx`,
 * `broadcast-terjadwal/page.tsx`). Keempatnya kebetulan sepakat selama isinya
 * cuma dua kolom; menambah variabel kelima adalah persis saat kesepakatan itu
 * pecah -- dan yang paling mungkin tertinggal adalah PRATINJAUNYA, karena ia
 * satu-satunya yang tidak mengirim apa pun sehingga kesalahannya tidak
 * menghasilkan gejala. Staf lalu melihat variabel yang dirender kosong,
 * menyimpulkan variabelnya tidak jalan, dan membuangnya dari pesan yang
 * sebenarnya sudah benar.
 *
 * Pelajaran yang sama persis sudah dibayar di `worker/triggerVars.ts` saat
 * `{cara_bayar}` ditambahkan: "sisi worker terisi, sisi dryrun kosong".
 *
 * MURNI -- tanpa database, tanpa `khanza/`. Masukannya dibentuk struktural
 * (`BarisSegmen`, `IdentitasBroadcast`) alih-alih mengimpor `PatientSegmentRow`
 * dan `HospitalIdentity`, supaya modul ini tetap bisa diuji unit tanpa MariaDB
 * hidup. Kedua tipe aslinya memenuhi bentuk ini apa adanya.
 */

/** Bagian `PatientSegmentRow` yang benar-benar dibaca di sini -- sengaja tidak lebih. */
export interface BarisSegmen {
  no_rkm_medis: string;
  nm_pasien: string | null;
  nm_kab: string | null;
  nm_kec: string | null;
  nm_kel: string | null;
  tgl_kunjungan_terakhir: string | null;
}

/** Bentuk struktural `HospitalIdentity`. */
export interface IdentitasBroadcast {
  namaRs: string;
  alamatRs: string;
  kontakRs: string;
}

export function broadcastVars(
  row: BarisSegmen,
  identity: IdentitasBroadcast,
): Partial<Record<TemplateVariable, string>> {
  return {
    nama_rs: identity.namaRs,
    alamat_rs: identity.alamatRs,
    kontak_rs: identity.kontakRs,
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,

    /**
     * Tanggal KUNJUNGAN yang jadi dasar segmen ini -- bukan "kunjungan terakhir
     * pasien" dan bukan tanggal pesannya dikirim.
     *
     * Namanya sengaja `{tanggal_kunjungan}`, bukan `{tanggal_kunjungan_terakhir}`:
     * baris segmen dipilih lewat `MAX(no_rawat)` DI DALAM rentang tanggal yang
     * disetel staf, jadi pada rentang yang batas atasnya di masa lalu ia adalah
     * kunjungan terakhir DALAM RENTANG ITU, bukan kunjungan terakhir pasien.
     * Nama yang menjanjikan "terakhir" akan berbohong pada persis pemakaian yang
     * paling masuk akal untuk fitur ini (menyasar pasien yang lama tidak datang).
     *
     * `formatTanggalSurat`, bukan `Date` -- nilainya string apa adanya dari
     * MariaDB (`dateStrings: true`), dan mengubahnya jadi `Date` lebih dulu
     * membuka jalan pergeseran zona waktu yang menggeser tanggalnya sehari.
     * `'0000-00-00'` menghasilkan string kosong, bukan "Invalid Date".
     */
    tanggal_kunjungan: formatTanggalSurat(row.tgl_kunjungan_terakhir),

    /**
     * Wilayah pasien, dan ketiganya WAJIB lewat `isianSurat()`.
     *
     * Khanza memakai NAMA TABELNYA sendiri sebagai isian bawaan --
     * `kelurahan.nm_kel = 'KELURAHAN'` pada 4.332 dari 4.873 pasien di mesin
     * ini (89%). Diteruskan apa adanya, pesan broadcast berbunyi "Warga
     * KECAMATAN," untuk hampir semua orang: bukan sekadar jelek, melainkan
     * terbaca sebagai sistem rusak sehingga kalimat lain di pesan yang sama
     * ikut tidak dipercaya.
     *
     * Dibersihkan lewat `isianSurat()` yang SUDAH ADA, dengan penanda yang sama
     * persis dipakai `rakitAlamat()` -- bukan menyalin daftar penandanya ke
     * tempat kesekian. Daftar itu tumbuh dari pengamatan atas data Khanza
     * sungguhan, dan salinan yang tidak ikut diperbarui saat penanda berikutnya
     * ditemukan adalah salinan yang diam-diam salah.
     *
     * Yang kosong dirender jadi string kosong, sama seperti variabel lain yang
     * tidak terisi -- staf yang menulis "Warga {kecamatan}" wajib menyadari
     * kemungkinan itu, dan halamannya mengatakannya.
     */
    kelurahan: isianSurat(row.nm_kel, 'kelurahan', 'desa'),
    kecamatan: isianSurat(row.nm_kec, 'kecamatan'),
    kabupaten: isianSurat(row.nm_kab, 'kabupaten', 'kota'),
  };
}
