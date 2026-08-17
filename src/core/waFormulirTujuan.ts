/**
 * Menyusun pesan yang dikabarkan ke TUJUAN sebuah formulir (053).
 *
 * Murni -- tanpa database, tanpa Sequelize -- justru supaya keputusan yang
 * paling perlu dibuktikan bisa diuji tanpa satu baris data pun: apa yang IKUT
 * dan apa yang TIDAK PERNAH ikut ke sebuah grup WhatsApp.
 *
 * ==========================================================================
 * Kenapa dua mode, dan kenapa bedanya bukan panjang
 * ==========================================================================
 *
 * Isi sebuah jawaban formulir adalah TEKS YANG DIKETIK PASIEN: keluhan, nama
 * obat, apa pun yang kebetulan ditulis orang yang sedang butuh bantuan.
 * Tujuannya sebuah grup yang anggotanya bisa berubah tanpa sepengetahuan
 * siapa pun di sini, dan pesan yang telanjur masuk grup tidak bisa ditarik dari
 * ponsel anggotanya.
 *
 *   `ringkas`  Grup diberi tahu ADA yang masuk dan berapa banyak. Isinya
 *              dibaca di dashboard, tempat aksesnya sudah dijaga login + peran.
 *   `lengkap`  Seluruh pasangan pertanyaan-jawaban ikut, berikut nomor
 *              penanyanya. Dipakai bila grupnya memang unit yang
 *              menindaklanjuti dan RS sudah memutuskan isi itu boleh beredar.
 *
 * ==========================================================================
 * Nomor telepon: SEMUA atau TIDAK SAMA SEKALI -- sengaja tanpa penyamaran
 * ==========================================================================
 *
 * `ringkas` tidak memuat nomor sama sekali, bukan nomor yang disamarkan. Nomor
 * bertopeng tidak menolong siapa pun: staf tetap tidak bisa menghubunginya,
 * sementara awalan dan empat digit terakhirnya tetap beredar. Ia cuma terlihat
 * seperti kehati-hatian.
 *
 * `no_rkm_medis` TIDAK PERNAH ikut, di KEDUA mode, dan ini yang paling mudah
 * ditambahkan tanpa sadar karena kolomnya ada tepat di sebelahnya di
 * `wa_form_entry`. Ia bukan sesuatu yang ditulis pasien melainkan hasil
 * PENAUTAN yang dikerjakan sistem ini (`tautkanPasien()`), dan menyiarkan
 * pasangan nomor-telepon-ke-nomor-rekam-medis ke sebuah grup memberi
 * pembacanya kemampuan yang tidak ia miliki sebelum pesan itu masuk. Dipatok
 * uji tersendiri, di kedua mode.
 */

export type RincianTujuan = 'ringkas' | 'lengkap';

const RINCIAN: readonly string[] = ['ringkas', 'lengkap'];

export function isRincianTujuan(v: string): v is RincianTujuan {
  return RINCIAN.includes(v);
}

/**
 * Nilai dari database yang tidak dikenali jatuh ke `ringkas`, BUKAN `lengkap`.
 *
 * Hanya lahir dari suntingan SQL langsung atau dari kolom yang belum
 * termigrasi. Jatuh ke yang paling sedikit beredar adalah satu-satunya arah
 * yang salahnya bisa diperbaiki: staf yang menerima terlalu sedikit membuka
 * dashboard lalu mengganti setelannya, sementara yang telanjur terlalu banyak
 * tidak bisa menariknya kembali.
 */
export function bacaRincian(v: string | null | undefined): RincianTujuan {
  return v && isRincianTujuan(v) ? v : 'ringkas';
}

export interface JawabanTujuan {
  pertanyaan: string;
  jawaban: string;
}

export interface IsiPemberitahuan {
  formNama: string;
  /** Waktu jawabannya tersimpan. */
  waktu: Date;
  /** E.164 tanpa awalan `+`. null untuk grup, dan untuk nomor yang gagal dipetakan. */
  phoneE164: string | null;
  /** true bila formulirnya diisi dari dalam sebuah grup, bukan japri. */
  dariGrup: boolean;
  /** Pasangan yang sudah DIBEKUKAN di `wa_form_entry.jawaban_json`. */
  jawaban: readonly JawabanTujuan[];
}

/** `dd/MM HH:mm` -- sama dengan yang dipakai daftar Masuk, supaya bisa dicocokkan. */
function waktuSingkat(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Jawaban kosong ditulis `(dilewati)`, bukan dibiarkan kosong.
 *
 * Pertanyaan tak wajib boleh dilewati pasien dengan mengetik "-", dan baris
 * yang berakhir tanpa apa-apa sesudah titik dua terbaca seperti pesan yang
 * terpotong di tengah kirim -- lalu staf mencari sisanya yang tidak pernah ada.
 */
function isiJawaban(teks: string): string {
  const t = teks.trim();
  return t === '' ? '(dilewati)' : t;
}

/**
 * Menyusun satu pesan pemberitahuan.
 *
 * Keluarannya diserahkan apa adanya ke `enqueueMessage()`, yang menempelkan
 * kode pengiriman uniknya sendiri di akhir (`core/uniqueCode.ts`) -- jangan
 * menambahkannya di sini.
 *
 * Sengaja TIDAK memuat frasa berhenti. Penerimanya grup atau nomor petugas
 * yang dipasang admin, bukan pasien; `OPT_OUT_TRIGGERS` karena itu juga tidak
 * memuat pemicunya.
 */
export function susunPemberitahuanFormulir(isi: IsiPemberitahuan, rincian: RincianTujuan): string {
  const kepala = `[Formulir] ${isi.formNama}`;
  const asal = isi.dariGrup ? 'dari sebuah grup' : null;

  if (rincian === 'ringkas') {
    const baris = [
      kepala,
      '',
      `Ada jawaban baru masuk ${waktuSingkat(isi.waktu)}${asal ? ` ${asal}` : ''}.`,
      `${isi.jawaban.length} pertanyaan terisi.`,
      '',
      'Buka menu Formulir di dashboard untuk membacanya.',
    ];
    return baris.join('\n');
  }

  const pengirim = isi.dariGrup
    ? 'sebuah grup'
    : (isi.phoneE164 ?? 'nomor yang tidak terbaca');

  const daftar = isi.jawaban.map(
    (j, i) => `${i + 1}. ${j.pertanyaan}\n   ${isiJawaban(j.jawaban)}`,
  );

  return [
    kepala,
    '',
    `Masuk ${waktuSingkat(isi.waktu)} dari ${pengirim}.`,
    '',
    ...(daftar.length > 0 ? daftar : ['(tidak ada satu pun jawaban tersimpan)']),
  ].join('\n');
}
