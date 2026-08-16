/**
 * FORMULIR LEWAT WHATSAPP -- pencocokan kata kunci dan seluruh mesin keadaan
 * pengisiannya.
 *
 * Berkas ini MURNI: tanpa database, tanpa WhatsApp, tanpa jam. Pola yang sama
 * sudah dibayar di `core/waCommand.ts`, `core/autoReply.ts`, dan
 * `core/suratOtomatis.ts` -- ia yang membuat seluruh alur bisa diuji tanpa
 * MariaDB hidup, dan yang membuat kotak uji di dashboard mustahil menyimpang
 * dari worker.
 *
 * Yang TIDAK ada di sini, dan sengaja: kuota, sesi, penulisan `wa_form_entry`,
 * dan pengiriman. Keempatnya milik `worker/formulirReply.ts`.
 */

import { matchRule, normalizeInbound, type MatchMode, type MatchableRule } from './autoReply';

// ---------------------------------------------------------------------------
// Bentuk
// ---------------------------------------------------------------------------

export type TipeField = 'teks' | 'angka' | 'pilihan';

const SEMUA_TIPE: ReadonlySet<string> = new Set<TipeField>(['teks', 'angka', 'pilihan']);

/**
 * Baris `wa_form_field` bisa disunting langsung lewat `mysql`, dan tipe yang
 * tidak dikenal tidak boleh menjatuhkan penanganan pesan masuk. Pola yang sama
 * dengan `isLangkah()` dan `parseKeywords()`.
 */
export function isTipeField(nilai: string): nilai is TipeField {
  return SEMUA_TIPE.has(nilai);
}

export interface FieldFormulir {
  id: number;
  /** Pertanyaannya sebagaimana dibaca pasien, dan label yang dibekukan ke jawabannya. */
  label: string;
  tipe: TipeField;
  wajib: boolean;
  /** Hanya berarti untuk `tipe: 'pilihan'`. */
  pilihan: string[];
  /** 0 = pakai `MAKS_JAWABAN`. */
  maksPanjang: number;
}

export interface RingkasanFormulir extends MatchableRule {
  id: number;
  nama: string;
  keywords: string[];
  matchMode: MatchMode;
  priority: number;
  pesanPembuka: string;
  pesanPenutup: string;
  fields: FieldFormulir[];
}

/** Satu pasang pertanyaan-jawaban sebagaimana DIBEKUKAN saat pasien menjawabnya. */
export interface JawabanTerisi {
  pertanyaan: string;
  jawaban: string;
}

/**
 * Keadaan satu pengisian yang sedang berjalan.
 *
 * `pertanyaan` dan `penutup` DIBEKUKAN saat percakapan dimulai, bukan dibaca
 * ulang tiap langkah, dan itu keputusan yang menentukan seluruh bentuk berkas
 * ini -- `lanjutkanFormulir()` karena itu tidak menerima `RingkasanFormulir`
 * sama sekali.
 *
 * Sebabnya: staf boleh menyunting formulir kapan saja dari dashboard, termasuk
 * di sela dua pesan pasien. Tanpa pembekuan, menyisipkan satu pertanyaan di
 * tengah akan menggeser SELURUH indeks sesudahnya -- pasien yang sedang di
 * pertanyaan ke-3 tiba-tiba menjawab pertanyaan ke-2 lagi, atau melompati satu
 * yang tidak pernah ditanyakan. Yang muncul bukan galat melainkan catatan yang
 * jawabannya berpasangan dengan pertanyaan yang salah, dan catatan itu yang
 * dipakai staf untuk bertindak.
 *
 * Pelajaran yang sama dengan `DataWizard.pilihan` di 045 dan dengan
 * `broadcast_campaign.message_body` yang menyimpan SALINAN alih-alih mengacu
 * templatenya.
 */
export interface KeadaanFormulir {
  formId: number;
  nama: string;
  penutup: string;
  /** Indeks pertanyaan yang SEDANG menunggu jawaban. */
  indeks: number;
  pertanyaan: FieldFormulir[];
  jawaban: JawabanTerisi[];
}

export type HasilFormulir =
  /** Jawaban diterima, pertanyaan berikutnya dikirim. */
  | { aksi: 'tanya'; keadaan: KeadaanFormulir; balasan: string }
  /** Jawaban tidak sah: keadaan TIDAK maju, pertanyaannya diulang berikut sebabnya. */
  | { aksi: 'ulangi'; keadaan: KeadaanFormulir; balasan: string }
  /** Pasien membatalkan. Tidak ada yang disimpan. */
  | { aksi: 'batal'; balasan: string }
  /** Pertanyaan terakhir terjawab. `simpan` adalah baris yang harus ditulis. */
  | {
      aksi: 'selesai';
      balasan: string;
      simpan: { formId: number; nama: string; jawaban: JawabanTerisi[] };
    };

// ---------------------------------------------------------------------------
// Batas yang ditegakkan
// ---------------------------------------------------------------------------

/**
 * Batas bawaan panjang satu jawaban. `wa_form_entry.jawaban_json` bertipe TEXT
 * (64 KB) dan yang membatasi di sini bukan kolomnya melainkan dua hal lain:
 * pesan WhatsApp yang mengulang jawabannya kembali harus tetap muat, dan staf
 * yang membaca daftar masuk harus bisa memindainya. Bisa dinaikkan per
 * pertanyaan lewat `maksPanjang`.
 */
export const MAKS_JAWABAN = 500;

/** Sengaja jauh di atas jumlah yang wajar; ia menjaga salah setel, bukan mengatur gaya. */
export const MAKS_PERTANYAAN = 20;

/**
 * Kata yang membatalkan pengisian. Dicocokkan pada SELURUH pesan, bukan sebagai
 * bagian kalimat: jawaban yang sah bisa saja memuat kata "batal" ("obat saya
 * batal diambil kemarin"), dan membuang tiga pertanyaan yang sudah diisi karena
 * satu kata di tengah kalimat jauh lebih merugikan daripada pasien yang harus
 * mengetik "batal" sendirian.
 */
const KATA_BATAL: ReadonlySet<string> = new Set(['batal', 'batalkan', 'berhenti isi', 'cancel']);

/**
 * Jawaban untuk melewati pertanyaan yang tidak wajib.
 *
 * String KOSONG adalah anggota yang paling penting di sini, dan ia ditemukan
 * uji bukan dirancang: `normalizeInbound()` mengubah setiap karakter
 * non-alfanumerik jadi spasi lalu memangkasnya, jadi tanda `-` yang justru
 * dianjurkan halaman ini menjadi `''` dan tidak akan pernah cocok kalau yang
 * didaftarkan tanda hubungnya. Dengan `''` sebagai anggota, ia sekaligus
 * menjaring pesan yang seluruhnya tanda baca atau emoji -- yang memang bukan
 * jawaban apa pun.
 */
const KATA_LEWATI: ReadonlySet<string> = new Set(['', 'lewati', 'skip', 'tidak ada', 'tidak', 'kosong']);

/** Selalu ditutup begini supaya jalan keluarnya terlihat di setiap langkah. */
const JALAN_KELUAR = '\n\n_Ketik *batal* untuk berhenti mengisi._';

// ---------------------------------------------------------------------------
// Pencocokan
// ---------------------------------------------------------------------------

/**
 * Formulir mana yang dipicu sebuah pesan, atau null.
 *
 * Memakai `matchRule()` yang SAMA dipakai balasan otomatis -- kata utuh, mode
 * contains/exact, urutan `priority`. Penurunan kedua atas "kapan sebuah pesan
 * dianggap cocok" berarti kotak uji dashboard dan worker bisa menyimpang, dan
 * yang menyimpang selalu yang tidak mengirim apa-apa sehingga kesalahannya
 * tidak bergejala.
 *
 * Efek sampingnya yang paling berguna: `/request-obat` dan `request obat`
 * melewati kode yang sama persis, karena `normalizeInbound()` mengubah setiap
 * karakter non-alfanumerik jadi spasi -- garis miringnya musnah di kedua sisi.
 * Bentuk bergaris miring jadi KEBIASAAN yang boleh dipilih staf, bukan cabang
 * kode tersendiri.
 *
 * Formulir yang tidak akan pernah menjawab disaring lebih dulu -- lihat
 * `formulirYangMenjawab()`.
 */
export function cocokFormulir(
  teks: string,
  daftar: readonly RingkasanFormulir[],
): RingkasanFormulir | null {
  return matchRule(teks, formulirYangMenjawab(daftar))?.rule ?? null;
}

/**
 * Dari sekumpulan formulir aktif, yang BENAR-BENAR bisa menjawab.
 *
 * Dua keadaan digugurkan, keduanya salah setel yang ditolak dashboard saat
 * disimpan sehingga hanya lahir dari suntingan SQL langsung:
 *
 *   * **tanpa pertanyaan** -- memulai percakapan yang pertanyaan pertamanya
 *     tidak ada akan menggantungkan pasien pada sesi yang tidak bisa dimajukan
 *     apa pun;
 *   * **tanpa kata kunci** -- `matchRule()` melewati kata kunci kosong, jadi
 *     tidak ada satu pun pesan yang bisa menjaringnya.
 *
 * Berdiri sendiri, bukan tinggal di dalam `cocokFormulir()`, karena `/bantuan`
 * lewat WhatsApp menyebutkan formulir mana yang bisa diisi dari sebuah alamat.
 * Penurunan KEDUA atas "formulir mana yang akan menjawab" berarti bantuan bisa
 * menyuruh seseorang mengetik kata kunci yang tidak pernah dijaring apa pun --
 * kelas kegagalan termahal di proyek ini: orangnya mengetik apa yang disuruh,
 * tidak terjadi apa-apa, dan tidak ada satu pun galat yang menyebut sebabnya.
 *
 * Untuk pencocokan ini nol-perubahan-perilaku: keduanya memang sudah tidak
 * pernah cocok.
 */
export function formulirYangMenjawab(
  daftar: readonly RingkasanFormulir[],
): RingkasanFormulir[] {
  return daftar.filter((f) => f.fields.length > 0 && f.keywords.some((k) => k.trim() !== ''));
}

/** true bila pesan ini adalah permintaan membatalkan pengisian. */
export function mintaBatal(teks: string): boolean {
  return KATA_BATAL.has(normalizeInbound(teks));
}

// ---------------------------------------------------------------------------
// Mesin keadaan
// ---------------------------------------------------------------------------

function nomorLangkah(keadaan: KeadaanFormulir): string {
  return `*Pertanyaan ${keadaan.indeks + 1} dari ${keadaan.pertanyaan.length}*`;
}

/** Teks satu pertanyaan berikut pilihannya dan keterangan boleh-dilewati. */
function tanyakan(keadaan: KeadaanFormulir): string {
  const f = keadaan.pertanyaan[keadaan.indeks]!;
  const bagian = [`${nomorLangkah(keadaan)}\n${f.label}`];

  if (f.tipe === 'pilihan' && f.pilihan.length > 0) {
    bagian.push(f.pilihan.map((p, i) => `${i + 1}. ${p}`).join('\n'));
    bagian.push('_Balas dengan nomor atau tulis pilihannya._');
  }
  if (!f.wajib) {
    bagian.push('_Boleh dikosongkan — ketik *-* untuk melewati._');
  }
  return bagian.join('\n\n');
}

/**
 * Memulai pengisian. Membekukan daftar pertanyaan dan kalimat penutupnya ke
 * dalam keadaan -- lihat `KeadaanFormulir`.
 *
 * Formulir tanpa pertanyaan tidak pernah sampai ke sini (`cocokFormulir()`
 * menyaringnya), tapi tetap dijaga: yang memanggil bisa saja jalur lain kelak,
 * dan mengembalikan `batal` lebih baik daripada melempar di dalam pendengar
 * event WhatsApp.
 */
export function mulaiFormulir(form: RingkasanFormulir): HasilFormulir {
  if (form.fields.length === 0) {
    return { aksi: 'batal', balasan: '' };
  }

  const keadaan: KeadaanFormulir = {
    formId: form.id,
    nama: form.nama,
    penutup: form.pesanPenutup,
    indeks: 0,
    pertanyaan: form.fields.slice(0, MAKS_PERTANYAAN),
    jawaban: [],
  };

  const pembuka = form.pesanPembuka.trim();
  const kepala = pembuka ? `${pembuka}\n\n` : `*${form.nama}*\n\n`;
  return { aksi: 'tanya', keadaan, balasan: `${kepala}${tanyakan(keadaan)}${JALAN_KELUAR}` };
}

/**
 * Satu langkah pengisian. TIDAK pernah melempar: masukan yang tidak sah
 * menghasilkan `ulangi` berikut sebabnya, bukan galat -- yang mengetiknya orang,
 * dan satu salah ketik tidak boleh membuang jawaban yang sudah diisi.
 *
 * Sengaja TIDAK menerima `RingkasanFormulir`: seluruh yang dibutuhkannya sudah
 * dibekukan di `keadaan`, dan itulah yang membuat suntingan staf di tengah
 * percakapan mustahil menggeser pertanyaan yang sedang dijawab pasien.
 */
export function lanjutkanFormulir(keadaan: KeadaanFormulir, masukanMentah: string): HasilFormulir {
  const masukan = masukanMentah.trim();

  if (mintaBatal(masukan)) {
    return {
      aksi: 'batal',
      balasan: `Pengisian *${keadaan.nama}* dibatalkan. Tidak ada yang disimpan.`,
    };
  }

  // Keadaan yang cuma lahir dari suntingan SQL langsung atau dari versi kode
  // yang berbeda. Menyimpan apa adanya lebih baik daripada menggantung: yang
  // sudah diisi pasien tetap sampai ke staf.
  const field = keadaan.pertanyaan[keadaan.indeks];
  if (!field) return selesaikan(keadaan);

  const nilai = periksaJawaban(field, masukan);
  if ('galat' in nilai) {
    return { aksi: 'ulangi', keadaan, balasan: `${nilai.galat}\n\n${tanyakan(keadaan)}${JALAN_KELUAR}` };
  }

  const berikut: KeadaanFormulir = {
    ...keadaan,
    indeks: keadaan.indeks + 1,
    jawaban: [...keadaan.jawaban, { pertanyaan: field.label, jawaban: nilai.nilai }],
  };

  if (berikut.indeks >= berikut.pertanyaan.length) return selesaikan(berikut);
  return { aksi: 'tanya', keadaan: berikut, balasan: `${tanyakan(berikut)}${JALAN_KELUAR}` };
}

/**
 * Penutup: ringkasan apa yang tercatat, lalu kalimat penutup staf.
 *
 * Ringkasannya SELALU ada, bukan pilihan. Pasien baru saja menyerahkan
 * keterangan yang akan ditindaklanjuti orang lain, dan satu-satunya kesempatan
 * ia mengetahui apa yang benar-benar tercatat adalah sekarang -- salah ketik
 * yang terlihat di sini masih bisa disusulkan lewat telepon, yang tidak terlihat
 * baru ketahuan saat petugas bertindak atas keterangan yang keliru.
 */
function selesaikan(keadaan: KeadaanFormulir): HasilFormulir {
  const terisi = keadaan.jawaban.filter((j) => j.jawaban !== '');
  const ringkas =
    terisi.length > 0
      ? terisi.map((j) => `• ${j.pertanyaan}\n  ${j.jawaban}`).join('\n')
      : '_(tidak ada isian)_';

  const penutup = keadaan.penutup.trim();
  const balasan = [
    `✅ *${keadaan.nama}* tersimpan.`,
    `*Yang tercatat:*\n${ringkas}`,
    ...(penutup ? [penutup] : []),
  ].join('\n\n');

  return {
    aksi: 'selesai',
    balasan,
    simpan: { formId: keadaan.formId, nama: keadaan.nama, jawaban: keadaan.jawaban },
  };
}

// ---------------------------------------------------------------------------
// Pemeriksaan jawaban
// ---------------------------------------------------------------------------

/**
 * Nilai yang DISIMPAN, atau sebab penolakannya.
 *
 * Untuk `angka` dan `pilihan`, yang tersimpan tetap TEKS -- angka disimpan
 * sebagaimana diketik pasien, dan pilihan disimpan sebagai isi pilihannya, bukan
 * nomornya. Keduanya mengikuti prinsip pembekuan yang sama: catatan ini adalah
 * catatan tentang apa yang dikatakan seseorang. Nomor 2 yang tersimpan telanjang
 * berhenti punya arti pada hari staf menyusun ulang daftar pilihannya, dan
 * "50.000" yang dinormalkan jadi 50000 menghapus keterangan bahwa yang dimaksud
 * memang rupiah.
 */
function periksaJawaban(field: FieldFormulir, masukan: string): { nilai: string } | { galat: string } {
  if (KATA_LEWATI.has(normalizeInbound(masukan))) {
    if (field.wajib) {
      return { galat: '⚠️ Pertanyaan ini wajib diisi.' };
    }
    return { nilai: '' };
  }

  const batas = field.maksPanjang > 0 ? field.maksPanjang : MAKS_JAWABAN;
  if (masukan.length > batas) {
    return { galat: `⚠️ Jawaban kepanjangan (${masukan.length} huruf, maksimal ${batas}).` };
  }

  if (field.tipe === 'angka') {
    // Pemisah ribuan dan desimal yang lazim diketik orang Indonesia dibuang
    // sebelum diperiksa; yang tersimpan tetap teks aslinya.
    const telanjang = masukan.replace(/[.,\s]/g, '');
    if (!/^\d+$/.test(telanjang)) {
      return { galat: '⚠️ Jawaban ini harus berupa angka.' };
    }
    return { nilai: masukan };
  }

  if (field.tipe === 'pilihan' && field.pilihan.length > 0) {
    const nomor = Number(masukan);
    if (Number.isInteger(nomor) && nomor >= 1 && nomor <= field.pilihan.length) {
      return { nilai: field.pilihan[nomor - 1]! };
    }
    // Ditulis apa adanya juga diterima -- orang membalas "BPJS", bukan "2".
    const diketik = normalizeInbound(masukan);
    const cocok = field.pilihan.find((p) => normalizeInbound(p) === diketik);
    if (cocok) return { nilai: cocok };
    return { galat: `⚠️ Pilih salah satu dengan mengetik nomor 1–${field.pilihan.length}.` };
  }

  return { nilai: masukan };
}
