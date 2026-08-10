import { Op } from 'sequelize';
import { FarmasiTarget, Outbox, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { deteksiPermintaanStok, parseStokKeywords, formatStokObat, type RincianStok } from '@/core/stokObat';
import {
  deteksiPermintaanDarurat,
  parseFrasaDarurat,
  JAWABAN_GUDANG_AMAN,
  SEMUA_BARIS,
} from '@/core/stokDarurat';
import { susunPesanDarurat } from './stokDaruratRunner';
import { normalizeInbound } from '@/core/autoReply';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { kunciPesanMasuk, type PesanMasukBerkunci } from '@/core/waAddress';
import { cariStokObat } from '@/khanza/stokObat';
import { loadAutoReplyContext, identityVars, enqueueMessage } from './pipeline';
import { logger, maskPhone } from '@/lib/logger';
import type { InboundMessage } from './autoReply';

/**
 * BALASAN STOK & HARGA OBAT -- cabang di dalam alur pesan masuk.
 *
 * Berdiri sendiri dari `autoreply.enabled`: apotek bisa menyalakan jawaban stok
 * tanpa menyalakan balasan otomatis umum, dan sebaliknya. Keduanya tetap berbagi
 * pemeriksaan yang mendahuluinya di `handleInboundMessage` (pesan kosong,
 * penyerahan ulang, kuota per nomor) -- memisahkan itu berarti satu nomor bisa
 * menghabiskan kuota lewat satu jalur lalu tetap dilayani lewat jalur lain.
 *
 * `trigger_code`-nya tetap AUTO_REPLY, bukan kode baru. Ini memang balasan atas
 * pesan yang penanya kirim sendiri, jadi seluruh perlakuannya harus sama:
 * melewati jam tenang (menahannya sampai 07.00 membuat jawaban datang sembilan
 * jam setelah pertanyaannya), dan tidak tunduk pada daftar tolak (mendiamkan
 * orang yang baru saja bertanya bukan menghormati permintaannya). Kode baru
 * berarti kedua keputusan itu harus didaftarkan ulang di `core/optOut.ts` dan
 * `core/quietHours.ts` -- dan yang lupa mendaftarkannya tidak akan mendapat
 * satu pun galat.
 */

export type ModeStok = 'mati' | 'petugas' | 'semua';

export interface HasilStokReply {
  /** true = pertanyaannya sudah ditangani di sini; jangan lanjut ke aturan kata kunci. */
  ditangani: boolean;
  /** Untuk log dan pengujian: cabang mana yang dipakai. */
  cabang?: 'ketemu' | 'kosong' | 'tanpa_nama';
}

const TIDAK_DITANGANI: HasilStokReply = { ditangani: false };

/**
 * Jejak asal untuk log. Nomor perorangan tetap disamarkan (§9.7); JID grup
 * ditulis apa adanya -- ia alamat sebuah grup kerja, bukan nomor milik
 * seseorang, dan justru itulah yang perlu dicocokkan saat menelusuri "grup mana
 * yang dijawab".
 */
function jejakAsal(asal: AsalPertanyaan): string {
  return asal.jenis === 'grup' ? asal.chatId : maskPhone(asal.phoneE164);
}

export async function bacaModeStok(): Promise<ModeStok> {
  const nilai = (await getSetting('farmasi.stok_mode', 'mati')) ?? 'mati';
  return nilai === 'petugas' || nilai === 'semua' ? nilai : 'mati';
}

/**
 * Dari mana sebuah pertanyaan datang. Grup dan perorangan diperlakukan berbeda
 * di tiga tempat -- izin, kuota, dan alamat balasan -- jadi keduanya dibawa
 * dalam satu bentuk alih-alih dua parameter yang bisa tidak sinkron.
 */
export interface AsalPertanyaan {
  jenis: 'perorangan' | 'grup';
  /** Alamat lengkap: `628xxx@c.us` atau `120363xxx@g.us`. */
  chatId: string;
  /** Nomor penanya; selalu null untuk grup -- yang mengetik cuma salah satu peserta. */
  phoneE164: string | null;
}

/**
 * Mode 'petugas': hanya alamat yang dicentang `boleh_tanya` di `farmasi_target`.
 *
 * Memakai ulang `farmasi_target` alih-alih daftar putih kedua -- dua tempat
 * yang harus diingat saat petugas berganti nomor akan gagal DIAM, petugasnya
 * sekadar tidak pernah dijawab. Tapi memakai kolom TERSENDIRI (`boleh_tanya`,
 * bukan `is_active`), karena keduanya menjawab pertanyaan berbeda: yang satu ke
 * mana notifikasi resep dikirim, yang lain siapa yang boleh bertanya. Sebuah
 * grup sangat wajar cuma menerima pemberitahuan tanpa nomor RS ikut menjawab
 * di dalamnya.
 *
 * GRUP WAJIB terdaftar, bahkan pada mode 'semua'. Mode itu berarti "siapa pun
 * boleh bertanya lewat japri", BUKAN "nomor RS boleh menjawab di grup mana pun
 * yang kebetulan mengundangnya" -- satu percakapan grup yang ramai bisa memicu
 * rentetan balasan dari satu-satunya nomor rumah sakit.
 */
async function bolehBertanya(mode: ModeStok, asal: AsalPertanyaan): Promise<{ boleh: boolean; terdaftar: boolean }> {
  const terdaftar = (await FarmasiTarget.count({ where: { chatId: asal.chatId, bolehTanya: true } })) > 0;
  // Grup WAJIB terdaftar, apa pun modenya. Perorangan boleh lewat mode 'semua'.
  const boleh = asal.jenis === 'grup' ? terdaftar : mode === 'semua' || terdaftar;
  return { boleh, terdaftar };
}

/**
 * Kuota jawaban per GRUP, dihitung dari `outbox` dan bukan `auto_reply_log`.
 *
 * Dua sebabnya, dan yang pertama akan jadi bug diam bila diabaikan:
 * `auto_reply_log.phone_e164` adalah VARCHAR(20), sementara JID grup
 * (`120363000000000000@g.us`) 24 karakter -- MariaDB non-strict memotongnya
 * diam-diam, dan yang terpotong justru ekor yang membedakan satu grup dari
 * grup lain. Kedua, yang perlu dihitung memang cuma balasan stok: notifikasi
 * resep ke grup yang sama tidak boleh ikut memakan jatahnya, dan pagi sibuk
 * penuh resep akan mendiamkan pertanyaan stok kalau ikut terhitung.
 *
 * Kombinasi `trigger_code='AUTO_REPLY'` + `chat_id` terisi hanya dihasilkan
 * oleh balasan stok ke grup -- tidak ada jalur lain yang menghasilkannya.
 */
async function kuotaGrupHabis(chatId: string): Promise<boolean> {
  const maks = await getSettingNumber('farmasi.stok_max_per_grup_per_jam', 10);
  if (maks <= 0) return true;
  const sejak = new Date(Date.now() - 60 * 60 * 1000);
  const jumlah = await Outbox.count({
    where: { chatId, triggerCode: 'AUTO_REPLY', createdAt: { [Op.gte]: sejak } },
  });
  return jumlah >= maks;
}

/**
 * Siapa yang bertanya. Menentukan DUA hal sekaligus: seberapa rinci daftarnya,
 * dan template mana yang membungkusnya.
 *
 * Ditentukan oleh PENDAFTARAN, bukan oleh mode. Sebuah grup apotek yang sudah
 * dicentang `boleh_tanya` adalah petugas menurut definisinya sendiri, dan ia
 * tetap petugas walau modenya `semua` -- mode itu mengatur apakah orang luar
 * boleh ikut bertanya lewat japri, bukan menurunkan derajat grup kerja yang
 * terdaftar. Mengikat ini ke mode akan membuat apotek kehilangan angka
 * persediaannya begitu RS membuka layanan untuk umum.
 */
export type PenanyaStok = 'petugas' | 'umum';

export type CabangStok = 'ketemu' | 'kosong' | 'tanpa_nama';

/**
 * Kenapa sebuah pesan DILEPAS alih-alih dijawab di jalur stok.
 *
 * Dibedakan karena ketiganya menuntut tindakan berbeda dari staf yang sedang
 * menyetel kata kunci: yang pertama berarti kata kuncinya belum menjaring,
 * dua sisanya berarti kata kuncinya menjaring tapi katalognya tidak menjawab.
 * Satu kalimat "tidak cocok" untuk ketiganya membuat staf menambah kata kunci
 * yang sebenarnya sudah ada.
 */
export type SebabLanjut =
  | 'bukan_pertanyaan_stok'
  | 'ketersediaan_tanpa_nama'
  | 'ketersediaan_tak_ketemu'
  | 'aturan_menang';

/**
 * Apakah pesan ini punya aturan /balasan-otomatis yang cocok. Diserahkan
 * pemanggil sebagai FUNGSI, bukan boolean, supaya query aturannya cuma jalan
 * pada jalur yang benar-benar membutuhkannya -- yaitu saat kata tanya
 * ketersediaan menjaring DAN katalog menemukan sesuatu, keadaan yang jarang.
 *
 * Diserahkan dari luar, bukan dibaca sendiri di sini, karena
 * `worker/autoReply.ts` sudah mengimpor modul ini: membacanya sendiri berarti
 * impor melingkar antar dua berkas yang sama-sama dimuat saat worker menyala.
 */
export type PemeriksaAturan = () => Promise<boolean>;

/**
 * Hasil penyusunan jawaban.
 *
 * Serikat berdiskriminan, BUKAN `... | null`, karena sejak ada kata tanya
 * ketersediaan (migrations/039) "tidak dijawab" punya tiga sebab yang berbeda
 * artinya -- dan `null` tidak bisa membawa satu pun di antaranya. `body` kosong
 * juga tidak bisa dipakai sebagai penandanya: kosong sudah punya arti sendiri
 * di sini ("template cabang ini sengaja dikosongkan admin = diam"), dan dua
 * keadaan berbeda yang terlihat sama persis adalah kelas kegagalan yang sudah
 * berkali-kali dibayar di proyek ini.
 */
export type JawabanStok =
  | { aksi: 'jawab'; body: string; cabang: CabangStok; cari: string }
  | { aksi: 'lanjut'; sebab: SebabLanjut; cari: string };

/**
 * Rincian untuk penanya UMUM. `penuh` sengaja tidak bisa dipilih -- angka
 * persediaan adalah informasi dagang apotek, dan yang membukanya untuk umum
 * seharusnya menambah tujuan `boleh_tanya`, bukan menurunkan batas ini.
 * Ditegakkan tipe, bukan cuma oleh isi dropdown-nya.
 */
export async function bacaRincianUmum(): Promise<Exclude<RincianStok, 'penuh'>> {
  return (await getSetting('farmasi.stok_rincian_umum', 'ringkas')) === 'harga' ? 'harga' : 'ringkas';
}

/**
 * Menyusun jawaban untuk sebuah pertanyaan stok. FUNGSI YANG SAMA dipakai kotak
 * uji coba di dashboard -- yang membedakan cuma pengirimannya.
 */
export async function susunJawabanStok(
  teks: string,
  identity: { namaRs: string; alamatRs: string; kontakRs: string },
  penanyaMasuk?: PenanyaStok,
  adaAturanCocok?: PemeriksaAturan,
): Promise<JawabanStok> {
  const [ketatMentah, longgarMentah] = await Promise.all([
    getSetting('farmasi.stok_keywords', 'stok,harga'),
    getSetting('farmasi.stok_keywords_ketersediaan', ''),
  ]);
  const permintaan = deteksiPermintaanStok(
    teks,
    parseStokKeywords(ketatMentah ?? ''),
    parseStokKeywords(longgarMentah ?? ''),
  );
  if (!permintaan.cocok) return { aksi: 'lanjut', sebab: 'bukan_pertanyaan_stok', cari: '' };

  // Tanpa keterangan pemanggil (mis. pemanggil lama), diturunkan dari mode
  // seperti semula -- hasilnya persis seperti sebelum migrations/039.
  const penanya: PenanyaStok = penanyaMasuk ?? ((await bacaModeStok()) === 'petugas' ? 'petugas' : 'umum');
  const vars = { ...identityVars(identity), cari_obat: permintaan.cari };

  if (!permintaan.cari) {
    /**
     * Kata tanya ketersediaan tanpa nama obat sama sekali ("apotek?", "ada?")
     * bukan pertanyaan stok yang belum lengkap -- ia bukan pertanyaan stok.
     * Menjawabnya "sebutkan nama obatnya ya" berarti mengklaim pesan yang
     * mungkin sedang menanyakan jam buka apotek, lalu mengunci aturan
     * /balasan-otomatis yang justru bisa menjawabnya.
     */
    if (!permintaan.ketat) return { aksi: 'lanjut', sebab: 'ketersediaan_tanpa_nama', cari: '' };
    const body = (await getSetting('farmasi.stok_template_tanpa_nama', '')) ?? '';
    return { aksi: 'jawab', body: renderDenganVars(body, vars), cabang: 'tanpa_nama', cari: '' };
  }

  const maks = await getSettingNumber('farmasi.stok_max_hasil', 5);
  const hargaDipakai = (await getSetting('farmasi.stok_harga', 'jualbebas')) === 'ralan' ? 'ralan' : 'jualbebas';

  // maks + 1 dibaca supaya "ada yang terpotong" bisa dibedakan dari "kebetulan
  // pas" -- pola yang sama dipakai jadwal dokter.
  //
  // `farmasi.stok_pakai_batch` (migrations/021) memilih CABANG perhitungan
  // stoknya, dan dibaca di sini alih-alih di dalam `khanza/` supaya modul itu
  // tetap tidak pernah menyentuh database `wakhanza` -- batas yang membuat
  // `npm run verify:db` bisa membuktikan `sik` hanya dibaca.
  const pakaiBatch = await getSettingBool('farmasi.stok_pakai_batch', false);
  const rows = await cariStokObat(permintaan.cari, maks + 1, pakaiBatch);

  if (rows.length === 0) {
    /**
     * INI pagar utama kata tanya ketersediaan, dan tanpanya golongan itu tidak
     * boleh ada sama sekali. "ada dokter jaga" menyisakan "dokter jaga" sebagai
     * pencarian; katalog tidak menjawab, jadi pesannya dilepas dan aturan
     * /balasan-otomatis yang memang punya jawabannya tetap sempat berjalan.
     * Menjawabnya "dokter jaga tidak ditemukan di daftar obat kami" adalah
     * jawaban percaya-diri-dan-keliru.
     */
    if (!permintaan.ketat) return { aksi: 'lanjut', sebab: 'ketersediaan_tak_ketemu', cari: permintaan.cari };
    const body = (await getSetting('farmasi.stok_template_kosong', '')) ?? '';
    return { aksi: 'jawab', body: renderDenganVars(body, vars), cabang: 'kosong', cari: permintaan.cari };
  }

  /**
   * Aturan /balasan-otomatis yang cocok MENGALAHKAN kata tanya ketersediaan --
   * dan hanya kata tanya ketersediaan; kata kunci ketat tetap didahulukan
   * seperti sebelumnya.
   *
   * Diukur, bukan dikira: dengan "ada" ikut menjaring, pertanyaan "ada poli
   * apa" menyisakan "poli", dan katalog di mesin ini punya barang yang cocok
   * `LIKE '%poli%'`. Pagar "gugur bila obatnya tidak ketemu" justru tidak
   * menolong di situ -- obatnya KETEMU, dan itulah yang membuat jawabannya
   * salah. Yang membedakan keduanya bukan katalog melainkan niat: sebuah aturan
   * yang ditulis staf adalah pernyataan tegas "pesan seperti ini dijawab
   * begini", sementara kata tanya ketersediaan cuma dugaan. Yang tegas menang.
   *
   * Tanpa pemeriksa (jalur grup -- aturan /balasan-otomatis memang sengaja
   * tidak berlaku di sana), tidak ada yang bisa mengalahkannya, dan hasilnya
   * persis seperti tanpa pagar ini.
   */
  if (!permintaan.ketat && adaAturanCocok && (await adaAturanCocok())) {
    return { aksi: 'lanjut', sebab: 'aturan_menang', cari: permintaan.cari };
  }

  const ditampilkan = rows.slice(0, maks);
  const daftar = formatStokObat(ditampilkan, {
    rincian: penanya === 'petugas' ? 'penuh' : await bacaRincianUmum(),
    hargaDipakai,
    truncatedFrom: rows.length,
  });

  /**
   * Template TERPISAH per penanya, bukan satu teks dengan daftar yang berbeda:
   * teks petugas berbunyi "Harga dapat berubah sewaktu-waktu", dan kalimat itu
   * menggantung tanpa arti pada jawaban ringkas yang memang tidak memuat satu
   * pun harga.
   */
  const body = (await getSetting(penanya === 'petugas' ? 'farmasi.stok_template' : 'farmasi.stok_template_umum', '')) ?? '';
  return {
    aksi: 'jawab',
    body: renderDenganVars(body, { ...vars, stok_obat: daftar }),
    cabang: 'ketemu',
    cari: permintaan.cari,
  };
}

/**
 * Dirender DI SINI, bukan diserahkan ke `enqueueMessage` lewat `vars`.
 *
 * Sebabnya `{stok_obat}` berbentuk banyak baris dan sudah dirakit
 * `formatStokObat()` -- yang memanggil `sanitizeValue()` sendiri untuk tiap nama
 * obat dan satuan. Menyerahkannya sebagai variabel biasa akan membuat seluruh
 * daftar dipotong di 60 karakter dan baris barunya dibuang. Ia memang terdaftar
 * di MULTILINE_VARIABLES, tapi merendernya di sini membuat teks yang tersimpan
 * di `outbox.body` persis sama dengan yang dilihat staf di kotak uji coba.
 */
function renderDenganVars(body: string, vars: Record<string, string>): string {
  // Satu lintasan kiri-ke-kanan, sama seperti renderTemplate -- hasil
  // substitusi tidak pernah diperiksa ulang, jadi nama obat yang kebetulan
  // berisi `{kontak_rs}` tetap tampil apa adanya.
  return body.replace(/\{([a-z_]+)\}/g, (cocok, kunci: string) => vars[kunci] ?? cocok);
}

// ---------------------------------------------------------------------------
// DARURAT STOK yang DITANYAKAN -- rekap, bukan pencarian satu barang
// ---------------------------------------------------------------------------

/**
 * Tanya-jawab darurat stok menyala.
 *
 * DUA sakelar, dan keduanya perlu. `farmasi.darurat_enabled` adalah sakelar
 * fiturnya secara keseluruhan -- selama mati, tidak ada peringatan persediaan
 * dalam bentuk apa pun. `farmasi.darurat_tanya` memisahkan arah MASUK dari arah
 * keluar, karena keduanya pertanyaan berbeda: rumah sakit sangat wajar ingin
 * rekap terjadwal tiap pagi tanpa nomornya ikut menjawab kapan pun ada yang
 * mengetik "stok habis". Pelajaran yang sudah dibayar saat migrations/020
 * memisahkan `boleh_tanya` dari `is_active` -- pilihan yang digabung adalah
 * pilihan yang hilang.
 *
 * Bawaannya MENYALA, berbeda dari sakelar utamanya yang mati. Yang menahan
 * seluruhnya tetap `darurat_enabled`, jadi tidak ada yang berubah tanpa
 * keputusan sadar; sakelar ini ada untuk MEMATIKAN arah masuk, bukan untuk
 * menambah satu langkah lagi sebelum fiturnya bisa dipakai.
 */
export async function daruratTanyaAktif(): Promise<boolean> {
  if (!(await getSettingBool('farmasi.darurat_enabled', false))) return false;
  return getSettingBool('farmasi.darurat_tanya', true);
}

/**
 * Cabang REKAP persediaan di dalam alur pesan masuk.
 *
 * Bedanya dari `cobaBalasStok` di bawah bukan cuma isi jawabannya:
 *
 * - **Tidak ada mode `semua`.** Balasan stok boleh dibuka untuk umum karena
 *   yang dijawabnya setara daftar harga di loket -- seorang pasien memang perlu
 *   tahu apakah obatnya ada sebelum datang. Rekap ini kebalikannya: ia daftar
 *   kekurangan gudang, informasi kerja internal yang tidak menjawab satu pun
 *   pertanyaan yang wajar diajukan pasien. Karena itu penanya WAJIB terdaftar
 *   `boleh_tanya`, perorangan maupun grup, apa pun `farmasi.stok_mode`.
 *
 * - **Didahulukan atas balasan stok biasa**, dengan alasan yang sama yang
 *   menaruh balasan stok di depan aturan /balasan-otomatis: frasanya lebih
 *   spesifik. "stok menipis" memuat kata "stok", jadi urutan sebaliknya
 *   membuat setiap permintaan rekap dibaca sebagai pencarian obat bernama
 *   "menipis" lalu dijawab "tidak ditemukan".
 */
export async function cobaBalasDarurat(
  msg: InboundMessage,
  idempotencyKey: string,
  asalMasuk?: AsalPertanyaan,
): Promise<HasilStokReply> {
  if (!(await daruratTanyaAktif())) return TIDAK_DITANGANI;

  const asal: AsalPertanyaan = asalMasuk ?? {
    jenis: 'perorangan',
    chatId: `${msg.phoneE164}@c.us`,
    phoneE164: msg.phoneE164,
  };

  // Izin SEBELUM frasa dibaca, sama seperti balasan stok: nomor tak berhak
  // harus jatuh ke jalur berikutnya seolah fitur ini tidak ada, bukan
  // "tertangani" lalu didiamkan.
  if ((await FarmasiTarget.count({ where: { chatId: asal.chatId, bolehTanya: true } })) === 0) {
    return TIDAK_DITANGANI;
  }

  const frasa = parseFrasaDarurat((await getSetting('farmasi.darurat_keywords', '')) ?? '');
  const permintaan = deteksiPermintaanDarurat(msg.text, frasa);
  if (!permintaan.cocok) return TIDAK_DITANGANI;

  if (asal.jenis === 'grup' && (await kuotaGrupHabis(asal.chatId))) {
    logger.warn({ chatId: asal.chatId }, 'rekap darurat stok: kuota grup habis, tidak dijawab');
    return { ditangani: true, cabang: 'ketemu' };
  }

  const [bodyAda, bodyKosong, pakaiBatch] = await Promise.all([
    getSetting('farmasi.template_darurat', ''),
    getSetting('farmasi.template_darurat_kosong', ''),
    getSettingBool('farmasi.stok_pakai_batch', false),
  ]);

  const hasil = await susunPesanDarurat({
    kdJenis: null,
    // SEMUA barang. Yang bertanya sedang menyusun daftar pesanan; jawaban yang
    // dipotong justru menyembunyikan barang yang harus ikut dibeli hari itu.
    maxBaris: SEMUA_BARIS,
    pakaiBatch,
    bodyAda: bodyAda ?? '',
    /**
     * Gudang aman TIDAK boleh dijawab dengan diam.
     *
     * Jalur terjadwal memperlakukan "Pesan saat aman" yang kosong sebagai
     * sengaja diam, dan itu benar di sana. Di sini ada orang yang baru saja
     * bertanya, dan mendiamkannya membuat sistemnya tampak rusak -- alasan yang
     * sama persis dengan AUTO_REPLY yang melewati jam tenang.
     */
    bodyKosong: (bodyKosong ?? '').trim() || JAWABAN_GUDANG_AMAN,
    saatIni: new Date(),
  });

  if (!hasil.body?.trim()) {
    logger.info({ asal: jejakAsal(asal) }, 'rekap darurat stok: isi pesannya kosong, sengaja tidak menjawab');
    return { ditangani: true, cabang: 'kosong' };
  }

  const ctx = await loadAutoReplyContext(hasil.body);
  for (const [i, varsBagian] of hasil.bagian.entries()) {
    await enqueueMessage(
      {
        // Bagian pertama memakai kunci dasarnya apa adanya, sehingga
        // pemeriksaan penyerahan-ulang di pemanggil tetap menemukannya.
        idempotencyKey: turunkanKunciBagian(idempotencyKey, i),
        noRkmMedis: null,
        rawPhone: null,
        ...(asal.jenis === 'grup' ? { chatId: asal.chatId } : { phoneOverride: asal.phoneE164 }),
        eventAt: new Date(),
        vars: varsBagian,
      },
      ctx,
    );
  }

  logger.info(
    {
      asal: jejakAsal(asal),
      frasa: permintaan.frasa,
      total: hasil.ringkasan.total,
      bagian: hasil.bagian.length,
    },
    'rekap darurat stok terkirim ke antrean',
  );
  return { ditangani: true, cabang: hasil.ringkasan.total > 0 ? 'ketemu' : 'kosong' };
}

/**
 * Satu pintu untuk seluruh pertanyaan PERSEDIAAN, dan urutannya ditetapkan di
 * SINI saja.
 *
 * Dua pemanggil memakainya (perorangan lewat `handleInboundMessage`, grup lewat
 * `cobaBalasPersediaanDariGrup`), dan masing-masing menentukan urutannya sendiri
 * adalah persis bentuk kegagalan yang sudah dibayar di `respectsOptOut()` dan
 * `kunciPesanMasuk()`: cukup satu yang berbeda untuk membuat satu jalur
 * diam-diam berperilaku lain, tanpa satu pun galat.
 */
export async function cobaBalasPersediaan(
  msg: InboundMessage,
  idempotencyKey: string,
  asal?: AsalPertanyaan,
  adaAturanCocok?: PemeriksaAturan,
): Promise<HasilStokReply> {
  // Rekap darurat TIDAK ikut menyerah pada aturan: frasanya panjang dan
  // spesifik ("rekap stok", "stok menipis"), penanyanya wajib terdaftar, dan
  // tidak ada aturan buatan staf yang wajar bertabrakan dengannya.
  const rekap = await cobaBalasDarurat(msg, idempotencyKey, asal);
  if (rekap.ditangani) return rekap;
  return cobaBalasStok(msg, idempotencyKey, asal, adaAturanCocok);
}

/**
 * Cabang stok di dalam `handleInboundMessage`. Mengembalikan `ditangani: false`
 * bila pesannya bukan urusan stok, sehingga alur lanjut ke aturan kata kunci
 * biasa seperti sebelum fitur ini ada.
 */
export async function cobaBalasStok(
  msg: InboundMessage,
  idempotencyKey: string,
  asalMasuk?: AsalPertanyaan,
  adaAturanCocok?: PemeriksaAturan,
): Promise<HasilStokReply> {
  // Pemanggil lama (jalur perorangan di handleInboundMessage) tidak menyebut
  // asal -- diturunkan dari nomornya, hasilnya persis seperti sebelumnya.
  const asal: AsalPertanyaan = asalMasuk ?? {
    jenis: 'perorangan',
    chatId: `${msg.phoneE164}@c.us`,
    phoneE164: msg.phoneE164,
  };

  const mode = await bacaModeStok();
  if (mode === 'mati') return TIDAK_DITANGANI;

  /**
   * Pemeriksaan izin dikerjakan SEBELUM kata kunci dibaca, dan urutan itu
   * disengaja: nomor yang tidak berhak harus jatuh ke aturan kata kunci biasa
   * seolah fitur ini tidak ada. Membalikkannya berarti pertanyaan stok dari
   * nomor tak berhak "tertangani" lalu didiamkan -- dan aturan /balasan-otomatis
   * yang sebenarnya cocok tidak pernah sempat dijalankan.
   */
  const izin = await bolehBertanya(mode, asal);
  if (!izin.boleh) return TIDAK_DITANGANI;

  const ctxAwal = await loadAutoReplyContext('');
  // Angka sisa untuk yang TERDAFTAR (petugas/grup apotek), bentuk ringkas untuk
  // penanya umum yang lolos lewat mode 'semua'.
  const jawaban = await susunJawabanStok(
    msg.text,
    ctxAwal.identity,
    izin.terdaftar ? 'petugas' : 'umum',
    adaAturanCocok,
  );

  if (jawaban.aksi === 'lanjut') {
    /**
     * Dilepas ke aturan /balasan-otomatis. Dicatat HANYA bila kata tanya
     * ketersediaan sempat menjaring lalu gugur -- itu keadaan yang berguna saat
     * menelusuri ("kata kuncinya sudah kena, katalognya yang tidak menjawab").
     * Pesan yang memang tidak memuat kata kunci apa pun adalah lalu lintas
     * normal; mencatatnya membuat log dipenuhi baris yang tidak menandai apa
     * pun, dan sejak itu yang benar-benar berarti ikut tidak terbaca.
     */
    if (jawaban.sebab !== 'bukan_pertanyaan_stok') {
      logger.info(
        { asal: jejakAsal(asal), sebab: jawaban.sebab, cari: jawaban.cari },
        'pertanyaan ketersediaan dilepas ke aturan balasan otomatis',
      );
    }
    return TIDAK_DITANGANI;
  }

  /**
   * Kuota grup diperiksa SESUDAH terbukti ini memang pertanyaan stok.
   * Memeriksanya lebih dulu akan membuat obrolan grup yang ramai -- yang
   * sebagian besar bukan pertanyaan stok sama sekali -- ikut menghabiskan
   * jatah, lalu mendiamkan pertanyaan sungguhan yang datang sesudahnya.
   */
  if (asal.jenis === 'grup' && (await kuotaGrupHabis(asal.chatId))) {
    logger.warn({ chatId: asal.chatId }, 'balasan stok: kuota grup habis, tidak dijawab');
    return { ditangani: true, cabang: jawaban.cabang };
  }

  // Template yang dikosongkan admin = sengaja diam untuk cabang itu, sama
  // seperti `autoreply.fallback_body` yang kosong berarti tidak menjawab.
  // Tetap `ditangani`, supaya tidak jatuh ke aturan kata kunci yang akan
  // menjawab pertanyaan stok dengan sesuatu yang tidak berhubungan.
  if (!jawaban.body.trim()) {
    logger.info(
      { asal: jejakAsal(asal), cabang: jawaban.cabang },
      'balasan stok: template cabang ini kosong, sengaja tidak menjawab',
    );
    return { ditangani: true, cabang: jawaban.cabang };
  }

  const ctx = await loadAutoReplyContext(jawaban.body);
  await enqueueMessage(
    {
      idempotencyKey,
      noRkmMedis: null,
      rawPhone: null,
      // Grup dialamati lewat `chatId` (melewati resolvePhone, daftar tolak, dan
      // pemeriksaan pendaftaran WhatsApp -- ketiganya tidak berlaku untuk grup);
      // perorangan tetap lewat `phoneOverride` seperti sebelumnya.
      ...(asal.jenis === 'grup' ? { chatId: asal.chatId } : { phoneOverride: asal.phoneE164 }),
      eventAt: new Date(),
      // Body-nya sudah jadi; `vars` kosong supaya tidak dirender dua kali --
      // perenderan berulang persis yang dilarang aturan satu lintasan.
      vars: {},
    },
    ctx,
  );

  logger.info(
    { asal: jejakAsal(asal), cabang: jawaban.cabang, cari: jawaban.cari },
    'balasan stok obat terkirim ke antrean',
  );
  return { ditangani: true, cabang: jawaban.cabang };
}

/**
 * Titik masuk untuk pesan GRUP -- dipanggil dari pendengar `client.on('message')`.
 *
 * Dipisah dari `handleInboundMessage` karena jalur perorangan mengerjakan
 * beberapa hal yang sama sekali tidak berlaku di grup: permintaan berhenti
 * (berkunci pada nomor, sementara yang mengetik cuma salah satu peserta),
 * pencatatan `auto_reply_log` (kolom nomornya VARCHAR(20), tidak muat JID grup),
 * dan aturan kata kunci /balasan-otomatis (SENGAJA tidak berlaku di grup --
 * kata kuncinya jauh lebih longgar daripada kata kunci stok).
 *
 * Yang TETAP dikerjakan, karena keduanya berlaku di mana pun: pesan tanpa huruf
 * atau angka dilewati, dan penyerahan ulang pesan lama ditolak. whatsapp-web.js
 * menyerahkan ulang pesan lama setiap sesi dipulihkan; tanpa pemeriksaan ini,
 * satu restart worker bisa membanjiri grup dengan jawaban atas pertanyaan yang
 * sudah dijawab kemarin.
 */
export async function cobaBalasPersediaanDariGrup(
  pesan: PesanMasukBerkunci & { body: string | undefined },
): Promise<HasilStokReply> {
  // Kedua fitur diperiksa, bukan cuma balasan stok: keduanya punya sakelar
  // sendiri, dan apotek yang menyalakan rekap darurat tanpa balasan stok harus
  // tetap bisa bertanya dari grupnya.
  if ((await bacaModeStok()) === 'mati' && !(await daruratTanyaAktif())) return TIDAK_DITANGANI;

  const teks = pesan.body ?? '';
  if (!normalizeInbound(teks)) return TIDAK_DITANGANI;

  // `id._serialized` sering HILANG pada pesan grup -- lihat `kunciPesanMasuk()`
  // untuk sebabnya. Dulu di sini pesannya dilewati begitu saja, sehingga tidak
  // satu pun pertanyaan dari grup pernah dijawab.
  const waMessageId = kunciPesanMasuk(pesan);
  const idempotencyKey = buildIdempotencyKey('AUTO_REPLY', waMessageId);
  if (await Outbox.findOne({ where: { idempotencyKey }, attributes: ['id'] })) {
    logger.info({ from: pesan.from }, 'balasan stok grup: pesan yang sama diserahkan ulang, dilewati');
    return TIDAK_DITANGANI;
  }

  return cobaBalasPersediaan(
    // `phoneE164` diisi string kosong dan TIDAK pernah dipakai untuk grup --
    // jalur grup mengalamati lewat chatId. Bentuk InboundMessage dipertahankan
    // supaya kedua jalur memanggil fungsi yang sama persis.
    { waMessageId, phoneE164: '', text: teks },
    idempotencyKey,
    { jenis: 'grup', chatId: pesan.from, phoneE164: null },
  );
}
