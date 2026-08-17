/**
 * Menggabungkan pesan MASUK dan pesan KELUAR menjadi satu lini masa percakapan.
 *
 * Fungsi murni dan terpisah karena keduanya datang dari DUA TABEL yang berbeda
 * bentuk dan berbeda masa simpan (`inbound_message` 30 hari, `outbox` 90 hari),
 * dan satu-satunya hal yang menyatukannya adalah waktu. Menggabungkannya di
 * dalam komponen berarti aturan urutannya tidak bisa diuji tanpa database dan
 * tanpa peramban -- padahal justru urutannya yang paling gampang salah dan
 * paling langsung terlihat pemakainya.
 */

/**
 * Batas panjang satu balasan manual: cukup lebar untuk balasan panjang, cukup
 * sempit untuk menahan tempelan tak sengaja.
 *
 * Tinggal DI SINI dan bukan di `pesan-masuk/actions.ts` karena berkas itu
 * ber-`'use server'`, dan berkas semacam itu hanya boleh mengekspor fungsi
 * async. Konstanta di sana lolos `tsc` DAN lolos `eslint`, lalu menjatuhkan
 * `next build` dengan "The export ... was not found in module" -- keluarga
 * jebakan yang sama dengan `export type` yang sudah dibayar di
 * `administrasi/actions.ts`, hanya bergejala pada tahap yang berbeda.
 */
export const MAX_PANJANG_BALASAN = 4096;

export type ArahPesan = 'masuk' | 'keluar';

/**
 * Satu baris `inbound_message` -- KEDUA arahnya.
 *
 * Dulu bernama `PesanMasukRingkas` dan memang hanya memuat yang masuk, karena
 * sisi keluar diandaikan selalu berasal dari `outbox`. Andaian itu salah: yang
 * benar-benar dipakai rumah sakit ini adalah membalas dari aplikasi WhatsApp di
 * ponsel, dan pesan itu tidak pernah melewati antrean kirim (migrations/052).
 *
 * **Arahnya dibawa BARIS, bukan diserahkan lewat larik ketiga.** Bentuk yang
 * satunya -- `gabungPercakapan(masuk, keluar, manual)` -- membuat pemanggil yang
 * lupa mengisi larik ketiga tetap lolos `tsc` dan tetap menampilkan percakapan
 * sebelah, yaitu persis cacat yang sedang diperbaiki.
 */
export interface PesanCatatanRingkas {
  id: number;
  arah: ArahPesan;
  waktu: Date;
  teks: string | null;
  /** Dipakai saat `teks` null: jenis media, atau "isi tidak disimpan". */
  keterangan: string | null;
  /** Hanya untuk yang MASUK dari grup; balasan petugas tidak punya nama pengirim. */
  namaPengirim: string | null;
}

export interface PesanKeluarRingkas {
  id: number;
  /** Kapan barisnya MASUK ANTREAN -- lihat catatan urutan di bawah. */
  waktu: Date;
  teks: string;
  status: string;
  /** Kapan benar-benar terkirim; null selama masih menunggu. */
  terkirimAt: Date | null;
  ackLevel: number | null;
  /** Kode pemicunya, supaya balasan petugas bisa dibedakan dari notifikasi otomatis. */
  triggerCode: string;
}

export interface BarisPercakapan {
  kunci: string;
  arah: ArahPesan;
  waktu: Date;
  teks: string | null;
  keterangan: string | null;
  namaPengirim: string | null;
  status: string | null;
  terkirimAt: Date | null;
  ackLevel: number | null;
  triggerCode: string | null;
}

/**
 * Urut NAIK: yang paling lama di atas, yang terbaru di bawah -- bentuk yang
 * sudah dikenal semua orang dari aplikasi percakapan mana pun. Kotak balasannya
 * ada di bawah, jadi yang baru dikirim muncul tepat di atasnya tanpa perlu
 * menggulir.
 *
 * ==========================================================================
 * Dua keputusan yang gampang dikira sepele
 * ==========================================================================
 *
 * 1. **Yang mengurutkan pesan keluar adalah waktu MASUK ANTREAN, bukan waktu
 *    terkirim.** Keduanya bisa berjarak jam: pesan yang tertahan jam tenang
 *    pukul 22:00 baru berangkat pukul 07:00. Diurutkan menurut waktu kirim,
 *    balasan yang diketik petugas semalam melompat ke bawah pesan pasien yang
 *    datang subuh -- percakapan yang urutannya tidak lagi mencerminkan siapa
 *    membalas siapa. Waktu terkirim tetap DIBAWA (`terkirimAt`) untuk
 *    ditampilkan; ia cuma tidak menentukan tempatnya.
 *
 * 2. **Urutannya STABIL saat waktunya seri.** Dua baris pada detik yang sama
 *    tidak boleh bertukar tempat antar render -- `Array.prototype.sort` memang
 *    stabil sejak ES2019, tapi kestabilan itu berlaku terhadap urutan MASUKAN,
 *    dan di sini masukannya dua larik terpisah yang baru digabung. Karena itu
 *    seri diputus lewat kunci, bukan dibiarkan bergantung pada urutan
 *    penggabungan.
 *
 * 3. **Awalan kunci mengikuti TABEL asalnya (`cat-`/`out-`), bukan arahnya.**
 *    Yang menjamin sebuah id unik adalah tabelnya; dua tabel dengan urutan id
 *    yang berdiri sendiri bisa memberi angka yang sama, dan kunci React yang
 *    bertabrakan membuat satu gelembung hilang dari layar tanpa satu pun galat.
 *    Balasan manual dan pesan masuk sama-sama ber-awalan `cat-` justru karena
 *    keduanya baris `inbound_message`.
 */
export function gabungPercakapan(
  catatan: PesanCatatanRingkas[],
  keluar: PesanKeluarRingkas[],
): BarisPercakapan[] {
  const baris: BarisPercakapan[] = [
    ...catatan.map((m) => ({
      kunci: `cat-${m.id}`,
      arah: m.arah,
      waktu: m.waktu,
      teks: m.teks,
      keterangan: m.keterangan,
      namaPengirim: m.namaPengirim,
      status: null,
      terkirimAt: null,
      ackLevel: null,
      triggerCode: null,
    })),
    ...keluar.map((k) => ({
      kunci: `out-${k.id}`,
      arah: 'keluar' as const,
      waktu: k.waktu,
      teks: k.teks,
      keterangan: null,
      namaPengirim: null,
      status: k.status,
      terkirimAt: k.terkirimAt,
      ackLevel: k.ackLevel,
      triggerCode: k.triggerCode,
    })),
  ];

  return baris.sort((a, b) => {
    const selisih = a.waktu.getTime() - b.waktu.getTime();
    if (selisih !== 0) return selisih;
    return a.kunci < b.kunci ? -1 : a.kunci > b.kunci ? 1 : 0;
  });
}
