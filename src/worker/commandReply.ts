import { Op } from 'sequelize';
import {
  AutoReplyRule,
  Outbox,
  WaCommandAdmin,
  WaCommandSession,
  parseKeywords,
  serializeKeywords,
  getSettingBool,
  getSettingNumber,
  logAudit,
} from '@/models';
import {
  parsePerintah,
  mulaiPerintah,
  lanjutkanWizard,
  isLangkah,
  varsBalasanApaAdanya,
  type DataWizard,
  type EfekPerintah,
  type HasilPerintah,
  type KeadaanWizard,
  type KonteksPerintah,
  type RingkasanAturan,
} from '@/core/waCommand';
import { matchRule } from '@/core/autoReply';
import { AUTOREPLY_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadAutoReplyContext, enqueueMessage } from './pipeline';
import { loadActiveRules, buildReplyVars } from './autoReply';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * PERINTAH LEWAT WHATSAPP -- sisi tak-murninya: izin, sesi, penulisan aturan,
 * dan pengiriman balasan.
 *
 * Seluruh keputusan "langkah berikutnya apa" ada di `core/waCommand.ts` dan
 * diuji tanpa database. Yang tinggal di sini hanya hal-hal yang memang menyentuh
 * dunia luar.
 *
 * Ini jalur pesan masuk PERTAMA yang menulis konfigurasi wakhanza. Tiga
 * pemeriksaan di bawah karena itu bukan kelengkapan melainkan syarat, dan
 * masing-masing menutup kegagalan yang tidak bergejala. Uraian lengkapnya di
 * migrations/045_perintah_wa.sql.
 */

/**
 * Kode pemicu SENDIRI, bukan menumpang AUTO_REPLY, dan alasannya terukur bukan
 * estetis: `kuotaGrupHabis()` di `stokReply.ts` menghitung
 * `trigger_code='AUTO_REPLY'` + `chat_id` untuk membatasi balasan stok per grup.
 * Menumpang berarti percakapan wizard di grup apotek memakan jatah pertanyaan
 * stok grup itu -- pertanyaan sungguhan lalu didiamkan karena seseorang sedang
 * menyusun aturan, tanpa satu pun galat yang menyebut sebabnya.
 *
 * Konsekuensi yang ikut, dan keduanya sudah didaftarkan: kode ini WAJIB ada di
 * `BYPASS_QUIET_HOURS` (ada orang yang sedang menunggu jawaban atas pesannya
 * sendiri -- alasan yang sama persis dengan AUTO_REPLY dan ADMINISTRASI), dan
 * SENGAJA TIDAK ada di `OPT_OUT_TRIGGERS` (penerimanya staf, bukan nomor
 * pasien; tidak ada yang bisa "berhenti berlangganan" dari percakapan yang ia
 * mulai sendiri).
 */
export const TRIGGER_WA_PERINTAH = 'WA_PERINTAH';

export interface PesanPerintahMasuk {
  /** Alamat obrolan: `628xxx@c.us` atau `120363xxx@g.us`. */
  chatId: string;
  /**
   * Peserta yang mengetik. Untuk grup ini `message.author`; untuk obrolan
   * perorangan diisi `chatId` supaya bentuk kunci sesinya seragam.
   */
  pengirimId: string;
  waMessageId: string;
  teks: string;
  jenis: 'perorangan' | 'grup';
  /** null untuk grup, dan untuk perorangan yang nomornya gagal dipetakan. */
  phoneE164: string | null;
}

export interface HasilPerintahWa {
  /** true = pesan ini sudah jadi urusan perintah; jangan lanjut ke stok/aturan. */
  ditangani: boolean;
  sebab?: 'mati' | 'tak_berwenang' | 'bukan_perintah' | 'diserahkan_ulang' | 'dijawab';
}

const TIDAK_DITANGANI: HasilPerintahWa = { ditangani: false, sebab: 'bukan_perintah' };

/** Nomor perorangan disamarkan (§9.7); JID grup ditulis apa adanya -- ia alamat grup kerja. */
function jejak(pesan: PesanPerintahMasuk): string {
  return pesan.jenis === 'grup' ? pesan.chatId : maskPhone(pesan.phoneE164 ?? '');
}

/**
 * Balasan wizard bukan template, tapi tetap melewati `renderTemplate()` di
 * dalam `enqueueMessage`. `varsBalasanApaAdanya()` membuat perenderan itu jadi
 * operasi identitas -- lihat alasan lengkapnya (dan dua cara ia rusak tanpa
 * itu) di `core/waCommand.ts`.
 */
async function kirimBalasan(pesan: PesanPerintahMasuk, teks: string): Promise<void> {
  const ctx = { ...(await loadAutoReplyContext(teks)), triggerCode: TRIGGER_WA_PERINTAH };
  await enqueueMessage(
    {
      idempotencyKey: buildIdempotencyKey(TRIGGER_WA_PERINTAH, pesan.waMessageId),
      noRkmMedis: null,
      rawPhone: null,
      ...(pesan.jenis === 'grup' ? { chatId: pesan.chatId } : { phoneOverride: pesan.phoneE164 }),
      eventAt: new Date(),
      vars: varsBalasanApaAdanya(teks),
    },
    ctx,
  );
}

async function bacaKonteks(): Promise<KonteksPerintah> {
  const rows = await AutoReplyRule.findAll({ order: [['priority', 'ASC'], ['id', 'ASC']] });
  const aturan: RingkasanAturan[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    keywords: parseKeywords(r.keywords),
    matchMode: r.matchMode,
    priority: r.priority,
    isActive: r.isActive,
  }));
  return {
    aturan,
    aktifLangsung: await getSettingBool('autoreply.wa_tambah_aktif_langsung', false),
    variabelDikenal: AUTOREPLY_TEMPLATE_VARIABLES,
  };
}

/**
 * Sesi yang masih berlaku untuk (obrolan, pengirim). Yang kedaluwarsa DIHAPUS
 * lalu diperlakukan seolah tidak pernah ada -- bukan dijawab "sesi habis".
 * Orang yang menulis pesan tak berhubungan setengah jam kemudian tidak sedang
 * menunggu kabar tentang wizard yang sudah dilupakannya, dan menjawabnya
 * berarti menelan pesan yang seharusnya jatuh ke penanganan biasa.
 */
async function bacaSesi(pesan: PesanPerintahMasuk): Promise<WaCommandSession | null> {
  const sesi = await WaCommandSession.findOne({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId },
  });
  if (!sesi) return null;

  const menit = await getSettingNumber('autoreply.wa_sesi_timeout_menit', 10);
  if (menit > 0 && Date.now() - sesi.updatedAt.getTime() > menit * 60 * 1000) {
    await sesi.destroy();
    logger.debug({ asal: jejak(pesan) }, 'perintah wa: sesi kedaluwarsa, dibuang');
    return null;
  }

  // Langkah yang tidak dikenal hanya lahir dari suntingan SQL langsung. Sesinya
  // dibuang alih-alih menjatuhkan penanganan pesan masuk untuk semua orang --
  // pola yang sama dengan parseKeywords() atas JSON rusak.
  if (!isLangkah(sesi.langkah)) {
    logger.warn({ asal: jejak(pesan), langkah: sesi.langkah }, 'perintah wa: langkah sesi tidak dikenal, sesi dibuang');
    await sesi.destroy();
    return null;
  }
  return sesi;
}

function bacaData(sesi: WaCommandSession): DataWizard {
  try {
    const parsed: unknown = JSON.parse(sesi.dataJson);
    return parsed && typeof parsed === 'object' ? (parsed as DataWizard) : {};
  } catch {
    return {};
  }
}

async function simpanSesi(pesan: PesanPerintahMasuk, keadaan: KeadaanWizard): Promise<void> {
  const sekarang = new Date();
  const [sesi, baru] = await WaCommandSession.findOrCreate({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId },
    defaults: {
      chatId: pesan.chatId,
      pengirimId: pesan.pengirimId,
      langkah: keadaan.langkah,
      dataJson: JSON.stringify(keadaan.data),
      lastWaId: pesan.waMessageId,
      createdAt: sekarang,
      updatedAt: sekarang,
    },
  });
  if (!baru) {
    await sesi.update({
      langkah: keadaan.langkah,
      dataJson: JSON.stringify(keadaan.data),
      lastWaId: pesan.waMessageId,
      updatedAt: sekarang,
    });
  }
}

async function hapusSesi(pesan: PesanPerintahMasuk): Promise<void> {
  await WaCommandSession.destroy({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId },
  });
}

/**
 * Menjalankan efek dan mengembalikan balasan yang benar-benar dikirim.
 *
 * Pelaku dicatat `wa:<alamat>` -- sengaja dibedakan dari username staf
 * dashboard, dari `cli:<akun OS>`, dan dari `system:broadcast_schedule:<id>`.
 * Yang ditelusuri belakangan bukan cuma "aturan ini berubah" melainkan "lewat
 * jalur mana", karena hanya jalur inilah yang tidak punya sesi login di
 * belakangnya.
 */
async function jalankanEfek(
  efek: EfekPerintah,
  pesan: PesanPerintahMasuk,
  balasan: string,
): Promise<string> {
  const pelaku = `wa:${pesan.pengirimId}`;

  switch (efek.jenis) {
    case 'simpan_baru': {
      const dibuat = await AutoReplyRule.create({
        label: efek.label,
        keywords: serializeKeywords(efek.keywords),
        matchMode: 'contains',
        body: efek.body,
        priority: 100,
        isActive: efek.aktif,
        createdBy: pelaku,
        updatedBy: null,
      });
      await logAudit(pelaku, 'auto_reply_rule_create', String(dibuat.id), efek.label);
      return balasan;
    }

    case 'hapus': {
      const row = await AutoReplyRule.findByPk(efek.id);
      if (!row) return 'Aturan itu sudah tidak ada. Tidak ada yang dihapus.';
      await row.destroy();
      await logAudit(pelaku, 'auto_reply_rule_delete', String(efek.id), efek.label);
      return balasan;
    }

    case 'ubah': {
      const row = await AutoReplyRule.findByPk(efek.id);
      if (!row) return 'Aturan itu sudah tidak ada. Tidak ada yang diubah.';
      await row.update({
        ...(efek.label !== undefined ? { label: efek.label } : {}),
        ...(efek.keywords !== undefined ? { keywords: serializeKeywords(efek.keywords) } : {}),
        ...(efek.body !== undefined ? { body: efek.body } : {}),
        ...(efek.aktif !== undefined ? { isActive: efek.aktif } : {}),
        updatedBy: pelaku,
        updatedAt: new Date(),
      });
      await logAudit(pelaku, 'auto_reply_rule_update', String(efek.id), row.label);
      return balasan;
    }

    case 'uji':
      return susunHasilUji(efek.kalimat);
  }
}

/**
 * `/uji` -- memakai `matchRule()` dan `buildReplyVars()` yang SAMA PERSIS
 * dipakai worker saat membalas pasien sungguhan, seperti kotak uji coba di
 * dashboard. Pratinjau yang berbeda dari kenyataan lebih buruk daripada tanpa
 * pratinjau.
 *
 * TIDAK menulis apa pun: bukan baris outbox untuk aturannya, bukan
 * `auto_reply_log`, dan tidak memakan kuota nomor mana pun. Yang terkirim cuma
 * satu balasan berisi hasilnya.
 */
async function susunHasilUji(kalimat: string): Promise<string> {
  const hit = matchRule(kalimat, await loadActiveRules());
  if (!hit) {
    return `*Uji:* "${kalimat}"\n\nTidak ada aturan aktif yang cocok. Pasien akan menerima pesan cadangan, atau tidak dijawab sama sekali kalau pesan cadangan dikosongkan.`;
  }
  const ctx = await loadAutoReplyContext(hit.rule.body);
  const teks = renderTemplate(hit.rule.body, await buildReplyVars(hit.rule.body, kalimat, ctx.identity));
  return `*Uji:* "${kalimat}"\n\nDijawab aturan *${hit.rule.label}* (kata kunci "${hit.keyword}").\n\n---\n${teks}`;
}

/**
 * Titik masuk dari `wa-client.ts`, untuk jalur perorangan MAUPUN grup.
 *
 * Dipanggil SEBELUM `handleInboundMessage` dan sebelum cabang persediaan, dan
 * ketiga urutannya perlu:
 *
 *   * **Sebelum `handleInboundMessage`**, bukan di dalamnya, karena sakelarnya
 *     berdiri sendiri: RS harus bisa menyusun aturan lewat WhatsApp SEBELUM
 *     menyalakan `autoreply.enabled`. Di dalam, ia akan mati bersama fungsi itu
 *     pada baris pertamanya.
 *
 *   * **Sebelum cabang persediaan**, karena cabang itu selalu menjawab begitu
 *     kata kuncinya kena. Nama aturan atau isi balasan yang kebetulan memuat
 *     kata "harga" akan ditelan sebagai pencarian obat, dan jawabannya adalah
 *     daftar katalog di tengah percakapan wizard.
 *
 *   * **Sesudah permintaan berhenti**, yang tetap diperiksa paling dulu di
 *     `wa-client.ts`. Frasanya tiga kata dan praktis mustahil terketik sebagai
 *     jawaban wizard, tapi urutannya tetap tidak boleh dibalik: aturan apa pun
 *     yang ditulis staf tidak boleh bisa menyandera permintaan berhenti.
 */
export async function cobaPerintahWa(pesan: PesanPerintahMasuk): Promise<HasilPerintahWa> {
  if (!(await getSettingBool('autoreply.wa_perintah_enabled', false))) {
    return { ditangani: false, sebab: 'mati' };
  }

  const perintah = parsePerintah(pesan.teks);
  const sesiAda = await WaCommandSession.count({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId },
  });
  // Bukan perintah DAN tidak ada percakapan berjalan -- lalu lintas biasa.
  // Diperiksa dengan hitungan murah lebih dulu supaya setiap pesan masuk yang
  // sama sekali tak berhubungan tidak membaca baris sesi maupun daftar putih.
  if (!perintah && sesiAda === 0) return TIDAK_DITANGANI;

  /**
   * Izin diperiksa SEBELUM apa pun dijawab, dan yang tidak berwenang DIDIAMKAN
   * -- pesannya jatuh ke penanganan biasa seolah fitur ini tidak ada.
   *
   * Bukan kesopanan: menjawab "Anda tidak berwenang" memberi tahu setiap pasien
   * yang kebetulan mengetik garis miring bahwa perintah semacam ini ada, dan
   * nama perintahnya bisa ditebak dari situ. Pola yang sama dipakai
   * `bolehBertanya()` pada balasan stok.
   *
   * Diperiksa juga untuk sesi yang SEDANG berjalan, bukan cuma saat memulai:
   * alamat yang dicabut wewenangnya di tengah percakapan harus berhenti
   * dilayani saat itu juga.
   */
  const berwenang = await WaCommandAdmin.count({ where: { chatId: pesan.chatId, isActive: true } });
  if (berwenang === 0) return { ditangani: false, sebab: 'tak_berwenang' };

  /**
   * Penyerahan ulang, lapis pertama. whatsapp-web.js menyerahkan ulang pesan
   * lama setiap sesi dipulihkan; tanpa ini, satu restart worker memajukan
   * wizard beberapa langkah sekaligus memakai jawaban kemarin -- dan pada
   * langkah terakhir itu berarti aturan tersimpan dua kali.
   */
  const kunci = buildIdempotencyKey(TRIGGER_WA_PERINTAH, pesan.waMessageId);
  if (await Outbox.findOne({ where: { idempotencyKey: kunci }, attributes: ['id'] })) {
    logger.info({ asal: jejak(pesan) }, 'perintah wa: pesan yang sama diserahkan ulang, dilewati');
    return { ditangani: true, sebab: 'diserahkan_ulang' };
  }

  const sesi = await bacaSesi(pesan);

  // Lapis kedua, dan ia menangkap yang lolos dari lapis pertama: langkah yang
  // keadaannya sudah tersimpan tapi balasannya gagal masuk outbox. Tanpa ini,
  // pesan yang sama pada percobaan berikutnya memajukan wizard sekali lagi.
  if (sesi && sesi.lastWaId === pesan.waMessageId) {
    logger.info({ asal: jejak(pesan) }, 'perintah wa: langkah ini sudah diproses, dilewati');
    return { ditangani: true, sebab: 'diserahkan_ulang' };
  }

  if (!perintah && !sesi) return TIDAK_DITANGANI;

  const ctx = await bacaKonteks();

  /**
   * Perintah baru di tengah percakapan MENGGANTIKAN yang sedang berjalan, tidak
   * ditolak. Orang yang mengetik `/daftar` di tengah wizard sedang berpindah
   * pikiran, dan menjawab "selesaikan dulu yang tadi" berarti ia harus mengingat
   * perintah pembatalannya sebelum boleh melakukan apa pun.
   */
  const hasil: HasilPerintah = perintah
    ? mulaiPerintah(perintah, ctx, sesi !== null)
    : lanjutkanWizard({ langkah: sesi!.langkah as KeadaanWizard['langkah'], data: bacaData(sesi!) }, pesan.teks, ctx);

  let balasan = hasil.aksi === 'selesai' && hasil.efek ? await jalankanEfek(hasil.efek, pesan, hasil.balasan) : hasil.balasan;

  if (hasil.aksi === 'selesai') {
    await hapusSesi(pesan);
  } else {
    // Keadaan disimpan SEBELUM balasannya dienqueue, dan urutan itu disengaja:
    // kalau enqueue gagal, yang terjadi adalah staf tidak menerima pertanyaan
    // berikutnya lalu mengulang perintahnya -- bisa diperbaiki sendiri. Urutan
    // sebaliknya menghasilkan pertanyaan yang terkirim untuk langkah yang tidak
    // pernah tersimpan, dan jawabannya lalu dibaca sebagai jawaban langkah
    // SEBELUMNYA.
    await simpanSesi(pesan, hasil.keadaan);
  }

  if (!balasan.trim()) {
    // Tidak pernah terjadi lewat jalur yang ada -- satu-satunya `balasan` kosong
    // milik efek `uji`, dan `jalankanEfek` selalu menggantinya. Dijaga di sini
    // karena balasan kosong akan tersimpan sebagai baris outbox berisi hanya
    // baris kode pengiriman, dan itu terbaca sebagai sistem rusak.
    balasan = 'Perintah selesai.';
  }

  await kirimBalasan(pesan, balasan);
  logger.info(
    { asal: jejak(pesan), perintah: perintah?.jenis ?? 'lanjutan', aksi: hasil.aksi },
    'perintah wa diproses',
  );
  return { ditangani: true, sebab: 'dijawab' };
}

/**
 * Pembungkus yang tidak pernah melempar -- dipanggil dari pendengar event
 * whatsapp-web.js, tempat satu pesan aneh dari satu obrolan tidak boleh
 * menjatuhkan penanganan pesan masuk untuk semua orang.
 *
 * Kegagalan dilaporkan `ditangani: false` sehingga pesannya tetap sempat
 * dicoba jalur biasa: kalau memang bukan perintah, ia tetap terlayani.
 */
export async function cobaPerintahWaSafely(pesan: PesanPerintahMasuk): Promise<HasilPerintahWa> {
  try {
    return await cobaPerintahWa(pesan);
  } catch (err) {
    logger.error({ asal: jejak(pesan), ...safeError(err) }, 'perintah wa gagal diproses');
    return { ditangani: false };
  }
}

/**
 * Pembersihan berkala. Sesi yang ditinggalkan tidak berbahaya (dibuang saat
 * dibaca), tapi tanpa pemangkasan tabelnya tumbuh satu baris per percakapan
 * yang pernah dibatalkan di tengah dan tidak pernah menyusut.
 */
export async function pangkasSesiPerintah(sebelum: Date): Promise<number> {
  return WaCommandSession.destroy({ where: { updatedAt: { [Op.lt]: sebelum } } });
}
