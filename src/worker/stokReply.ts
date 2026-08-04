import { Op } from 'sequelize';
import { FarmasiTarget, Outbox, getSetting, getSettingNumber } from '@/models';
import { deteksiPermintaanStok, parseStokKeywords, formatStokObat } from '@/core/stokObat';
import { normalizeInbound } from '@/core/autoReply';
import { buildIdempotencyKey } from '@/core/idempotency';
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
 * (`120363232637249779@g.us`) 24 karakter -- MariaDB non-strict memotongnya
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
 * Menyusun jawaban untuk sebuah pertanyaan stok. FUNGSI YANG SAMA dipakai kotak
 * uji coba di dashboard -- yang membedakan cuma pengirimannya.
 *
 * @returns null bila pesannya bukan pertanyaan stok sama sekali.
 */
export async function susunJawabanStok(
  teks: string,
  identity: { namaRs: string; alamatRs: string; kontakRs: string },
  /**
   * Tampilkan ANGKA sisa stok, bukan sekadar "tersedia"/"kosong".
   *
   * Ditentukan oleh SIAPA YANG BERTANYA, bukan oleh mode. Sebuah grup apotek
   * yang sudah dicentang `boleh_tanya` adalah petugas menurut definisinya
   * sendiri, dan ia tetap petugas walau modenya `semua` -- mode itu mengatur
   * apakah orang luar boleh ikut bertanya lewat japri, bukan menurunkan derajat
   * grup kerja yang terdaftar. Mengikat ini ke mode akan membuat apotek
   * kehilangan angka persediaannya begitu RS membuka layanan untuk umum.
   */
  tampilkanJumlah?: boolean,
): Promise<{ body: string; cabang: 'ketemu' | 'kosong' | 'tanpa_nama'; cari: string } | null> {
  const keywords = parseStokKeywords((await getSetting('farmasi.stok_keywords', 'stok,harga')) ?? '');
  const permintaan = deteksiPermintaanStok(teks, keywords);
  if (!permintaan.cocok) return null;

  const vars = { ...identityVars(identity), cari_obat: permintaan.cari };

  if (!permintaan.cari) {
    const body = (await getSetting('farmasi.stok_template_tanpa_nama', '')) ?? '';
    return { body: renderDenganVars(body, vars), cabang: 'tanpa_nama', cari: '' };
  }

  const maks = await getSettingNumber('farmasi.stok_max_hasil', 5);
  const hargaDipakai = (await getSetting('farmasi.stok_harga', 'jualbebas')) === 'ralan' ? 'ralan' : 'jualbebas';

  // maks + 1 dibaca supaya "ada yang terpotong" bisa dibedakan dari "kebetulan
  // pas" -- pola yang sama dipakai jadwal dokter.
  const rows = await cariStokObat(permintaan.cari, maks + 1);

  if (rows.length === 0) {
    const body = (await getSetting('farmasi.stok_template_kosong', '')) ?? '';
    return { body: renderDenganVars(body, vars), cabang: 'kosong', cari: permintaan.cari };
  }

  const ditampilkan = rows.slice(0, maks);
  const daftar = formatStokObat(ditampilkan, {
    // Angka persediaan hanya untuk petugas. Bagi penanya umum yang perlu
    // diketahui adalah perlu-tidaknya ia datang, bukan berapa banyak sisa di
    // gudang -- itu informasi dagang apotek. Tanpa keterangan pemanggil
    // (mis. kotak uji coba di dashboard), diturunkan dari mode seperti semula.
    tampilkanJumlah: tampilkanJumlah ?? (await bacaModeStok()) === 'petugas',
    hargaDipakai,
    truncatedFrom: rows.length,
  });

  const body = (await getSetting('farmasi.stok_template', '')) ?? '';
  return { body: renderDenganVars(body, { ...vars, stok_obat: daftar }), cabang: 'ketemu', cari: permintaan.cari };
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

/**
 * Cabang stok di dalam `handleInboundMessage`. Mengembalikan `ditangani: false`
 * bila pesannya bukan urusan stok, sehingga alur lanjut ke aturan kata kunci
 * biasa seperti sebelum fitur ini ada.
 */
export async function cobaBalasStok(
  msg: InboundMessage,
  idempotencyKey: string,
  asalMasuk?: AsalPertanyaan,
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
  // Angka sisa untuk yang TERDAFTAR (petugas/grup apotek), tanpa angka untuk
  // penanya umum yang lolos lewat mode 'semua'.
  const jawaban = await susunJawabanStok(msg.text, ctxAwal.identity, izin.terdaftar);
  if (!jawaban) return TIDAK_DITANGANI;

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
export async function cobaBalasStokDariGrup(pesan: {
  id: { _serialized?: string } | undefined;
  from: string;
  body: string | undefined;
}): Promise<HasilStokReply> {
  if (await bacaModeStok() === 'mati') return TIDAK_DITANGANI;

  const teks = pesan.body ?? '';
  if (!normalizeInbound(teks)) return TIDAK_DITANGANI;

  const waMessageId = pesan.id?._serialized;
  if (!waMessageId) {
    logger.warn({ from: pesan.from }, 'balasan stok grup: pesan tanpa id, dilewati');
    return TIDAK_DITANGANI;
  }

  const idempotencyKey = buildIdempotencyKey('AUTO_REPLY', waMessageId);
  if (await Outbox.findOne({ where: { idempotencyKey }, attributes: ['id'] })) {
    logger.info({ from: pesan.from }, 'balasan stok grup: pesan yang sama diserahkan ulang, dilewati');
    return TIDAK_DITANGANI;
  }

  return cobaBalasStok(
    // `phoneE164` diisi string kosong dan TIDAK pernah dipakai untuk grup --
    // jalur grup mengalamati lewat chatId. Bentuk InboundMessage dipertahankan
    // supaya kedua jalur memanggil fungsi yang sama persis.
    { waMessageId, phoneE164: '', text: teks },
    idempotencyKey,
    { jenis: 'grup', chatId: pesan.from, phoneE164: null },
  );
}
