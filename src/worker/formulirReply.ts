import { Op } from 'sequelize';
import {
  Outbox,
  PatientContact,
  WaCommandSession,
  WaForm,
  WaFormEntry,
  WaFormField,
  WaFormTarget,
  parseKeywords,
  getSettingBool,
  getSettingNumber,
} from '@/models';
import { bacaRincian, susunPemberitahuanFormulir } from '@/core/waFormulirTujuan';
import {
  cocokFormulir,
  mulaiFormulir,
  lanjutkanFormulir,
  isTipeField,
  type FieldFormulir,
  type HasilFormulir,
  type KeadaanFormulir,
  type RingkasanFormulir,
} from '@/core/waFormulir';
import { varsApaAdanya } from '@/core/template';
import type { MatchMode } from '@/core/autoReply';
import { buildIdempotencyKey, turunkanKunciTujuan } from '@/core/idempotency';
import { loadAutoReplyContext, enqueueMessage } from './pipeline';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * FORMULIR LEWAT WHATSAPP -- sisi tak-murninya: sakelar, sesi, kuota, penautan
 * nomor ke pasien, penulisan `wa_form_entry`, dan pengiriman balasan.
 *
 * Seluruh keputusan "pertanyaan berikutnya apa" ada di `core/waFormulir.ts` dan
 * diuji tanpa database.
 *
 * Ini jalur pesan masuk pertama yang menyimpan DATA YANG DIKETIK PASIEN, dan
 * satu-satunya yang terbuka untuk setiap nomor -- 045 masih dijaga daftar putih
 * `wa_command_admin`. Uraian lengkapnya di migrations/051_formulir.sql.
 */

/**
 * Kode pemicu SENDIRI, dan ketiga akibatnya sudah didaftarkan:
 *
 *   * WAJIB di `BYPASS_QUIET_HOURS` -- ini balasan atas pesan yang pasiennya
 *     sendiri kirim barusan, dan ia sedang memegang ponselnya menunggu
 *     pertanyaan berikutnya. Ditahan sampai pukul 07.00, percakapan bertahap
 *     berhenti jadi percakapan: pasien menerima "Pertanyaan 2 dari 4" sembilan
 *     jam kemudian, saat sesinya sendiri sudah lama kedaluwarsa.
 *   * SENGAJA TIDAK di `OPT_OUT_TRIGGERS` -- alasan yang sama persis dengan
 *     AUTO_REPLY: yang dihentikan pasien adalah kiriman OTOMATIS, dan ini
 *     percakapan yang ia mulai sendiri.
 *   * TIDAK menumpang AUTO_REPLY, karena `kuotaGrupHabis()` di `stokReply.ts`
 *     menghitung `trigger_code='AUTO_REPLY'` + `chat_id`. Menumpang berarti
 *     pengisian formulir di sebuah grup memakan jatah pertanyaan stok grup itu,
 *     lalu pertanyaan sungguhan didiamkan tanpa satu pun galat.
 */
export const TRIGGER_FORMULIR = 'FORMULIR';

/**
 * Pemberitahuan ke TUJUAN sebuah formulir (053) -- grup/petugas yang
 * menindaklanjuti, bukan pasien.
 *
 * Kode SENDIRI, tidak menumpang `FORMULIR` di atasnya, dan ketiga akibatnya
 * berlawanan arah sehingga menumpang berarti salah pada ketiganya sekaligus:
 *
 *   * **Penerimanya berbeda jenis.** `FORMULIR` pergi ke pasien; yang ini ke
 *     alamat yang dipasang admin. Satu kode berarti halaman Antrean dan Log
 *     tidak bisa lagi membedakan "balasan ke pasien" dari "salinan ke grup",
 *     dan itu justru pembedaan yang paling perlu terbaca saat menelusuri ke
 *     mana sebuah pesan pergi.
 *   * **Kuota grup dihitung per `trigger_code` + `chat_id`** (`kuotaGrupHabis()`
 *     di `stokReply.ts`). Menumpang berarti pemberitahuan ke sebuah grup
 *     memakan jatah percakapan formulir grup itu -- alasan yang sama persis
 *     yang membuat `FORMULIR` dulu tidak menumpang `AUTO_REPLY`.
 *   * **Kunci idempotennya berangkat dari hal yang berbeda.** `FORMULIR`
 *     berkunci pada `waMessageId` (satu langkah percakapan); yang ini pada
 *     `wa_form_entry.id` (satu permintaan yang selesai). Berbagi kode berarti
 *     kedua ruang kunci itu bertumpuk di kolom `uq_idem` yang sama.
 *
 * SENGAJA tidak di `OPT_OUT_TRIGGERS`: yang bisa meminta berhenti adalah
 * pasien, dan pasien bukan penerima pesan ini. Permintaan berhentinya tetap
 * menghentikan `FORMULIR` yang memang ditujukan kepadanya.
 */
export const TRIGGER_FORMULIR_MASUK = 'FORMULIR_MASUK';

/** Sesi formulir memakai tabel wizard yang sama, dibedakan kolom `jenis`. */
const JENIS_SESI = 'formulir';

/**
 * Satu-satunya langkah yang dipunyai mesin ini -- keadaan sesungguhnya ada di
 * `data_json`. Ditulis eksplisit alih-alih dikosongkan supaya baris mentahnya
 * tetap terbaca saat seseorang membuka tabelnya lewat `mysql`.
 */
const LANGKAH = 'isi';

export interface PesanFormulirMasuk {
  /** Alamat obrolan: `628xxx@c.us` atau `120363xxx@g.us`. */
  chatId: string;
  /** Peserta yang mengetik; untuk perorangan diisi `chatId` supaya kunci sesinya seragam. */
  pengirimId: string;
  waMessageId: string;
  teks: string;
  jenis: 'perorangan' | 'grup';
  /** null untuk grup, dan untuk perorangan yang nomornya gagal dipetakan. */
  phoneE164: string | null;
}

export interface HasilFormulirWa {
  /** true = pesan ini sudah jadi urusan formulir; jangan lanjut ke stok/aturan. */
  ditangani: boolean;
  sebab?: 'mati' | 'bukan_formulir' | 'diserahkan_ulang' | 'kuota' | 'dijawab' | 'batal' | 'tersimpan';
}

const TIDAK_DITANGANI: HasilFormulirWa = { ditangani: false, sebab: 'bukan_formulir' };

/** Nomor perorangan disamarkan (§9.7); JID grup ditulis apa adanya. */
function jejak(pesan: PesanFormulirMasuk): string {
  return pesan.jenis === 'grup' ? pesan.chatId : maskPhone(pesan.phoneE164 ?? '');
}

// ---------------------------------------------------------------------------
// Pembacaan
// ---------------------------------------------------------------------------

function bacaPilihan(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/**
 * Formulir aktif berikut pertanyaannya, DUA query bukan join.
 *
 * Join akan menggandakan baris formulirnya sebanyak pertanyaannya lalu dibuang
 * lagi di sisi Node; dua query terhadap tabel konfigurasi kecil di `wakhanza`
 * (bukan `sik`, yang kolamnya sengaja dibatasi dua koneksi) lebih murah DAN
 * menghasilkan bentuk yang langsung dipakai.
 *
 * `bolehGrup` disaring DI SINI, bukan di pemanggil: formulir yang tidak boleh
 * diisi dari grup harus benar-benar tidak ikut dicocokkan, bukan dicocokkan
 * lalu ditolak -- yang kedua membuat pesan grup "tertangani" lalu didiamkan,
 * sehingga cabang persediaan di bawahnya tidak pernah sempat menjawabnya.
 *
 * DIEKSPOR untuk `commandReply.ts`, yang menyebutkan formulir apa saja yang bisa
 * diisi dari sebuah alamat di `/bantuan`. Dipakai bersama, bukan disalin, dengan
 * alasan yang sama yang membuat `izinTanyaStok()`/`izinTanyaDarurat()` diekspor
 * dari `stokReply.ts`: bantuan yang menurunkan sendiri "formulir mana yang
 * berlaku di sini" cepat atau lambat menyimpang dari yang benar-benar
 * dicocokkan, dan yang menyimpang akan menyuruh orang mengetik sesuatu yang
 * tidak dijawab apa pun.
 */
export async function bacaFormulirAktif(dariGrup: boolean): Promise<RingkasanFormulir[]> {
  const forms = await WaForm.findAll({
    where: { isActive: true, ...(dariGrup ? { bolehGrup: true } : {}) },
    order: [['priority', 'ASC'], ['id', 'ASC']],
  });
  if (forms.length === 0) return [];

  const fields = await WaFormField.findAll({
    where: { formId: { [Op.in]: forms.map((f) => f.id) } },
    order: [['urutan', 'ASC'], ['id', 'ASC']],
  });

  const perForm = new Map<number, FieldFormulir[]>();
  for (const f of fields) {
    // Tipe yang tidak dikenal hanya lahir dari suntingan SQL langsung. Dijatuhkan
    // ke 'teks' alih-alih membuang pertanyaannya: pertanyaan yang hilang diam-diam
    // menghasilkan catatan yang tidak lengkap tanpa ada yang tahu, sementara teks
    // bebas selalu bisa dibaca staf.
    const tipe = isTipeField(f.tipe) ? f.tipe : 'teks';
    const daftar = perForm.get(f.formId) ?? [];
    daftar.push({
      id: f.id,
      label: f.label,
      tipe,
      wajib: f.wajib,
      pilihan: bacaPilihan(f.pilihanJson),
      maksPanjang: f.maksPanjang,
    });
    perForm.set(f.formId, daftar);
  }

  return forms.map((f) => ({
    id: f.id,
    nama: f.nama,
    keywords: parseKeywords(f.kataKunci),
    matchMode: (f.matchMode === 'exact' ? 'exact' : 'contains') as MatchMode,
    priority: f.priority,
    pesanPembuka: f.pesanPembuka,
    pesanPenutup: f.pesanPenutup,
    fields: perForm.get(f.id) ?? [],
  }));
}

/**
 * Sesi formulir yang masih berlaku. Yang kedaluwarsa DIHAPUS lalu diperlakukan
 * seolah tidak pernah ada -- bukan dijawab "sesi habis". Orang yang menulis
 * pesan tak berhubungan sejam kemudian tidak sedang menunggu kabar tentang
 * formulir yang sudah dilupakannya, dan menjawabnya berarti menelan pesan yang
 * seharusnya jatuh ke penanganan biasa.
 */
async function bacaSesi(pesan: PesanFormulirMasuk): Promise<WaCommandSession | null> {
  const sesi = await WaCommandSession.findOne({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId, jenis: JENIS_SESI },
  });
  if (!sesi) return null;

  const menit = await getSettingNumber('formulir.sesi_timeout_menit', 30);
  if (menit > 0 && Date.now() - sesi.updatedAt.getTime() > menit * 60 * 1000) {
    await sesi.destroy();
    logger.debug({ asal: jejak(pesan) }, 'formulir: sesi kedaluwarsa, dibuang');
    return null;
  }
  return sesi;
}

/**
 * Keadaan dari `data_json`. Bentuk yang tidak dikenali mengembalikan null, dan
 * pemanggil membuang sesinya -- pola yang sama dengan `parseKeywords()` atas
 * JSON rusak: satu baris yang rusak membatalkan DIRINYA SENDIRI, bukan
 * menjatuhkan penanganan pesan masuk untuk semua orang.
 */
function bacaKeadaan(sesi: WaCommandSession): KeadaanFormulir | null {
  try {
    const parsed: unknown = JSON.parse(sesi.dataJson);
    if (!parsed || typeof parsed !== 'object') return null;
    const k = parsed as KeadaanFormulir;
    if (typeof k.formId !== 'number' || !Array.isArray(k.pertanyaan) || !Array.isArray(k.jawaban)) {
      return null;
    }
    return k;
  } catch {
    return null;
  }
}

async function simpanSesi(pesan: PesanFormulirMasuk, keadaan: KeadaanFormulir): Promise<void> {
  const sekarang = new Date();
  /**
   * `where` SENGAJA tanpa `jenis`, sementara `jenis` ada di `defaults` dan di
   * pembaruannya. Kunci uniknya (chat_id, pengirim_id) tanpa jenis, jadi `where`
   * yang menyertakan `jenis` akan gagal menemukan sesi PERINTAH milik orang yang
   * sama lalu mencoba menyisipkan baris kedua -- dan menabrak kunci unik itu.
   *
   * Dengan bentuk ini, memulai formulir di tengah wizard perintah MENGGANTIKAN
   * wizardnya, yaitu perilaku yang sama yang sudah berlaku antar perintah sejak
   * 045: orangnya sedang berpindah pikiran.
   */
  const [sesi, baru] = await WaCommandSession.findOrCreate({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId },
    defaults: {
      chatId: pesan.chatId,
      pengirimId: pesan.pengirimId,
      jenis: JENIS_SESI,
      langkah: LANGKAH,
      dataJson: JSON.stringify(keadaan),
      lastWaId: pesan.waMessageId,
      createdAt: sekarang,
      updatedAt: sekarang,
    },
  });
  if (!baru) {
    await sesi.update({
      jenis: JENIS_SESI,
      langkah: LANGKAH,
      dataJson: JSON.stringify(keadaan),
      lastWaId: pesan.waMessageId,
      updatedAt: sekarang,
    });
  }
}

async function hapusSesi(pesan: PesanFormulirMasuk): Promise<void> {
  await WaCommandSession.destroy({
    where: { chatId: pesan.chatId, pengirimId: pesan.pengirimId, jenis: JENIS_SESI },
  });
}

// ---------------------------------------------------------------------------
// Kuota dan penautan pasien
// ---------------------------------------------------------------------------

function awalHariIni(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Kuota per nomor per hari -- pengganti daftar putih yang tidak bisa dipasang di
 * fitur ini tanpa membatalkan gunanya (formulir yang cuma bisa diisi orang
 * terdaftar bukan formulir pasien).
 *
 * Dihitung dari entry yang SELESAI, bukan dari percakapan yang dimulai: orang
 * yang membatalkan di tengah, atau yang sesinya kedaluwarsa, tidak sedang
 * menyalahgunakan apa pun.
 *
 * Diperiksa saat MEMULAI, bukan saat menyimpan. Terbalik, pasien mengisi seluruh
 * pertanyaan lalu ditolak di akhir -- menghabiskan waktunya untuk sesuatu yang
 * sudah bisa diketahui di kalimat pertama.
 *
 * Grup dilewati: kuotanya berkunci pada NOMOR, dan pesan grup tidak punya satu.
 */
async function kuotaHabis(pesan: PesanFormulirMasuk): Promise<boolean> {
  if (!pesan.phoneE164) return false;
  const maks = await getSettingNumber('formulir.maks_per_nomor_per_hari', 3);
  if (maks <= 0) return false;
  const jumlah = await WaFormEntry.count({
    where: { phoneE164: pesan.phoneE164, createdAt: { [Op.gte]: awalHariIni() } },
  });
  return jumlah >= maks;
}

/**
 * No. RM pemilik nomor ini, atau null.
 *
 * Dibaca dari `patient_contact` di `wakhanza` lewat indeks `ix_phone` -- BUKAN
 * dari `sik`, yang kolamnya sengaja dibatasi dua koneksi dan yang tidak punya
 * indeks pada nomor telepon sama sekali.
 *
 * Nomor yang menunjuk LEBIH DARI SATU pasien mengembalikan null, bukan yang
 * pertama: satu nomor keluarga lazim dipakai beberapa pasien, dan menebak salah
 * satunya menghasilkan catatan yang menempel pada orang yang salah -- lebih
 * buruk daripada catatan tanpa no. RM, yang setidaknya jujur bahwa staf harus
 * menanyakannya. Pelajaran `detectPoli()` yang mengembalikan null saat ambigu.
 */
async function tautkanPasien(phoneE164: string | null): Promise<string | null> {
  if (!phoneE164) return null;
  const cocok = await PatientContact.findAll({
    where: { phoneE164 },
    attributes: ['noRkmMedis'],
    limit: 2,
  });
  return cocok.length === 1 ? cocok[0]!.noRkmMedis : null;
}

// ---------------------------------------------------------------------------
// Pengiriman
// ---------------------------------------------------------------------------

/**
 * Balasan formulir bukan template, tapi tetap melewati `renderTemplate()` di
 * dalam `enqueueMessage`. `varsApaAdanya()` membuat perenderan itu jadi operasi
 * identitas -- alasan lengkapnya di `core/template.ts`.
 *
 * Di sini taruhannya LEBIH tinggi daripada di 045: sebagian isi balasan ini
 * adalah teks yang DIKETIK PASIEN dan diulang kembali di ringkasan penutup.
 * Tanpa itu, pasien yang mengetik `{kontak_rs}` sebagai jawaban akan menerima
 * nomor telepon rumah sakit di posisi jawabannya sendiri -- dan yang lebih
 * buruk, `{apa pun}` yang tidak dikenal diganti string KOSONG sehingga
 * jawabannya lenyap dari ringkasan yang seharusnya membuktikan apa yang
 * tercatat.
 */
async function kirimBalasan(pesan: PesanFormulirMasuk, teks: string): Promise<void> {
  const ctx = { ...(await loadAutoReplyContext(teks)), triggerCode: TRIGGER_FORMULIR };
  await enqueueMessage(
    {
      idempotencyKey: buildIdempotencyKey(TRIGGER_FORMULIR, pesan.waMessageId),
      noRkmMedis: null,
      rawPhone: null,
      ...(pesan.jenis === 'grup' ? { chatId: pesan.chatId } : { phoneOverride: pesan.phoneE164 }),
      eventAt: new Date(),
      vars: varsApaAdanya(teks),
    },
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Titik masuk
// ---------------------------------------------------------------------------

/**
 * Dipanggil dari `wa-client.ts` SESUDAH `cobaPerintahWa` dan SEBELUM
 * `handleInboundMessage`. Ketiga posisinya perlu:
 *
 *   * **Sesudah permintaan berhenti**, yang tetap diperiksa paling dulu. Kata
 *     kunci yang ditulis staf tidak boleh bisa menyandera permintaan berhenti.
 *
 *   * **Sesudah perintah (045)**, karena garis miring adalah niat yang tidak
 *     ambigu: admin yang mengetik `/daftar` di tengah pengisian formulir sedang
 *     berpindah pikiran, bukan menjawab pertanyaan. Pasien biasa tidak terkena
 *     apa pun -- ia tidak pernah lolos daftar putih `wa_command_admin`, jadi
 *     pesannya jatuh ke sini seolah fitur itu tidak ada.
 *
 *   * **Sebelum `handleInboundMessage`**, dan ini yang paling menentukan: cabang
 *     persediaan di dalamnya SELALU menjawab begitu kata kuncinya kena. Jawaban
 *     pasien atas "obat apa yang dibutuhkan?" hampir pasti memuat kata yang
 *     dijaring cabang itu, dan tanpa urutan ini ia ditelan jadi pencarian
 *     katalog -- pasien menerima daftar harga di tengah formulir, dan langkahnya
 *     tidak pernah maju.
 */
export async function cobaFormulirWa(pesan: PesanFormulirMasuk): Promise<HasilFormulirWa> {
  if (!(await getSettingBool('formulir.enabled', false))) {
    return { ditangani: false, sebab: 'mati' };
  }

  const sesi = await bacaSesi(pesan);

  /**
   * Penyerahan ulang, lapis pertama. whatsapp-web.js menyerahkan ulang pesan
   * lama setiap sesi dipulihkan; tanpa ini, satu restart worker memajukan
   * formulir beberapa langkah sekaligus memakai jawaban kemarin -- dan pada
   * pertanyaan terakhir itu berarti satu permintaan tersimpan dua kali.
   */
  const kunci = buildIdempotencyKey(TRIGGER_FORMULIR, pesan.waMessageId);
  if (sesi || cocokKasar(pesan)) {
    if (await Outbox.findOne({ where: { idempotencyKey: kunci }, attributes: ['id'] })) {
      logger.info({ asal: jejak(pesan) }, 'formulir: pesan yang sama diserahkan ulang, dilewati');
      return { ditangani: true, sebab: 'diserahkan_ulang' };
    }
  }

  // Lapis kedua: langkah yang keadaannya sudah tersimpan tapi balasannya gagal
  // masuk outbox. Tanpa ini, pesan yang sama pada percobaan berikutnya memajukan
  // formulir sekali lagi.
  if (sesi && sesi.lastWaId === pesan.waMessageId) {
    logger.info({ asal: jejak(pesan) }, 'formulir: langkah ini sudah diproses, dilewati');
    return { ditangani: true, sebab: 'diserahkan_ulang' };
  }

  let hasil: HasilFormulir;

  if (sesi) {
    const keadaan = bacaKeadaan(sesi);
    if (!keadaan) {
      logger.warn({ asal: jejak(pesan) }, 'formulir: keadaan sesi tidak terbaca, sesi dibuang');
      await hapusSesi(pesan);
      return TIDAK_DITANGANI;
    }
    hasil = lanjutkanFormulir(keadaan, pesan.teks);
  } else {
    const daftar = await bacaFormulirAktif(pesan.jenis === 'grup');
    const form = cocokFormulir(pesan.teks, daftar);
    if (!form) return TIDAK_DITANGANI;

    if (await kuotaHabis(pesan)) {
      logger.info({ asal: jejak(pesan), formulir: form.nama }, 'formulir: kuota nomor habis');
      await kirimBalasan(
        pesan,
        `Permintaan Anda hari ini sudah kami terima dan sedang diproses.\n\nUntuk hal mendesak, hubungi langsung petugas kami.`,
      );
      return { ditangani: true, sebab: 'kuota' };
    }

    hasil = mulaiFormulir(form);
    // Formulir tanpa pertanyaan sudah disaring `cocokFormulir()`; ini lapis
    // kedua, dan diam adalah perilaku yang benar -- pesannya jatuh ke penanganan
    // biasa seolah formulir ini tidak ada.
    if (hasil.aksi === 'batal' && !hasil.balasan) return TIDAK_DITANGANI;
  }

  if (hasil.aksi === 'selesai') {
    await simpanEntry(pesan, hasil.simpan);
    await hapusSesi(pesan);
  } else if (hasil.aksi === 'batal') {
    await hapusSesi(pesan);
  } else {
    /**
     * Keadaan disimpan SEBELUM balasannya dienqueue, dan urutan itu disengaja:
     * kalau enqueue gagal, yang terjadi adalah pasien tidak menerima pertanyaan
     * berikutnya lalu mengetik lagi -- bisa diperbaiki sendiri. Urutan
     * sebaliknya menghasilkan pertanyaan yang terkirim untuk langkah yang tidak
     * pernah tersimpan, dan jawabannya lalu dibaca sebagai jawaban langkah
     * SEBELUMNYA.
     */
    await simpanSesi(pesan, hasil.keadaan);
  }

  await kirimBalasan(pesan, hasil.balasan);
  logger.info({ asal: jejak(pesan), aksi: hasil.aksi }, 'formulir diproses');
  return { ditangani: true, sebab: hasil.aksi === 'selesai' ? 'tersimpan' : hasil.aksi === 'batal' ? 'batal' : 'dijawab' };
}

/**
 * Menulis satu baris `wa_form_entry`.
 *
 * Nama formulir dan seluruh pertanyaannya sudah DIBEKUKAN di dalam `simpan`,
 * jadi baris ini tetap terbaca utuh sesudah formulirnya disunting atau dihapus.
 */
async function simpanEntry(
  pesan: PesanFormulirMasuk,
  simpan: { formId: number; nama: string; jawaban: Array<{ pertanyaan: string; jawaban: string }> },
): Promise<void> {
  const noRkmMedis = await tautkanPasien(pesan.phoneE164);
  const baris = await WaFormEntry.create({
    formId: simpan.formId,
    formNama: simpan.nama,
    chatId: pesan.chatId,
    pengirimId: pesan.pengirimId,
    phoneE164: pesan.phoneE164,
    noRkmMedis,
    jawabanJson: JSON.stringify(simpan.jawaban),
    status: 'baru',
    catatan: null,
    ditanganiOleh: null,
    ditanganiAt: null,
  });
  logger.info(
    { asal: jejak(pesan), formulir: simpan.nama, entryId: baris.id, tertaut: noRkmMedis !== null },
    'formulir tersimpan',
  );

  await kabarkanKeTujuan(baris, pesan, simpan.jawaban);
}

/**
 * Mengabarkan satu jawaban yang baru tersimpan ke tujuan formulirnya (053).
 *
 * ==========================================================================
 * Dipanggil SESUDAH barisnya tersimpan, dan urutan itu mengikat
 * ==========================================================================
 *
 * Kalau pengabaran gagal, yang terjadi adalah permintaan yang tercatat rapi di
 * dashboard tapi tidak dikabarkan -- keadaan yang sama persis dengan sebelum
 * 053 ada, dan yang bisa ditemukan siapa pun yang membuka `/formulir`. Urutan
 * sebaliknya menghasilkan grup yang dikabari tentang permintaan yang tidak
 * pernah tersimpan, lalu mencarinya di dashboard dan tidak menemukan apa pun.
 *
 * TIDAK PERNAH melempar, dengan alasan yang lebih keras daripada di
 * `catatPesanMasuk()`: yang memanggilnya sudah menulis `wa_form_entry` DAN
 * sudah akan mengirim kalimat penutup ke pasien. Galat yang lolos dari sini
 * membatalkan keduanya di mata pemanggil, sehingga pasien yang permintaannya
 * SUDAH tersimpan menerima galat alih-alih kalimat penutupnya.
 *
 * Tanpa satu pun tujuan aktif, fungsi ini tidak mengirim apa pun -- yaitu
 * perilaku 051 apa adanya. Daftar tujuannya sendiri yang jadi sakelar; lihat
 * (3) di migrations/053.
 */
async function kabarkanKeTujuan(
  baris: WaFormEntry,
  pesan: PesanFormulirMasuk,
  jawaban: readonly { pertanyaan: string; jawaban: string }[],
): Promise<void> {
  try {
    const tujuan = await WaFormTarget.findAll({
      where: { formId: baris.formId, isActive: true },
      order: [['id', 'ASC']],
    });
    if (tujuan.length === 0) return;

    const form = await WaForm.findByPk(baris.formId, { attributes: ['tujuanRincian'] });
    /**
     * Formulir yang sudah DIHAPUS sementara tujuannya masih ada: jatuh ke
     * `ringkas` lewat `bacaRincian(undefined)`, bukan dilewati. Barisnya tetap
     * layak dikabarkan -- nama formulir dan seluruh pertanyaannya sudah
     * dibekukan ke dalamnya, jadi yang hilang cuma setelan rinciannya.
     */
    const rincian = bacaRincian(form?.tujuanRincian);

    const teks = susunPemberitahuanFormulir(
      {
        formNama: baris.formNama,
        waktu: baris.createdAt,
        phoneE164: baris.phoneE164,
        dariGrup: pesan.jenis === 'grup',
        jawaban,
      },
      rincian,
    );

    /**
     * Berkunci pada `wa_form_entry.id`, bukan `waMessageId`: yang dikabarkan
     * adalah satu PERMINTAAN YANG SELESAI, dan id barisnya satu-satunya
     * penanda yang tetap benar sekalipun pesan terakhirnya diserahkan ulang
     * whatsapp-web.js sesudah sesi dipulihkan.
     */
    const kunci = buildIdempotencyKey(TRIGGER_FORMULIR_MASUK, baris.id);
    const ctx = { ...(await loadAutoReplyContext(teks)), triggerCode: TRIGGER_FORMULIR_MASUK };

    for (const t of tujuan) {
      await enqueueMessage(
        {
          // Alamat tujuan WAJIB masuk kunci -- tanpa itu seluruh tujuan berbagi
          // satu kunci dan hanya yang pertama yang lolos `uq_idem`, tanpa satu
          // pun galat karena INSERT-nya memang `ignoreDuplicates`.
          idempotencyKey: turunkanKunciTujuan(kunci, t.chatId),
          /**
           * null, walau `baris.noRkmMedis` ada di tangan. Mengisinya menautkan
           * baris `outbox` yang isinya SENGAJA tanpa no. RM (lihat
           * `core/waFormulirTujuan.ts`) kepada seorang pasien di halaman
           * Antrean/Log -- tautan yang tidak pernah diminta siapa pun dan yang
           * membatalkan separuh gunanya pagar di sana.
           */
          noRkmMedis: null,
          rawPhone: null,
          chatId: t.chatId,
          eventAt: new Date(),
          // Teks yang diketik PASIEN ikut di dalamnya. Tanpa varsApaAdanya,
          // `{kontak_rs}` yang diketik pasien akan diganti nomor rumah sakit,
          // dan `{apa pun}` yang tak dikenal diganti string kosong -- jawabannya
          // lenyap dari pesan yang seharusnya membuktikan apa yang tercatat.
          vars: varsApaAdanya(teks),
        },
        ctx,
      );
    }

    logger.info(
      { formulir: baris.formNama, entryId: baris.id, tujuan: tujuan.length, rincian },
      'jawaban formulir dikabarkan ke tujuan',
    );
  } catch (err) {
    logger.error(
      { asal: jejak(pesan), entryId: baris.id, ...safeError(err) },
      'gagal mengabarkan jawaban formulir ke tujuan -- barisnya tetap tersimpan dan terlihat di dashboard',
    );
  }
}

/**
 * Penjaring murah untuk memutuskan apakah pemeriksaan penyerahan-ulang perlu
 * dijalankan sama sekali.
 *
 * Sengaja LONGGAR dan sengaja bukan pencocokan sungguhan: yang dihindari cuma
 * satu query `outbox` untuk setiap pesan masuk yang sama sekali tak berhubungan.
 * Pesan tanpa satu pun huruf atau angka tidak pernah bisa memicu formulir apa
 * pun, karena `normalizeInbound()` menjadikannya string kosong dan `matchRule()`
 * menolak string kosong di baris pertamanya.
 */
function cocokKasar(pesan: PesanFormulirMasuk): boolean {
  return /[a-z0-9]/i.test(pesan.teks);
}

/**
 * Pembungkus yang tidak pernah melempar -- dipanggil dari pendengar event
 * whatsapp-web.js, tempat satu pesan aneh dari satu obrolan tidak boleh
 * menjatuhkan penanganan pesan masuk untuk semua orang.
 *
 * Kegagalan dilaporkan `ditangani: false` sehingga pesannya tetap sempat dicoba
 * jalur biasa.
 */
export async function cobaFormulirWaSafely(pesan: PesanFormulirMasuk): Promise<HasilFormulirWa> {
  try {
    return await cobaFormulirWa(pesan);
  } catch (err) {
    logger.error({ asal: jejak(pesan), ...safeError(err) }, 'formulir gagal diproses');
    return { ditangani: false };
  }
}

/**
 * Pemangkasan berkala menurut `formulir.simpan_hari`.
 *
 * Isinya diketik pasien dan bisa memuat keluhan; tabel ini bukan rekam medis dan
 * ikut tercadangkan. Masa simpannya karena itu setelan tersendiri, bukan
 * `retention.days` bersama -- lihat migrations/051.
 */
export async function pangkasEntryFormulir(): Promise<number> {
  const hari = await getSettingNumber('formulir.simpan_hari', 90);
  if (hari <= 0) return 0;
  const batas = new Date(Date.now() - hari * 24 * 60 * 60 * 1000);
  return WaFormEntry.destroy({ where: { createdAt: { [Op.lt]: batas } } });
}
