/**
 * Aritmetika pengingat surat kontrol BPJS -- fungsi murni, tanpa database dan
 * tanpa WhatsApp.
 *
 * Dipisah ke `core/` dengan alasan yang sama seperti `core/schedule.ts`: yang
 * paling perlu dibuktikan di sini adalah perilaku di sekitar batas (pergantian
 * bulan, tahun kabisat, daftar yang salah ketik), dan membuktikannya lewat
 * database berarti menunggu tanggal-tanggal itu benar-benar tiba.
 */

/** Selisih hari terjauh yang boleh disetel. */
export const MAX_HARI_SEBELUM = 90;

/**
 * Baca daftar "berapa hari sebelum" dari satu baris teks pengaturan ("7,1").
 *
 * Aturan yang menempel, dan semuanya karena nilainya diketik manusia di kotak
 * teks -- bukan dipilih dari daftar:
 *
 * - **Yang tidak berbentuk angka DIBUANG, bukan menggagalkan seluruhnya.** Satu
 *   koma berlebih ("7,1,") tidak boleh mematikan pengingat yang sisanya benar.
 *   Yang memeriksa kewarasan isiannya adalah server action saat MENYIMPAN, di
 *   depan orang yang bisa memperbaikinya; di sini, saat worker berjalan tengah
 *   hari, tidak ada siapa-siapa untuk diberi tahu.
 * - **Ganda dibuang.** "1,1" bukan permintaan mengirim dua pesan identik; kunci
 *   idempoten toh akan menolak yang kedua, jadi menyisakannya cuma membuat
 *   angka "berapa yang dikirim" berbohong.
 * - **Diurutkan MENURUN** (terjauh dulu). Bukan kosmetik: pratinjau di halaman
 *   membacakan urutannya apa adanya, dan "H-1 lalu H-7" terbaca seperti
 *   pengingatnya mundur ke belakang.
 * - **0 SAH dan berarti hari-H.** Bukan nilai kosong. Sebagian poli memang
 *   ingin mengingatkan pagi hari di hari kontrolnya.
 */
export function bacaHariSebelum(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const hasil = new Set<number>();
  for (const bagian of raw.split(',')) {
    const teks = bagian.trim();
    if (!teks) continue;
    // Number('') = 0 dan Number(' 1 ') = 1, jadi teks kosong sudah disaring di
    // atas. Angka pecahan ditolak: "1,5 hari sebelum" tidak punya arti pada
    // jadwal yang butirnya hari kalender.
    if (!/^\d+$/.test(teks)) continue;
    const n = Number(teks);
    if (n > MAX_HARI_SEBELUM) continue;
    hasil.add(n);
  }
  return [...hasil].sort((a, b) => b - a);
}

/** Bentuk normal untuk disimpan kembali ke pengaturan. */
export function tulisHariSebelum(hari: number[]): string {
  return hari.join(',');
}

/** Tanggal lokal sebagai YYYY-MM-DD -- sengaja komponen LOKAL, bukan UTC. */
export function tanggalLokal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface SasaranKontrol {
  /** Tanggal rencana kontrol yang dicari di `sik` (YYYY-MM-DD). */
  tanggal: string;
  /** Berapa hari sebelum tanggal itu pengingatnya dikirim. */
  hariSebelum: number;
}

/**
 * Terjemahkan daftar "H-N" menjadi tanggal rencana yang harus dicari HARI INI.
 *
 * Arah perhitungannya gampang terbalik, dan terbaliknya tidak menghasilkan
 * galat apa pun -- cuma pengingat yang dikirim untuk kontrol yang sudah lewat.
 * Yang benar: pengingat H-7 yang dikirim hari ini menyangkut kontrol tanggal
 * `hari ini + 7`, jadi tanggalnya MAJU.
 *
 * `setDate` dipakai apa adanya (bukan aritmetika milidetik) supaya pergantian
 * bulan, tahun, dan tahun kabisat ditangani peramban/Node, bukan oleh kita.
 */
export function sasaranKontrol(hariSebelum: number[], hariIni: Date): SasaranKontrol[] {
  return hariSebelum.map((n) => {
    const d = new Date(hariIni);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return { tanggal: tanggalLokal(d), hariSebelum: n };
  });
}

/**
 * Kalimat yang dibaca pasien untuk `{sisa_hari}`.
 *
 * "0 hari lagi" adalah bentuk yang benar secara aritmetika dan salah secara
 * bahasa -- pasien membacanya sebagai kesalahan sistem, bukan sebagai "hari
 * ini". Dua nilai pertama karena itu punya katanya sendiri.
 */
export function labelSisaHari(hariSebelum: number): string {
  if (hariSebelum <= 0) return 'hari ini';
  if (hariSebelum === 1) return 'besok';
  return `${hariSebelum} hari lagi`;
}

/**
 * Apakah pengingat harian sudah waktunya jalan.
 *
 * `penandaTerakhir` adalah tanggal lokal (YYYY-MM-DD) saat terakhir jalan.
 * Dibandingkan sebagai TEKS, bukan Date: yang perlu dijawab cuma "apakah ini
 * hari yang sama", dan perbandingan teks tidak bisa meleset tujuh jam karena
 * kolom DATETIME menyimpan UTC (lihat catatan zona waktu di CLAUDE.md).
 *
 * Penanda yang menunjuk MASA DEPAN (jam server sempat maju lalu dikoreksi)
 * diperlakukan sebagai belum jalan hari ini -- kalau tidak, satu kekeliruan jam
 * bisa mendiamkan pengingat sampai tanggal itu benar-benar tiba, dan itu bisa
 * berhari-hari tanpa satu pun tanda.
 */
export function jatuhTempoHarian(sekarang: Date, jamKirim: number, penandaTerakhir: string | null): boolean {
  if (sekarang.getHours() < jamKirim) return false;
  const hariIni = tanggalLokal(sekarang);
  if (!penandaTerakhir) return true;
  return penandaTerakhir !== hariIni;
}
