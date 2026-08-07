import { Op } from 'sequelize';
import {
  Outbox,
  OptOut,
  Template,
  TemplateTarget,
  getSettingNumber,
  getSettingBool,
  getSettingJson,
  getSetting,
} from '@/models';
import type { OutboxStatus, TujuanMode } from '@/models';
import { turunkanKunciTujuan } from '@/core/idempotency';
import { isChatIdValid } from '@/core/farmasiTarget';
import { getHospitalIdentity, type HospitalIdentity } from '@/khanza/common';
import { renderTemplate, type TemplateVariable } from '@/core/template';
import { appendUniqueCode, buildUniqueCodeFooter, DEFAULT_UNIQUE_CODE_TEMPLATE } from '@/core/uniqueCode';
import { checkPrivacy } from '@/core/privacy';
import { computeScheduledAt } from '@/core/quietHours';
import { respectsOptOut } from '@/core/optOut';
import { resolvePhone } from './contactResolver';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * Konteks yang sama dipakai seluruh baris dalam satu siklus poller untuk satu
 * pemicu -- dimuat sekali per siklus (bukan per baris) supaya tidak membaca
 * app_setting/template berulang-ulang untuk ratusan baris yang sama.
 */
export interface PipelineContext {
  triggerCode: string;
  /** Bentuk minimal yang benar-benar dibaca di bawah -- baris Template asli maupun teks ad-hoc (BROADCAST) sama-sama cocok. */
  template: { body: string };
  genericTemplate: string;
  identity: HospitalIdentity;
  quietStart: number;
  quietEnd: number;
  sensitivePoli: string[];
  sensitiveExam: string[];
  /** Berlaku untuk SEMUA pemicu, termasuk BROADCAST -- lihat core/uniqueCode.ts. */
  uniqueCodeTemplate: string;
  /**
   * Penyebaran ke tujuan tambahan (migrations/018). ADA hanya untuk ketujuh
   * pemicu pasien -- ketiadaannya pada BROADCAST / AUTO_REPLY / farmasi bukan
   * kelalaian melainkan pernyataan: ketiganya sudah menentukan penerimanya
   * sendiri dan tidak punya "pasien" untuk disalin darinya.
   *
   * Sengaja bersarang alih-alih dua field datar bernilai default. Dua field
   * datar akan tampak berlaku untuk semua konteks, dan penulis konteks BARU
   * akan mengisinya tanpa memikirkan apakah penyebaran memang masuk akal di
   * sana -- persis jenis kesalahan diam yang sudah pernah terjadi lewat
   * `ctx.identity` yang ada tapi tidak pernah dibaca.
   */
  pemicuPasien?: {
    mode: TujuanMode;
    targets: TujuanTambahan[];
  };
}

/** Satu tujuan tambahan yang sudah siap pakai -- alamat dan namanya saja. */
export interface TujuanTambahan {
  chatId: string;
  label: string;
}

/**
 * Sakelar dan teks digabung jadi SATU nilai: template kosong sudah berarti
 * "tidak ada footer" di appendUniqueCode, jadi tidak perlu dua cabang terpisah
 * di enqueueMessage yang bisa tidak sinkron satu sama lain.
 */
export async function loadUniqueCodeTemplate(): Promise<string> {
  const [enabled, template] = await Promise.all([
    getSettingBool('dispatch.unique_code_enabled', true),
    getSetting('dispatch.unique_code_template', DEFAULT_UNIQUE_CODE_TEMPLATE),
  ]);
  return enabled ? (template ?? DEFAULT_UNIQUE_CODE_TEMPLATE) : '';
}

/**
 * Pratinjau dashboard (BROADCAST dan BROADCAST TERJADWAL) harus menampilkan
 * pesan yang SAMA dengan yang diterima pasien, termasuk baris kode unik yang
 * ditambahkan otomatis. Membaca pengaturan lewat fungsi yang sama dengan
 * enqueueMessage supaya pratinjau tidak bisa menyimpang dari kenyataan saat
 * pengaturannya diubah.
 *
 * @returns null bila fitur sedang dimatikan.
 */
export async function previewUniqueCodeFooter(seed: string): Promise<string | null> {
  // Waktu pratinjau = sekarang. Pesan sungguhan memakai waktu KIRIM-nya
  // sendiri, jadi angka di pratinjau memang bukan angka yang akan terkirim --
  // yang diperlihatkan adalah BENTUKNYA, supaya staf tahu baris ini akan ada.
  return buildUniqueCodeFooter(seed, await loadUniqueCodeTemplate(), new Date());
}

async function loadSharedSettings() {
  const [quietStart, quietEnd, sensitivePoli, sensitiveExam, genericTemplate, identity, uniqueCodeTemplate] = await Promise.all([
    getSettingNumber('dispatch.quiet_hours_start', 21),
    getSettingNumber('dispatch.quiet_hours_end', 7),
    getSettingJson<string[]>('privacy.sensitive_poli_codes', []),
    getSettingJson<string[]>('privacy.sensitive_exam_codes', []),
    getSetting('privacy.generic_template'),
    getHospitalIdentity(),
    loadUniqueCodeTemplate(),
  ]);
  return { quietStart, quietEnd, sensitivePoli, sensitiveExam, genericTemplate, identity, uniqueCodeTemplate };
}

export async function loadPipelineContext(triggerCode: string): Promise<PipelineContext | null> {
  const template = await Template.findByPk(triggerCode);
  if (!template || !template.isActive) return null;

  const shared = await loadSharedSettings();

  // Dimuat sekali per SIKLUS, bukan per baris -- sama seperti template dan
  // pengaturan di atasnya. Satu siklus pagi sibuk bisa berisi puluhan baris,
  // dan tujuannya sama untuk semuanya.
  const targets = await muatTujuanTambahan(triggerCode);

  return {
    triggerCode,
    template,
    genericTemplate: shared.genericTemplate ?? template.body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
    pemicuPasien: { mode: template.tujuanMode, targets },
  };
}

/**
 * Tujuan tambahan yang aktif untuk sebuah pemicu, sudah disaring dari alamat
 * yang tidak sah.
 *
 * `isChatIdValid()` di sini BUKAN pemeriksaan berulang yang mubazir walau
 * server action sudah memvalidasi saat menyimpan: nilainya pulang-pergi lewat
 * database, dan satu baris yang disunting lewat SQL mentah tidak melewati
 * server action mana pun. Alamat yang tidak sah tidak ditolak WhatsApp dengan
 * galat yang berguna -- ia menghasilkan baris gagal yang di halaman Antrean
 * terlihat persis seperti gangguan jaringan biasa.
 */
async function muatTujuanTambahan(triggerCode: string): Promise<TujuanTambahan[]> {
  const rows = await TemplateTarget.findAll({
    where: { triggerCode, isActive: true },
    order: [['id', 'ASC']],
  });

  const hasil: TujuanTambahan[] = [];
  for (const row of rows) {
    if (!isChatIdValid(row.chatId)) {
      logger.error(
        { triggerCode, targetId: row.id, label: row.label },
        'tujuan tambahan dilewati: alamatnya tidak berbentuk JID yang sah',
      );
      continue;
    }
    hasil.push({ chatId: row.chatId, label: row.label });
  }
  return hasil;
}

/**
 * Konteks untuk BROADCAST: staf memilih segmen pasien di dashboard lalu
 * mengetik isi pesan saat itu juga -- tidak ada baris `template` tersimpan
 * untuk dimuat lewat Template.findByPk seperti ketujuh pemicu lain. Tetap
 * memakai enqueueMessage() yang sama persis sesudah ini supaya privasi,
 * opt-out, jam tenang, dan idempotency identik dengan pemicu reaktif --
 * satu-satunya beda adalah ASAL isi pesan.
 */
export async function loadBroadcastContext(body: string): Promise<PipelineContext> {
  const shared = await loadSharedSettings();
  return {
    triggerCode: 'BROADCAST',
    template: { body },
    genericTemplate: shared.genericTemplate ?? body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

/**
 * Konteks untuk ADMINISTRASI: pengiriman DOKUMEN (surat keterangan sakit/sehat)
 * yang dipicu staf untuk satu pasien.
 *
 * Bentuknya mengikuti BROADCAST -- isi pesannya dari pengaturan, bukan dari
 * baris `template` -- tapi dengan satu perbedaan yang menentukan pada
 * `genericTemplate`: di sini ia TIDAK jatuh kembali ke `body`.
 *
 * Sebabnya: yang membuat sebuah pesan diganti template generik adalah poli
 * sensitif, dan pada pemicu lain penggantian itu cukup karena yang hilang cuma
 * beberapa kata. Di sini yang menyertai pesan adalah LAMPIRAN berisi identitas
 * lengkap pasien -- mengganti kalimat pengantarnya tidak menyembunyikan apa
 * pun selama berkasnya tetap ikut. Karena itu pemanggil (`administrasi/actions`)
 * memeriksa poli sensitif LEBIH DULU dan menolak mengirim, alih-alih
 * mengandalkan penggantian teks yang di sini tidak berarti apa-apa.
 */
export async function loadAdministrasiContext(
  body: string,
  /**
   * `SURAT_SAKIT` untuk pengiriman OTOMATIS, yang bedanya bukan kosmetik: kode
   * pemicu itulah yang menentukan apakah pesannya tunduk pada daftar tolak
   * (`core/optOut.ts`) dan apakah jam tenangnya dilewati (`core/quietHours.ts`).
   * Jalur manual boleh melewati keduanya karena ada staf yang menekan tombol
   * untuk satu pasien yang sedang menunggu; jalur otomatis tidak boleh, karena
   * di sana tidak ada siapa-siapa. Menumpang satu kode untuk dua perilaku
   * berarti kedua keputusan itu tidak bisa dipisahkan sama sekali.
   */
  triggerCode = 'ADMINISTRASI',
): Promise<PipelineContext> {
  const shared = await loadSharedSettings();
  return {
    triggerCode,
    template: { body },
    genericTemplate: shared.genericTemplate ?? body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

/**
 * Konteks untuk BALASAN OTOMATIS: isi pesannya berasal dari baris
 * `auto_reply_rule` yang cocok, bukan dari `template` maupun ketikan staf saat
 * itu juga. Sesudah ini tetap lewat enqueueMessage() yang sama seperti sembilan
 * pemicu lain -- kecuali satu hal: AUTO_REPLY TIDAK tunduk pada opt-out
 * (core/optOut.ts). Frasa yang dipakai pasien adalah "Berhenti Kirim Otomatis",
 * dan jawaban atas pesan yang ia kirim sendiri barusan bukan kiriman otomatis
 * -- mendiamkan orang yang baru saja bertanya membuat sistem tampak rusak, dan
 * bukan itu yang ia minta.
 */
export async function loadAutoReplyContext(body: string): Promise<PipelineContext> {
  const shared = await loadSharedSettings();
  return {
    triggerCode: 'AUTO_REPLY',
    template: { body },
    genericTemplate: shared.genericTemplate ?? body,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

/**
 * Konteks untuk NOTIFIKASI FARMASI. Isi pesannya dari `app_setting`
 * (`farmasi.template_*`), bukan dari tabel `template` -- tabel itu berisi tepat
 * tujuh baris yang dipilih worker lewat `Template.findByPk(triggerCode)` untuk
 * pesan ke PASIEN, dan menambahkan baris ke sana akan membuat halaman /template
 * menampilkan pesan yang penerimanya sama sekali berbeda di antara pesan pasien.
 *
 * Yang paling penting di sini adalah `genericTemplate`, dan ia SENGAJA bukan
 * `privacy.generic_template` seperti konteks lain: template generik itu ditulis
 * untuk pasien ("ada informasi dari rumah sakit, silakan hubungi kami") dan
 * sama sekali tidak berguna bagi apotek. Padanannya di sini tetap menyebut
 * nomor resep tapi tidak menyebut pasien maupun poli -- apotek tetap tahu ada
 * pekerjaan masuk, sementara keterkaitan seseorang dengan poli sensitif tidak
 * ikut terbaca sekian orang di dalam grup.
 */
export async function loadFarmasiContext(
  triggerCode: string,
  body: string,
  genericBody: string,
): Promise<PipelineContext> {
  const shared = await loadSharedSettings();
  return {
    triggerCode,
    template: { body },
    genericTemplate: genericBody,
    identity: shared.identity,
    quietStart: shared.quietStart,
    quietEnd: shared.quietEnd,
    sensitivePoli: shared.sensitivePoli,
    sensitiveExam: shared.sensitiveExam,
    uniqueCodeTemplate: shared.uniqueCodeTemplate,
  };
}

export interface EnqueueInput {
  idempotencyKey: string;
  /**
   * null hanya untuk AUTO_REPLY: yang mengirim pesan adalah sebuah NOMOR, dan
   * nomor itu belum tentu terhubung ke pasien mana pun di sik.
   */
  noRkmMedis: string | null;
  rawPhone: string | null;
  eventAt: Date;
  kdPoli?: string | null;
  kdJenisPrw?: string | string[] | null;
  vars: Partial<Record<TemplateVariable, string>>;
  /** Hanya diisi BROADCAST -- menautkan baris outbox ke broadcast_campaign asalnya. */
  campaignId?: number | null;
  /**
   * Nomor tujuan yang SUDAH pasti, melewati resolvePhone sepenuhnya.
   *
   * Dipakai AUTO_REPLY saja. Untuk sembilan pemicu lain, nomor tujuan adalah
   * hasil tebakan atas kolom `pasien.no_tlp` yang diketik bebas -- di situlah
   * resolvePhone bekerja. Untuk balasan otomatis, tujuannya adalah nomor yang
   * BARU SAJA mengirim pesan lewat WhatsApp: tidak ada yang perlu dinormalisasi
   * (WhatsApp sudah menyerahkannya dalam bentuk E.164), dan tidak ada pasien
   * yang boleh diklaim memilikinya. Melewatkannya ke resolvePhone justru akan
   * menulis baris patient_contact atas nama pasien yang belum tentu benar.
   */
  phoneOverride?: string | null;
  /**
   * Alamat tujuan LENGKAP (`120363xxx@g.us` / `628xxx@c.us`) untuk pesan yang
   * tidak berangkat dari nomor seorang pasien -- sejauh ini hanya notifikasi
   * farmasi ke grup/petugas apotek.
   *
   * Berbeda dari `phoneOverride`, yang tetap sebuah NOMOR PASIEN dan karena itu
   * ikut diperiksa terhadap daftar tolak serta pendaftaran WhatsApp. Yang ini
   * melewati keduanya dengan sengaja: sebuah grup tidak punya nomor untuk
   * dicocokkan ke `opt_out`, dan `getNumberId()` atas JID grup akan menjawab
   * "tidak terdaftar" lalu menandai barisnya gagal permanen -- notifikasi yang
   * tidak pernah sampai tanpa satu pun galat yang menyebut sebabnya.
   */
  chatId?: string | null;
  /**
   * Lampiran gambar/dokumen. Diisi HANYA oleh dua jalur, dan syaratnya sama
   * untuk keduanya: ADA STAF YANG MELIHATNYA sebelum menekan Kirim.
   *
   *   BROADCAST manual  berkas yang diunggah staf
   *   ADMINISTRASI      surat keterangan sakit/sehat yang dirender dari `sik`
   *
   * Pemicu otomatis, broadcast terjadwal, dan balasan otomatis sengaja TIDAK
   * punya jalur ini -- ketiganya mengirim tanpa peninjauan tiap kali, dan
   * berkas yang keliru jauh lebih sulit ditarik kembali daripada kalimat yang
   * keliru.
   */
  media?: { path: string; mime: string; name: string } | null;
}

/**
 * ARCHITECTURE §2 langkah [3]-[8]: RESOLVE -> NORMALIZE -> GATE -> PRIVACY ->
 * RENDER -> ENQUEUE. Sama untuk semua pemicu -- yang berbeda antar pemicu
 * hanya query sik (src/khanza/*.ts) dan pemetaan variabel template.
 */
export async function enqueueMessage(input: EnqueueInput, ctx: PipelineContext): Promise<void> {
  let phoneE164: string | null;
  if (input.chatId) {
    // Tujuan sudah berupa alamat lengkap, dan sengaja TIDAK menyentuh
    // resolvePhone: nomor pasiennya memang tidak relevan di sini, dan
    // melewatkannya ke sana justru akan menulis baris `patient_contact` atas
    // pasien yang pesannya bahkan tidak dikirim kepadanya.
    phoneE164 = null;
  } else if (input.phoneOverride) {
    phoneE164 = input.phoneOverride;
  } else if (input.noRkmMedis) {
    phoneE164 = (await resolvePhone(input.noRkmMedis, input.rawPhone)).phoneE164;
  } else {
    // Tanpa nomor pasti dan tanpa pasien untuk dicari nomornya, tidak ada
    // tujuan yang bisa ditentukan. Tetap dicatat sebagai baris outbox
    // skipped_no_contact di bawah, bukan dibuang diam-diam.
    phoneE164 = null;
  }

  const privacyCheck = checkPrivacy(
    { kdPoli: input.kdPoli, kdJenisPrw: input.kdJenisPrw },
    ctx.sensitivePoli,
    ctx.sensitiveExam,
  );

  /**
   * Identitas RS disisipkan DI SINI sebagai dasar, bukan diserahkan ke tiap
   * pemanggil.
   *
   * Sebelumnya `ctx.identity` ada di PipelineContext tapi tidak pernah dibaca
   * `enqueueMessage` sama sekali -- kelima pemanggil kebetulan menyisipkan
   * `identityVars()` sendiri ke `vars`, dan kebenarannya bergantung pada
   * kelimanya mengingat itu. Yang membuatnya berbahaya bukan pemicunya
   * melainkan TEMPLATE GENERIK: isinya ditulis admin di halaman Pengaturan dan
   * memang memuat `{nama_rs}`/`{kontak_rs}`, sementara ia menggantikan pesan
   * untuk jalur privasi mana pun -- termasuk pemicu baru yang penulisnya tidak
   * tahu kewajiban itu. Hasilnya pesan berbunyi "ada informasi dari ." tanpa
   * satu pun galat. Ditemukan lewat uji integrasi ini, bukan di produksi.
   *
   * `input.vars` tetap menimpa, jadi pemanggil yang sudah menyisipkannya
   * menghasilkan pesan yang sama persis seperti sebelumnya.
   */
  const vars = { ...identityVars(ctx.identity), ...input.vars };
  const rendered = renderTemplate(privacyCheck.safe ? ctx.template.body : ctx.genericTemplate, vars);

  // scheduledAt dihitung SEBELUM body, karena baris kode pengiriman memuat
  // {waktu} dan yang benar untuk diisikan adalah waktu KIRIM, bukan waktu
  // masuk antrean. Pesan yang muncul pukul 22.00 lalu ditahan jam tenang
  // sampai 07.00 harus menyebut 07.00 -- kalau tidak, pasien membaca stempel
  // sembilan jam sebelum pesannya benar-benar tiba.
  const scheduledAt = computeScheduledAt(input.eventAt, ctx.triggerCode, ctx.quietStart, ctx.quietEnd);

  // Kode unik disisipkan di sini (ENQUEUE), bukan di dispatcher (SEND),
  // supaya `outbox.body` tetap persis sama dengan yang benar-benar dikirim --
  // halaman Log menampilkan teks sungguhan, dan percobaan kirim ulang
  // mengirim teks yang identik alih-alih pesan yang tampak baru.
  const body = appendUniqueCode(rendered, input.idempotencyKey, ctx.uniqueCodeTemplate, scheduledAt);

  let status: OutboxStatus = 'pending';
  if (!phoneE164 && !input.chatId) {
    status = 'skipped_no_contact';
  } else if (phoneE164 && respectsOptOut(ctx.triggerCode) && (await OptOut.findByPk(phoneE164))) {
    // respectsOptOut() DILETAKKAN DI DEPAN pemeriksaan database, bukan
    // sesudahnya: untuk BROADCAST ke ratusan penerima, itu menghemat satu
    // query per baris yang hasilnya toh tidak dipakai.
    status = 'skipped_opt_out';
  }

  try {
    await Outbox.create(
      {
        idempotencyKey: input.idempotencyKey,
        triggerCode: ctx.triggerCode,
        campaignId: input.campaignId ?? null,
        noRkmMedis: input.noRkmMedis,
        phoneE164: phoneE164,
        chatId: input.chatId ?? null,
        body,
        mediaPath: input.media?.path ?? null,
        mediaMime: input.media?.mime ?? null,
        mediaName: input.media?.name ?? null,
        status,
        eventAt: input.eventAt,
        scheduledAt,
      },
      { ignoreDuplicates: true },
    );
  } catch (err) {
    logger.error(
      { triggerCode: ctx.triggerCode, noRkmMedis: input.noRkmMedis, phone: maskPhone(phoneE164), ...safeError(err) },
      'gagal enqueue satu baris outbox',
    );
  }
}

/**
 * Enqueue untuk KETUJUH PEMICU PASIEN, berikut penyebaran ke tujuan tambahan
 * (migrations/018). Dipakai ketiga tempat yang memicu pesan pasien --
 * `sisipCycle`, `pollerBooking`, `scheduler` -- supaya "ke mana pemicu ini
 * dikirim" dijawab di SATU tempat. Tiga tempat yang menafsirkannya sendiri
 * adalah persis bentuk kegagalan yang sudah dibayar di `respectsOptOut()`:
 * cukup satu yang lupa diperbarui untuk membuat satu pemicu diam-diam
 * berperilaku lain.
 *
 * Empat hal yang menempel di sini, dan semuanya AKIBAT, bukan pilihan bebas:
 *
 * 1. **Salinan ke tujuan tidak tunduk pada daftar tolak, dan itu terjadi
 *    sendirinya.** `enqueueMessage` hanya memeriksa `opt_out` bila ada
 *    `phone_e164`, sementara baris bertujuan `chat_id` memang tidak punya
 *    (§ EnqueueInput.chatId). Konsisten dengan notifikasi farmasi: seorang
 *    pasien tidak bisa memberhentikan koordinasi kerja internal rumah sakit.
 *    Yang HARUS disadari rumah sakit: pasien yang sudah minta berhenti tetap
 *    namanya muncul di grup, karena yang ia hentikan adalah pesan KEPADANYA.
 *
 * 2. **Jam tenang berlaku sama untuk salinan maupun aslinya.** Keduanya memakai
 *    `trigger_code` yang sama, jadi `computeScheduledAt` memberi `scheduled_at`
 *    yang sama. Membuat salinannya melewati jam tenang menuntut jam tenang
 *    per-penerima, dan itu perubahan yang jauh lebih besar daripada yang
 *    diminta di sini.
 *
 * 3. **Poli sensitif tetap dilindungi tanpa kode tambahan.** `checkPrivacy`
 *    berjalan di dalam `enqueueMessage` untuk setiap baris, jadi salinan ke
 *    grup ikut diganti template generik. Grup tahu ada informasi untuk seorang
 *    pasien, tanpa tahu layanan apa.
 *
 * 4. **`no_rkm_medis` tetap dicatat pada salinannya.** Tanpa itu, pencarian di
 *    halaman Antrean menemukan pesan pasiennya tapi tidak menemukan salinan
 *    yang dikirim ke grup -- dan pertanyaan "ke mana saja pesan ini pergi"
 *    justru itu yang perlu dijawab saat ada yang menelepon.
 */
export async function enqueuePemicuPasien(input: EnqueueInput, ctx: PipelineContext): Promise<void> {
  const sebar = ctx.pemicuPasien;

  // Konteks tanpa `pemicuPasien` berarti pemicu yang memang tidak punya tujuan
  // tambahan. Berperilaku persis seperti sebelum fitur ini ada.
  if (!sebar) {
    await enqueueMessage(input, ctx);
    return;
  }

  const kePasien = sebar.mode !== 'tujuan';
  const keTujuan = sebar.mode !== 'pasien';

  /**
   * Mode 'tujuan' tanpa satu pun tujuan aktif berarti pesannya TIDAK PERGI KE
   * MANA PUN. Bisa terjadi tanpa ada yang sengaja: tujuan terakhir
   * dinonaktifkan belakangan, atau alamatnya jadi tidak sah setelah disunting
   * lewat SQL. Tidak dijatuhkan kembali ke pasien -- rumah sakit sudah
   * memutuskan pesan ini bukan untuk pasien, dan membatalkan keputusan itu
   * diam-diam lebih buruk daripada tidak mengirim. Tapi juga tidak boleh
   * senyap, karena tidak ada satu pun baris outbox yang akan menandainya.
   */
  if (keTujuan && sebar.targets.length === 0 && !kePasien) {
    logger.error(
      { triggerCode: ctx.triggerCode, idempotencyKey: input.idempotencyKey },
      'pemicu disetel HANYA ke tujuan tambahan tapi tidak ada tujuan aktif -- pesan tidak dikirim ke mana pun',
    );
    return;
  }

  if (kePasien) {
    await enqueueMessage(input, ctx);
  }

  if (!keTujuan) return;

  for (const target of sebar.targets) {
    await enqueueMessage(
      {
        ...input,
        // Alamat lengkap -> enqueueMessage melewati resolvePhone, daftar tolak,
        // dan pemeriksaan pendaftaran WhatsApp. Lihat EnqueueInput.chatId.
        chatId: target.chatId,
        // WAJIB diturunkan berikut alamatnya. Memakai kunci yang sama untuk
        // pasien dan seluruh tujuan berarti hanya baris PERTAMA yang lolos
        // uq_idem, dan sisanya hilang tanpa galat (`ignoreDuplicates`).
        idempotencyKey: turunkanKunciTujuan(input.idempotencyKey, target.chatId),
      },
      ctx,
    );
  }
}

/** Variabel identitas RS yang sama untuk semua template (F3.2). */
export function identityVars(identity: HospitalIdentity): Partial<Record<TemplateVariable, string>> {
  return { nama_rs: identity.namaRs, alamat_rs: identity.alamatRs, kontak_rs: identity.kontakRs };
}

/**
 * Membuang baris yang kunci idempotennya SUDAH ada di `outbox`.
 *
 * `uq_idem` di mesin database tetap penjaga terakhirnya -- ini bukan
 * penggantinya. Yang dibeli penyaringan di depan adalah hal-hal yang telanjur
 * terjadi SEBELUM insert ditolak, dan tiap pemakainya membeli sesuatu yang beda:
 *
 *   BROADCAST_FOLLOWUP  baris `broadcast_campaign` yang mengaku punya penerima
 *                       padahal nol pesan baru masuk `outbox`.
 *   SURAT_SAKIT         satu peluncuran Chromium plus satu berkas PDF berisi
 *                       identitas pasien, untuk pesan yang toh ditolak. Jendela
 *                       pindainya membaca ulang surat yang sama tiap siklus
 *                       selama berhari-hari, jadi tanpa ini biayanya bukan
 *                       sekali melainkan ribuan kali.
 *
 * Dipakai bersama alih-alih disalin: bentuknya sepele, dan justru yang sepele
 * itulah yang paling gampang menyimpang tanpa ada yang memperhatikan.
 */
export async function saringKunciBaru<T>(rows: T[], kunci: (row: T) => string): Promise<T[]> {
  if (rows.length === 0) return rows;

  const existing = await Outbox.findAll({
    where: { idempotencyKey: { [Op.in]: rows.map(kunci) } },
    attributes: ['idempotencyKey'],
  });
  const sudah = new Set(existing.map((o) => o.idempotencyKey));
  return rows.filter((row) => !sudah.has(kunci(row)));
}
