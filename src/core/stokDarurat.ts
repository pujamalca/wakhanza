/**
 * Menyusun daftar DARURAT STOK jadi teks WhatsApp.
 *
 * Seluruh berkas fungsi murni -- tanpa database, tanpa WhatsApp -- supaya
 * pratinjau di halaman `/farmasi` memakai fungsi yang SAMA dipakai worker saat
 * benar-benar mengirim. Alasan yang sama seperti `core/stokObat.ts` dan
 * `core/autoReply.ts`: pratinjau yang berbeda dari kenyataan lebih buruk
 * daripada tanpa pratinjau, karena ia membuat orang percaya pada bentuk pesan
 * yang tidak akan pernah terkirim.
 */
import { sanitizeValue } from './template';
import { normalizeInbound } from './autoReply';
import { buangMention, KATA_PENGAPIT } from './stokObat';

export interface BarisDaruratStok {
  kode_brng: string;
  nama_brng: string;
  stokminimal: number;
  satuan: string;
  jenis: string;
  stok: number;
}

/**
 * Batas baris bawaan: TIDAK ADA.
 *
 * Versi pertama fitur ini memakai 30 baris, dengan alasan bahwa pesan 10 KB tak
 * seorang pun membacanya sampai bawah dan yang paling kritis toh sudah di atas.
 * Alasan itu keliru untuk pekerjaan yang sebenarnya: daftar ini bukan bacaan,
 * melainkan **daftar pesanan**. Apoteker memerlukan seluruh barang yang harus
 * dipesan ulang, bukan tiga puluh yang paling parah -- yang ke-31 tetap harus
 * dibeli hari itu juga, dan tidak muncul di mana pun berarti tidak dibeli.
 *
 * Diukur terhadap katalog di mesin ini: 208 barang berada di atau di bawah
 * ambang minimalnya, sementara batas atas isian dulu 200. Jadi kapnya bukan
 * teoretis -- ia menggigit pada hari pertama, dan barang yang tergunting justru
 * yang paling tidak mendesak sehingga ketiadaannya paling sulit disadari.
 *
 * Nilai ini tetap boleh diisi bila memang ada yang menginginkan rekap pendek
 * ("sepuluh paling kritis tiap pagi"); 0 berarti seluruhnya. Panjang pesannya
 * ditangani lewat PEMECAHAN, bukan pemotongan -- lihat `BATAS_KARAKTER_BAGIAN`.
 */
export const SEMUA_BARIS = 0;

/**
 * Panjang maksimal daftar dalam SATU pesan WhatsApp; selebihnya dipecah.
 *
 * Angka ini ada karena ada dua batas yang berbeda dan gampang tertukar. Batas
 * pertama bersifat kebijakan -- berapa banyak barang yang ingin dilihat apotek
 * -- dan itu `max_baris`, yang kini boleh 0 = semua. Batas kedua bersifat
 * protokol: sebuah pesan WhatsApp tidak bisa sepanjang apa pun. Menyamakan
 * keduanya adalah kesalahan versi pertama; akibatnya kebutuhan apotek dipangkas
 * demi batas yang sebenarnya milik WhatsApp.
 *
 * 12.000, dan angka itu DIUKUR bukan dibaca dari dokumentasi. Pesan 13.035
 * karakter dikirim lewat sesi whatsapp-web.js sungguhan di mesin ini dan
 * terbukti terkirim (`send_log.outcome='sent'`, 274 ms) -- yaitu seluruh amplop
 * yang mungkin dihasilkan angka ini: 12.000 untuk daftarnya, sisanya pembuka
 * dan penutup template plus baris kode pengiriman. Batas sungguhan WhatsApp
 * jauh di atas itu, tapi batas yang cuma dibaca adalah batas yang belum pernah
 * gagal di hadapan kita -- dan kegagalannya, kalau datang, datang sebagai pesan
 * yang dipotong DIAM oleh pihak yang jauh, bukan sebagai galat yang bisa
 * ditangkap.
 *
 * Daftar 208 barang di mesin ini berukuran ~9.300 karakter, jadi dalam keadaan
 * normal ia tetap SATU pesan; pemecahan adalah jaring pengaman, bukan perilaku
 * sehari-hari.
 */
export const BATAS_KARAKTER_BAGIAN = 12000;

/**
 * Batas keras jumlah baris yang dibaca dari `sik` dalam satu kali jalan.
 *
 * BUKAN batas produk -- `max_baris` yang mengurus itu, dan ia boleh 0 = semua.
 * Ini jaring pengaman terhadap katalog yang bentuknya tidak kita duga: tanpa
 * `LIMIT` sama sekali, satu instalasi dengan ratusan ribu barang menarik
 * seluruhnya ke memori proses worker yang berbagi mesin dengan SIMRS. Katalog
 * di sini 887 barang, jadi ia tidak akan pernah menggigit; angkanya disamakan
 * dengan `maxRows` pada pemeriksaan rencana supaya keduanya tidak bisa
 * menyimpang diam-diam.
 *
 * Tinggal di `core/` (bukan di runner) karena TIGA tempat memakainya: runner,
 * validasi server action, dan atribut `max` pada isian di komponen KLIEN --
 * dan komponen klien tidak boleh mengimpor runner, yang menarik `khanza/*`
 * beserta koneksi databasenya ke dalam bundel peramban.
 */
export const BATAS_KERAS_BARIS = 5000;

/**
 * Ruang yang disisihkan di tiap bagian untuk penanda "(bagian i dari n)" dan
 * catatan sisa. Keduanya baru diketahui SESUDAH pemecahan selesai, jadi tanpa
 * cadangan ini bagian terakhir bisa melewati batas justru karena keterangan
 * yang menjelaskan bahwa ia terpecah.
 */
const CADANGAN_KETERANGAN = 120;

export interface RingkasanDarurat {
  /** Baris yang benar-benar dicetak ke pesan. */
  ditampilkan: BarisDaruratStok[];
  /** Seluruh yang cocok, termasuk yang tidak ikut tercetak. */
  total: number;
  habis: number;
  menipis: number;
  /** Berapa yang tidak muat. 0 = daftarnya utuh. */
  sisa: number;
}

/**
 * Memilah hasil query jadi bentuk siap dirender.
 *
 * `rows` diharapkan berisi `batas + 1` baris bila pemanggilnya ingin bisa
 * membedakan "terpotong" dari "kebetulan pas" -- pola yang sama dipakai balasan
 * stok dan jadwal dokter. `total` tetap dihitung dari apa yang terbaca, jadi
 * angka yang disebut pesan tidak pernah melebihi yang benar-benar diketahui.
 *
 * `habis` dipisahkan dari `menipis` dan itu bukan kosmetik: keduanya menuntut
 * tindakan berbeda. Barang habis berarti pasien hari ini sudah tidak bisa
 * dilayani; barang menipis berarti ada waktu untuk memesan. Satu angka gabungan
 * menyembunyikan justru pembedaan yang menentukan apa yang dikerjakan lebih dulu.
 */
export function ringkasDarurat(rows: BarisDaruratStok[], batas: number): RingkasanDarurat {
  // 0, negatif, dan bukan-angka semuanya berarti SEMUA. Dulu 0 diam-diam
  // diganti 30 lewat `Math.floor(batas) || BATAS_BARIS_BAWAAN`, sehingga tidak
  // ada satu pun nilai yang bisa dipakai untuk meminta daftar utuh.
  const diminta = Math.floor(batas);
  const ditampilkan = Number.isFinite(diminta) && diminta > 0 ? rows.slice(0, diminta) : rows;
  return {
    ditampilkan,
    total: rows.length,
    habis: rows.filter((r) => r.stok <= 0).length,
    menipis: rows.filter((r) => r.stok > 0).length,
    sisa: Math.max(0, rows.length - ditampilkan.length),
  };
}

/**
 * Satu baris daftar.
 *
 * `sanitizeValue()` dipanggil untuk `nama_brng` DAN `satuan`, dan itu keharusan
 * bukan kehati-hatian berlebih: keduanya diketik bebas petugas gudang di
 * Khanza, sementara hasil fungsi ini dipasang ke `{daftar_stok}` yang
 * DIKECUALIKAN dari sanitasi (MULTILINE_VARIABLES di `core/template.ts`).
 * Artinya setiap baris baru pada hasil akhir wajib berasal dari kode di sini --
 * kalau tidak, satu nama barang berisi baris baru bisa menyisipkan barisnya
 * sendiri ke dalam pesan. Persis lubang ARCHITECTURE §9.2.
 */
function barisTeks(r: BarisDaruratStok): string {
  const nama = sanitizeValue(r.nama_brng ?? '');
  const satuan = sanitizeValue(r.satuan ?? '');
  const satuanTeks = satuan ? ` ${satuan}` : '';
  // Nol dibedakan dari menipis. "sisa 0 (menipis)" terbaca seolah masih ada
  // yang bisa diserahkan hari ini -- pelajaran yang sudah dibayar di
  // core/stokObat.ts terhadap katalog sungguhan.
  const tanda = r.stok <= 0 ? 'HABIS' : `sisa ${r.stok}${satuanTeks}`;
  return `• ${nama} — ${tanda} (min ${r.stokminimal})`;
}

interface Kelompok {
  label: 'Habis' | 'Menipis';
  jumlah: number;
  baris: string[];
}

/**
 * Pengelompokan dikerjakan di SINI dan bukan lewat `ORDER BY`, walau query-nya
 * sudah mengurutkan menurut rasio: judul kelompok ("Habis:", "Menipis:") adalah
 * urusan tampilan, dan menaruhnya di SQL berarti pratinjau dashboard harus
 * mengulang penalaran yang sama untuk hasil yang sama. Rasio dari query tetap
 * menentukan urutan DI DALAM tiap kelompok.
 */
function kelompokkan(ringkasan: RingkasanDarurat): Kelompok[] {
  const habis = ringkasan.ditampilkan.filter((r) => r.stok <= 0);
  const menipis = ringkasan.ditampilkan.filter((r) => r.stok > 0);
  const out: Kelompok[] = [];
  if (habis.length > 0) out.push({ label: 'Habis', jumlah: habis.length, baris: habis.map(barisTeks) });
  if (menipis.length > 0) out.push({ label: 'Menipis', jumlah: menipis.length, baris: menipis.map(barisTeks) });
  return out;
}

/**
 * Judul kelompok diulang di tiap bagian yang memuatnya, ditandai "lanjutan".
 *
 * Tanpa pengulangan itu, bagian kedua dibuka dengan deretan butir tanpa satu
 * pun keterangan -- pembacanya tidak bisa tahu apakah yang sedang dibacanya
 * barang habis atau barang menipis, padahal justru pembedaan itu yang
 * menentukan mana yang harus dikerjakan lebih dulu.
 */
function judulKelompok(k: Kelompok, lanjutan: boolean): string {
  return `*${k.label} (${k.jumlah})${lanjutan ? ' — lanjutan' : ''}:*`;
}

/**
 * Daftar lengkap sebagai SATU ATAU BEBERAPA pesan.
 *
 * Ini penurunan tunggal untuk teks daftar darurat; `formatDaruratStok()` cuma
 * kasus khususnya dengan batas tak hingga. Dua fungsi terpisah yang sama-sama
 * merangkai daftar ini akan menyimpang cepat atau lambat, dan yang muncul saat
 * menyimpang bukan galat melainkan dua bentuk pesan berbeda dari satu sistem --
 * bentuk kegagalan yang sudah dibayar berkali-kali di proyek ini (`respectsOptOut`,
 * `core/outboxStatus.ts`, `kunciPesanMasuk`, `khanza/stokGudang.ts`).
 *
 * Pemecahan tidak pernah membelah satu baris barang, dan selalu memuat
 * setidaknya satu baris per bagian -- jaminan kedua itu yang membuat
 * perulangannya pasti berhenti sekalipun batasnya disetel lebih kecil daripada
 * satu baris.
 */
export function pecahDaftarDarurat(ringkasan: RingkasanDarurat, batasKarakter: number): string[] {
  const kelompok = kelompokkan(ringkasan);
  if (kelompok.length === 0) return [];

  const batas =
    Number.isFinite(batasKarakter) && batasKarakter > 0
      ? Math.max(1, Math.floor(batasKarakter) - CADANGAN_KETERANGAN)
      : Number.MAX_SAFE_INTEGER;

  const bagian: string[] = [];
  let buf: string[] = [];
  let panjang = 0;

  function tutup(): void {
    if (buf.length > 0) {
      bagian.push(buf.join('\n'));
      buf = [];
      panjang = 0;
    }
  }
  function biaya(baris: string[]): number {
    let n = 0;
    let kosong = buf.length === 0;
    for (const b of baris) {
      n += b.length + (kosong ? 0 : 1);
      kosong = false;
    }
    return n;
  }
  function tulis(baris: string[]): void {
    panjang += biaya(baris);
    buf.push(...baris);
  }

  for (const k of kelompok) {
    let i = 0;
    let lanjutan = false;
    while (i < k.baris.length) {
      // Baris kosong memisahkan kelompok, tapi hanya bila bagian ini sudah ada isinya.
      const pembuka = buf.length > 0 ? ['', judulKelompok(k, lanjutan)] : [judulKelompok(k, lanjutan)];

      // Judul yang tidak diikuti satu pun barang adalah judul hampa di ujung
      // bagian; kalau tidak muat berdua, tutup bagian ini dulu.
      const pertama = k.baris[i] ?? '';
      if (buf.length > 0 && panjang + biaya([...pembuka, pertama]) > batas) {
        tutup();
        lanjutan = true;
        continue;
      }
      tulis(pembuka);

      // Baris PERTAMA selalu ditulis tanpa syarat -- itu yang menjamin
      // perulangan ini maju walau batasnya dibuat tidak masuk akal.
      let ditulis = 0;
      for (let b = k.baris[i]; b !== undefined; b = k.baris[i]) {
        if (ditulis > 0 && panjang + biaya([b]) > batas) break;
        tulis([b]);
        i++;
        ditulis++;
      }

      if (i < k.baris.length) {
        tutup();
        lanjutan = true;
      }
    }
  }
  tutup();

  // Yang tidak muat karena `max_baris` TETAP disebut, dan hanya di bagian
  // terakhir. Daftar terpotong yang diam terlihat persis seperti daftar utuh,
  // dan orang yang membacanya menyimpulkan pekerjaannya selesai -- kegagalan
  // yang sama dengan angka "Cocok" di /broadcast yang menyentuh SEGMENT_LIMIT.
  if (ringkasan.sisa > 0) {
    bagian[bagian.length - 1] += `\n\n_...dan ${ringkasan.sisa} barang lain di bawah ambang minimal._`;
  }

  // Penanda hanya muncul saat memang terpecah. Pesan tunggal bertanda
  // "(bagian 1 dari 1)" membuat pembacanya menunggu bagian kedua yang tidak
  // akan pernah datang.
  if (bagian.length > 1) {
    return bagian.map((b, i) => `_(bagian ${i + 1} dari ${bagian.length})_\n${b}`);
  }
  return bagian;
}

/** Daftar lengkap dalam satu teks, tanpa pemecahan. Dipakai pratinjau dashboard. */
export function formatDaruratStok(ringkasan: RingkasanDarurat): string {
  return pecahDaftarDarurat(ringkasan, Number.POSITIVE_INFINITY)[0] ?? '';
}

// ---------------------------------------------------------------------------
// Arah MASUK: mengenali pertanyaan "apa saja yang hampir habis"
// ---------------------------------------------------------------------------

/**
 * Jawaban saat ada yang BERTANYA dan gudang sedang aman.
 *
 * Jalur terjadwal memperlakukan pesan kosong sebagai DIAM, dan itu benar di
 * sana: peringatan harian yang isinya "tidak ada apa-apa" berhenti dibaca dalam
 * seminggu. Jalur pertanyaan tidak boleh mewarisi keputusan itu -- mendiamkan
 * orang yang baru saja bertanya membuat sistemnya tampak rusak, alasan yang
 * sama persis dengan AUTO_REPLY yang melewati jam tenang.
 *
 * Dipakai hanya bila "Pesan saat aman" memang dikosongkan; kalau diisi, isian
 * staf yang menang.
 */
export const JAWABAN_GUDANG_AMAN = 'Tidak ada barang yang stoknya di bawah ambang minimal saat ini.';

export interface PermintaanDarurat {
  /** Ada frasa darurat di pesannya DAN penanya tidak sedang menyebut satu barang tertentu. */
  cocok: boolean;
  /** Frasa yang membuatnya cocok -- untuk log dan kotak uji coba. */
  frasa?: string;
  /**
   * Sisa kata yang bukan frasa maupun kata pengapit. Terisi berarti penanya
   * menyebut sesuatu yang spesifik, sehingga ini BUKAN permintaan rekap.
   */
  sisa: string;
}

/** Bentuk daftar frasa yang tersimpan sebagai satu baris dipisah koma. */
export function parseFrasaDarurat(raw: string): string[] {
  return raw
    .split(',')
    .map((f) => normalizeInbound(f))
    .filter(Boolean);
}

/** Panjang minimal sisa kata yang dianggap "menyebut sesuatu yang spesifik". */
const MIN_PANJANG_SISA = 3;

/**
 * Mendeteksi permintaan REKAP persediaan.
 *
 * Tiga hal yang menempel di sini, dan yang ketiga adalah intinya:
 *
 * 1. **Frasa, bukan kata tunggal.** Kata kunci balasan stok biasa ("stok",
 *    "harga") sengaja pendek karena ia diikuti nama obat. Di sini justru
 *    sebaliknya: satu kata "stok" sudah dipakai fitur sebelah, jadi yang
 *    dicocokkan adalah frasa utuh seperti "darurat stok" atau "stok menipis".
 *    Dicocokkan sebagai potongan berbatas spasi, sama seperti `cocokKataUtuh`,
 *    supaya "stok habis" tidak cocok pada "stok habisan".
 *
 * 2. **Frasa diperiksa dari yang TERPANJANG lebih dulu.** Kalau tidak, frasa
 *    pendek yang kebetulan jadi bagian frasa panjang akan menang, dan `sisa`
 *    ikut memuat kata dari frasa yang sebenarnya cocok -- sehingga permintaan
 *    rekap yang sah terbaca sebagai pertanyaan tentang satu barang.
 *
 * 3. **Sisa kata yang berarti membatalkan kecocokan.** "stok habis paracetamol"
 *    bukan permintaan rekap; penanya jelas menanyakan satu obat, dan
 *    menjawabnya dengan daftar 208 barang adalah jawaban percaya-diri-dan-keliru
 *    yang sama jenisnya dengan `detectPoli()` yang menebak saat ambigu. Dengan
 *    dibatalkan di sini, pertanyaannya jatuh ke balasan stok biasa -- yang
 *    memang tahu cara mencari nama obat.
 */
export function deteksiPermintaanDarurat(teks: string, frasaTersedia: string[]): PermintaanDarurat {
  const norm = normalizeInbound(buangMention(teks));
  if (!norm) return { cocok: false, sisa: '' };

  const kandidat = frasaTersedia
    .map((f) => normalizeInbound(f))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const terpakai = kandidat.find((f) => ` ${norm} `.includes(` ${f} `));
  if (!terpakai) return { cocok: false, sisa: '' };

  const kataFrasa = new Set(terpakai.split(' '));
  const sisa = norm
    .split(' ')
    .filter((kata) => kata && !kataFrasa.has(kata) && !KATA_PENGAPIT.has(kata))
    .join(' ')
    .trim();

  return { cocok: sisa.length < MIN_PANJANG_SISA, frasa: terpakai, sisa };
}

/**
 * Daftar variabelnya (`DARURAT_TEMPLATE_VARIABLES`) sengaja tinggal di
 * `core/template.ts` bersama kelima daftar lain, bukan di sini: berkas ini
 * mengimpor `sanitizeValue` dari sana, jadi menaruhnya di sini menutup
 * lingkaran impor. Yang lebih penting daripada lingkarannya, satu tempat untuk
 * "variabel apa saja yang ada" adalah yang membuat penambahan berikutnya tidak
 * bisa lupa mendaftarkan diri ke `KNOWN_TEMPLATE_VARIABLES`.
 */
