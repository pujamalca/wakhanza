import { Op } from 'sequelize';
import { Outbox, OptOut, AppSetting } from '@/models';
import { db } from '@/db/wakhanza';
import { sik } from '@/db/sik';
import type { TujuanMode } from '@/models';
import { turunkanKunciTujuan } from '@/core/idempotency';
import { enqueueMessage, enqueuePemicuPasien, saringKunciBaruPemicuPasien, type PipelineContext, type TujuanTambahan } from './pipeline';

/**
 * Uji integrasi `enqueueMessage()` -- satu-satunya jalur yang dilewati KEEMPAT
 * kelas pemicu (sisip, pindai, broadcast, balasan otomatis).
 *
 * Sampai berkas ini ada, seluruh 14 suite uji proyek ini menguji `src/core/`
 * saja: fungsi murni yang tidak menyentuh database. Bagian yang menggabungkan
 * semuanya -- gerbang opt-out, penggantian privasi, penundaan jam tenang,
 * penolakan duplikat oleh UNIQUE KEY, dan penyisipan kode pengiriman -- hanya
 * pernah divalidasi manual, satu per satu, setiap kali ada yang berubah. Itu
 * yang membuat tiap perubahan pada pipeline mahal, dan itu pula alasan bug
 * seperti "percobaan habis ditulis dengan status yang salah" bisa bertahan.
 *
 * Menulis ke database `wakhanza` SUNGGUHAN dengan sengaja: yang perlu
 * dibuktikan justru perilaku terhadap skema, grant, dan UNIQUE KEY yang
 * benar-benar berlaku. Setiap baris diberi tanda `TANDA` pada
 * `idempotency_key` dan dibersihkan sendiri.
 */

const TANDA = 'INTTEST';
const NOMOR_UJI = '628000000001';

/** Nomor yang dipakai menguji gerbang opt-out. Dibersihkan di afterAll. */
const NOMOR_OPTOUT = '628000000002';

/**
 * JID grup uji untuk `enqueuePemicuPasien` (R7). Nol berurut -- jelas fiktif,
 * tidak pernah dipakai grup sungguhan.
 *
 * Dibersihkan lewat `chatId`, BUKAN lewat pola `TANDA|%` pada idempotency_key:
 * kunci turunan per tujuan di-HASH ULANG (`turunkanKunciTujuan`), bukan
 * disambung, jadi tidak memuat `TANDA` sama sekali. Baris berkode dasar
 * `TANDA|...` tetap tersaring seperti biasa; ini menambah jalur kedua khusus
 * untuk salinannya.
 */
const GRUP_UJI_A = '120363000000000001@g.us';
const GRUP_UJI_B = '120363000000000002@g.us';

function ctx(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    triggerCode: 'QUEUE_REG',
    template: { body: 'Halo {nama_pasien}, antrean Anda {no_antrian} di {nama_poli}.' },
    genericTemplate: 'Bpk/Ibu {nama_pasien}, ada informasi dari {nama_rs}. Silakan hubungi kami.',
    identity: { namaRs: 'RS Uji', alamatRs: 'Jl. Uji 1', kontakRs: '021-000' },
    quietStart: 21,
    quietEnd: 7,
    sensitivePoli: [],
    sensitiveExam: [],
    uniqueCodeTemplate: 'Kode Pengiriman : {waktu} {kode}',
    ...over,
  };
}

let nomorUrut = 0;
function kunci(nama: string): string {
  return `${TANDA}|${nama}|${++nomorUrut}`;
}

async function ambil(idempotencyKey: string): Promise<Outbox | null> {
  return Outbox.findOne({ where: { idempotencyKey } });
}

beforeAll(async () => {
  await db.authenticate();
});

afterAll(async () => {
  await Outbox.destroy({ where: { idempotencyKey: { [Op.like]: `${TANDA}|%` } } });
  await Outbox.destroy({ where: { chatId: { [Op.in]: [GRUP_UJI_A, GRUP_UJI_B] } } });
  await OptOut.destroy({ where: { phoneE164: NOMOR_OPTOUT } });
  await db.close();
  await sik.close();
});

describe('enqueueMessage: jalur normal', () => {
  it('menulis baris pending dengan variabel tersubstitusi dan kode pengiriman', async () => {
    const k = kunci('normal');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi', no_antrian: 'A-12', nama_poli: 'Poli Umum' },
      },
      ctx(),
    );

    const row = await ambil(k);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.phoneE164).toBe(NOMOR_UJI);
    expect(row!.body).toContain('Halo Budi, antrean Anda A-12 di Poli Umum.');
    // Kode pengiriman disisipkan saat ENQUEUE, bukan saat SEND -- itu yang
    // membuat outbox.body sama persis dengan yang benar-benar terkirim.
    expect(row!.body).toMatch(/Kode Pengiriman : \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [0-9A-Z]{6}$/);
  });

  it('variabel yang tidak diisi tidak meninggalkan placeholder mentah', async () => {
    // Pasien menerima "{nama_pasien}" apa adanya adalah kegagalan yang terlihat
    // langsung olehnya, bukan cuma di log.
    const k = kunci('kosong');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
      },
      ctx(),
    );

    const row = await ambil(k);
    expect(row!.body).not.toContain('{no_antrian}');
    expect(row!.body).not.toContain('{nama_poli}');
  });
});

describe('enqueueMessage: gerbang sebelum antre', () => {
  it('tanpa nomor -> skipped_no_contact, bukan dibuang diam-diam', async () => {
    const k = kunci('tanpa-nomor');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: null,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
      },
      ctx(),
    );

    const row = await ambil(k);
    // Barisnya HARUS tetap ada: jejak bahwa pemicunya terdeteksi tidak boleh
    // hilang hanya karena pasiennya tak punya nomor -- itulah yang dibaca
    // halaman Nomor bermasalah.
    expect(row).not.toBeNull();
    expect(row!.status).toBe('skipped_no_contact');
    expect(row!.phoneE164).toBeNull();
  });

  it('nomor yang sudah opt-out -> skipped_opt_out untuk pemicu yang terikat', async () => {
    await OptOut.destroy({ where: { phoneE164: NOMOR_OPTOUT } });
    await OptOut.create({ phoneE164: NOMOR_OPTOUT, source: 'manual', note: 'uji integrasi', createdAt: new Date() });

    const k = kunci('optout-terikat');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_OPTOUT,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
      },
      ctx({ triggerCode: 'QUEUE_REG' }),
    );

    expect((await ambil(k))!.status).toBe('skipped_opt_out');
  });

  it('BROADCAST dan AUTO_REPLY TIDAK terikat opt-out -- tetap pending', async () => {
    // Keputusan rumah sakit, bukan default teknis (core/optOut.ts): broadcast
    // adalah kanal berbeda, dan balasan otomatis adalah jawaban atas pesan yang
    // pasiennya sendiri kirim barusan.
    for (const trigger of ['BROADCAST', 'AUTO_REPLY']) {
      const k = kunci(`optout-bebas-${trigger}`);
      await enqueueMessage(
        {
          idempotencyKey: k,
          noRkmMedis: null,
          rawPhone: null,
          phoneOverride: NOMOR_OPTOUT,
          eventAt: new Date(),
          vars: { nama_pasien: 'Budi' },
        },
        ctx({ triggerCode: trigger }),
      );
      expect((await ambil(k))!.status).toBe('pending');
    }
  });
});

describe('enqueueMessage: privasi', () => {
  it('poli sensitif mengganti SELURUH isi dengan template generik', async () => {
    const k = kunci('privasi');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        kdPoli: 'JIWA01',
        vars: { nama_pasien: 'Budi', no_antrian: 'A-12', nama_poli: 'Poli Jiwa' },
      },
      ctx({ sensitivePoli: ['JIWA01'] }),
    );

    const row = await ambil(k);
    // Yang dijaga bukan cuma "template generik terpakai", tapi bahwa NAMA
    // POLI-nya benar-benar tidak ikut terkirim -- itu inti F4.3.
    expect(row!.body).toContain('Silakan hubungi kami');
    expect(row!.body).not.toContain('Poli Jiwa');
    expect(row!.body).not.toContain('A-12');
    // Identitas RS terisi walau pemanggil TIDAK menyisipkannya ke vars.
    // Template generik ditulis admin dan memang memuat {nama_rs}; kalau
    // pengisiannya bergantung pada tiap pemanggil, pesan privasi berbunyi
    // "ada informasi dari ." tanpa satu pun galat.
    expect(row!.body).toContain('RS Uji');
    expect(row!.body).not.toContain('{nama_rs}');
  });

  it('satu kode sensitif di antara beberapa sudah cukup mengganti pesan', async () => {
    // Hasil penunjang digabung per kunjungan bisa membawa beberapa kode sekaligus.
    const k = kunci('privasi-larik');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        kdJenisPrw: ['UMUM01', 'HIV01', 'UMUM02'],
        vars: { nama_pasien: 'Budi', no_antrian: 'A-12', nama_poli: 'Poli Umum' },
      },
      ctx({ sensitiveExam: ['HIV01'] }),
    );

    expect((await ambil(k))!.body).toContain('Silakan hubungi kami');
  });
});

describe('enqueueMessage: jam tenang', () => {
  // 22:30 -- di dalam jam tenang 21..7.
  const malam = new Date();
  malam.setHours(22, 30, 0, 0);

  it('pesan malam ditahan sampai jendela berikutnya dibuka', async () => {
    const k = kunci('jam-tenang');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: malam,
        vars: { nama_pasien: 'Budi' },
      },
      ctx(),
    );

    const row = await ambil(k);
    expect(row!.scheduledAt.getHours()).toBe(7);
    expect(row!.scheduledAt.getTime()).toBeGreaterThan(malam.getTime());
    // event_at TETAP waktu kejadiannya -- kalau ikut digeser, ambang "pesan
    // sudah basi" di dispatcher akan menghitung dari waktu yang salah.
    expect(row!.eventAt.getHours()).toBe(22);
  });

  it('kode pengiriman memuat waktu KIRIM, bukan waktu masuk antrean', async () => {
    // Pesan yang muncul pukul 22.30 lalu tertahan sampai 07.00 harus menyebut
    // 07.00 -- kalau tidak, pasien membaca stempel sembilan jam sebelum
    // pesannya tiba.
    const k = kunci('waktu-kirim');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: malam,
        vars: { nama_pasien: 'Budi' },
      },
      ctx(),
    );

    const row = await ambil(k);
    const jam = String(row!.scheduledAt.getHours()).padStart(2, '0');
    expect(row!.body).toContain(`${jam}:00:00`);
    expect(row!.body).not.toContain('22:30');
  });

  it('BOOK_CANCEL dan AUTO_REPLY melewati jam tenang', async () => {
    for (const trigger of ['BOOK_CANCEL', 'AUTO_REPLY']) {
      const k = kunci(`bypass-${trigger}`);
      await enqueueMessage(
        {
          idempotencyKey: k,
          noRkmMedis: null,
          rawPhone: null,
          phoneOverride: NOMOR_UJI,
          eventAt: malam,
          vars: { nama_pasien: 'Budi' },
        },
        ctx({ triggerCode: trigger }),
      );

      const row = await ambil(k);
      expect(row!.scheduledAt.getTime()).toBe(malam.getTime());
    }
  });
});

describe('enqueueMessage: idempotensi', () => {
  it('kunci yang sama dua kali hanya menghasilkan SATU baris', async () => {
    const k = kunci('idem');
    const kirim = () =>
      enqueueMessage(
        {
          idempotencyKey: k,
          noRkmMedis: null,
          rawPhone: null,
          phoneOverride: NOMOR_UJI,
          eventAt: new Date(),
          vars: { nama_pasien: 'Budi' },
        },
        ctx(),
      );

    await kirim();
    await kirim();

    // Dijaga UNIQUE KEY di mesin database, bukan pemeriksaan di kode -- itu
    // yang membuat worker restart atau jadwal yang jalan dua kali tidak pernah
    // bisa mengirim pesan ganda ke pasien.
    expect(await Outbox.count({ where: { idempotencyKey: k } })).toBe(1);
  });

  it('percobaan kedua TIDAK melempar, jadi satu duplikat tidak menghentikan sisa satu siklus', async () => {
    const k = kunci('idem-diam');
    const input = {
      idempotencyKey: k,
      noRkmMedis: null,
      rawPhone: null,
      phoneOverride: NOMOR_UJI,
      eventAt: new Date(),
      vars: { nama_pasien: 'Budi' },
    };
    await enqueueMessage(input, ctx());
    await expect(enqueueMessage(input, ctx())).resolves.toBeUndefined();
  });
});

describe('enqueueMessage: lampiran', () => {
  it('lintasan berkas ikut tersimpan di baris outbox', async () => {
    const k = kunci('lampiran');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
        media: { path: 'uji-integrasi.pdf', mime: 'application/pdf', name: 'Surat Edaran.pdf' },
      },
      ctx({ triggerCode: 'BROADCAST' }),
    );

    const row = await ambil(k);
    // Yang disimpan LINTASANNYA, bukan isinya: satu broadcast ke 500 pasien
    // menghasilkan 500 baris yang menunjuk satu berkas yang sama.
    expect(row!.mediaPath).toBe('uji-integrasi.pdf');
    expect(row!.mediaMime).toBe('application/pdf');
    expect(row!.mediaName).toBe('Surat Edaran.pdf');
  });
});

describe('enqueueMessage: kode pengiriman', () => {
  it('kode diturunkan dari idempotency key, jadi percobaan ulang mengirim teks IDENTIK', async () => {
    // Kode acak akan membuat percobaan kedua tampak sebagai pesan BARU bagi
    // pasien maupun bagi WhatsApp -- persis kebalikan dari tujuan fitur ini.
    const k1 = kunci('kode-sama');
    const k2 = kunci('kode-beda');
    const kirim = async (key: string) => {
      await enqueueMessage(
        {
          idempotencyKey: key,
          noRkmMedis: null,
          rawPhone: null,
          phoneOverride: NOMOR_UJI,
          eventAt: new Date(),
          vars: { nama_pasien: 'Budi' },
        },
        ctx(),
      );
      return (await ambil(key))!.body.match(/([0-9A-Z]{6})$/)![1];
    };

    const kodeA = await kirim(k1);
    const kodeB = await kirim(k2);
    expect(kodeA).not.toBe(kodeB);

    // Baris dihapus lalu di-enqueue ULANG dengan kunci yang sama: kodenya wajib
    // sama persis seperti sebelumnya.
    const sebelum = (await ambil(k1))!.body;
    await Outbox.destroy({ where: { idempotencyKey: k1 } });
    await enqueueMessage(
      {
        idempotencyKey: k1,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
      },
      ctx(),
    );
    const sesudah = (await ambil(k1))!.body;
    expect(sesudah.match(/([0-9A-Z]{6})$/)![1]).toBe(sebelum.match(/([0-9A-Z]{6})$/)![1]);
  });

  it('template kosong = fitur mati, tidak ada baris kode yang ditempel', async () => {
    const k = kunci('kode-mati');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
      },
      ctx({ uniqueCodeTemplate: '' }),
    );

    expect((await ambil(k))!.body).not.toContain('Kode Pengiriman');
  });

  it('kode TETAP ditempel walau {kode} dihapus dari template', async () => {
    // Tanpa ini seluruh pesan berakhiran teks identik dan fitur anti-spam mati
    // diam-diam, tanpa satu pun pesan error.
    const k = kunci('kode-dipaksa');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'Budi' },
      },
      ctx({ uniqueCodeTemplate: 'Dikirim pada {waktu}' }),
    );

    expect((await ambil(k))!.body).toMatch(/Dikirim pada \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [0-9A-Z]{6}$/);
  });
});

describe('app_setting: kunci yang dipakai pipeline benar-benar ada', () => {
  it('semua kunci yang dibaca loadSharedSettings tersedia di database', async () => {
    // Kunci yang hilang tidak pernah melempar -- getSetting* memakai fallback,
    // jadi pengaturan yang lupa di-seed berubah jadi perilaku default yang
    // diam-diam berbeda dari yang tertulis di halaman Pengaturan.
    const wajib = [
      'dispatch.quiet_hours_start',
      'dispatch.quiet_hours_end',
      'privacy.sensitive_poli_codes',
      'privacy.sensitive_exam_codes',
      'privacy.generic_template',
      'dispatch.unique_code_enabled',
      'dispatch.unique_code_template',
    ];
    const ada = await AppSetting.findAll({ where: { k: wajib } });
    expect(ada.map((r) => r.k).sort()).toEqual([...wajib].sort());
  });
});

/**
 * Rekomendasi teknis 9 Agustus 2026 (R7): sampai berkas ini ditambahkan, tidak
 * satu pun uji integrasi menjalankan `enqueuePemicuPasien()` -- fungsi yang
 * benar-benar menyebar pesan menurut `template.tujuan_mode`, dan tempat bug
 * dedup ("Dedup pemicu pasien" di CLAUDE.md) hidup selama berhari-hari sebelum
 * ketahuan dari log produksi. `pipeline.int.test.ts` di atas hanya menguji
 * `enqueueMessage()`, satu tingkat di BAWAH fungsi ini.
 */
describe('enqueuePemicuPasien: tujuan_mode (migrations/018)', () => {
  function ctxTujuan(mode: TujuanMode, targets: TujuanTambahan[] = [{ chatId: GRUP_UJI_A, label: 'Grup Uji A' }]): PipelineContext {
    return ctx({ pemicuPasien: { mode, targets, batasHarian: 0, terpakaiHariIni: 0 } });
  }

  it("mode 'pasien' (bawaan): pasien menerima, TIDAK ADA salinan ke tujuan", async () => {
    const k = kunci('mode-pasien');
    await enqueuePemicuPasien(
      { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
      ctxTujuan('pasien'),
    );

    expect((await ambil(k))!.status).toBe('pending');
    expect(await ambil(turunkanKunciTujuan(k, GRUP_UJI_A))).toBeNull();
  });

  it("mode 'pasien_dan_tujuan': pasien DAN tujuan sama-sama menerima, kunci berbeda", async () => {
    const k = kunci('mode-pasien-dan-tujuan');
    await enqueuePemicuPasien(
      { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
      ctxTujuan('pasien_dan_tujuan'),
    );

    const kePasien = await ambil(k);
    const keGrup = await ambil(turunkanKunciTujuan(k, GRUP_UJI_A));
    expect(kePasien!.status).toBe('pending');
    expect(kePasien!.chatId).toBeNull();
    expect(keGrup).not.toBeNull();
    expect(keGrup!.chatId).toBe(GRUP_UJI_A);
    expect(keGrup!.idempotencyKey).not.toBe(k); // dihash ulang, bukan disambung
  });

  it("mode 'tujuan': HANYA tujuan yang menerima -- kunci DASAR tidak pernah masuk outbox", async () => {
    // Ini persis premis bug 9 Agustus 2026: pada mode ini kunci dasarnya TIDAK
    // PERNAH ditulis, sehingga penyaring lama (yang memeriksa kunci dasar)
    // tidak pernah menyaring apa pun.
    const k = kunci('mode-tujuan');
    await enqueuePemicuPasien(
      { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
      ctxTujuan('tujuan'),
    );

    expect(await ambil(k)).toBeNull();
    const keGrup = await ambil(turunkanKunciTujuan(k, GRUP_UJI_A));
    expect(keGrup).not.toBeNull();
    expect(keGrup!.status).toBe('pending');
  });

  it("mode 'tujuan' TANPA satu pun tujuan aktif: TIDAK ADA baris outbox sama sekali", async () => {
    // Pagar yang membuat salah-setel (tujuan terakhir dinonaktifkan, atau
    // baris template_target rusak) berisik di log alih-alih diam-diam
    // berhenti mengirim ke siapa pun.
    const k = kunci('mode-tujuan-kosong');
    await enqueuePemicuPasien(
      { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
      ctxTujuan('tujuan', []),
    );

    // `ambil(k)` cukup dan LENGKAP sebagai bukti: dengan targets=[] dan
    // kePasien=false, `enqueuePemicuPasien` mengembalikan tanpa masuk cabang
    // insert mana pun -- satu-satunya baris yang bisa saja tertulis adalah
    // kunci dasar `k` sendiri (bila kePasien true), dan loop tujuan tidak
    // pernah berjalan karena arraynya kosong. Memeriksa lewat chatId di sini
    // akan bercampur dengan baris test LAIN dalam suite ini yang sengaja
    // memakai GRUP_UJI_A/GRUP_UJI_B yang sama -- database ini juga dipakai
    // worker produksi yang hidup bersamaan, jadi hitungan global tidak aman.
    expect(await ambil(k)).toBeNull();
  });

  it("mode 'pasien_dan_tujuan' dengan DUA tujuan: masing-masing dapat kunci turunannya sendiri", async () => {
    const k = kunci('mode-dua-tujuan');
    await enqueuePemicuPasien(
      { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
      ctxTujuan('pasien_dan_tujuan', [
        { chatId: GRUP_UJI_A, label: 'Grup A' },
        { chatId: GRUP_UJI_B, label: 'Grup B' },
      ]),
    );

    expect((await ambil(k))!.status).toBe('pending');
    expect((await ambil(turunkanKunciTujuan(k, GRUP_UJI_A)))!.chatId).toBe(GRUP_UJI_A);
    expect((await ambil(turunkanKunciTujuan(k, GRUP_UJI_B)))!.chatId).toBe(GRUP_UJI_B);
  });

  describe("saringKunciBaruPemicuPasien: regresi 'kunci dasar tak pernah ditulis' (ditemukan dari log produksi 9 Agustus 2026)", () => {
    it("mode 'tujuan': baris yang seluruh kuncinya SUDAH ada di outbox DIBUANG", async () => {
      const k = kunci('saring-tujuan-sudah-ada');
      const c = ctxTujuan('tujuan');

      // Simulasi siklus SEBELUMNYA: baris ini sudah terkirim ke GRUP_UJI_A.
      await enqueuePemicuPasien(
        { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
        c,
      );

      // Penyaring LAMA memeriksa kunci DASAR (`k`) -- yang pada mode 'tujuan'
      // tidak pernah ada di outbox. Bug produksi: 1.043 baris log
      // "terkirim:1" per siklus sementara outbox cuma berisi 2 baris total,
      // karena penyaring lama SELALU melihat kunci dasar sebagai "belum ada".
      const lolos = await saringKunciBaruPemicuPasien([{ id: k }], (r) => r.id, c);
      expect(lolos).toHaveLength(0);
    });

    it("mode 'tujuan': baris DIPERTAHANKAN bila tujuan yang BARU DITAMBAHKAN belum punya kuncinya", async () => {
      const k = kunci('saring-tujuan-baru-ditambah');
      const lama = ctxTujuan('tujuan', [{ chatId: GRUP_UJI_A, label: 'Grup A' }]);

      // Siklus sebelumnya: sudah terkirim ke GRUP_UJI_A saja.
      await enqueuePemicuPasien(
        { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
        lama,
      );

      // Staf baru saja memasang GRUP_UJI_B sebagai tujuan kedua.
      const baru = ctxTujuan('tujuan', [
        { chatId: GRUP_UJI_A, label: 'Grup A' },
        { chatId: GRUP_UJI_B, label: 'Grup B' },
      ]);

      // WAJIB dipertahankan: GRUP_UJI_B belum pernah menerima apa pun, walau
      // GRUP_UJI_A sudah. Membuang baris ini berarti grup yang baru dipasang
      // tidak pernah kebagian pesan untuk kunjungan lama.
      const lolos = await saringKunciBaruPemicuPasien([{ id: k }], (r) => r.id, baru);
      expect(lolos).toHaveLength(1);

      // uq_idem tetap penjaga terakhir: mengirim ulang baris yang lolos ini
      // TIDAK menghasilkan duplikat untuk GRUP_UJI_A yang sudah terkirim.
      await enqueuePemicuPasien(
        { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
        baru,
      );
      expect(await Outbox.count({ where: { idempotencyKey: turunkanKunciTujuan(k, GRUP_UJI_A) } })).toBe(1);
      expect(await Outbox.count({ where: { idempotencyKey: turunkanKunciTujuan(k, GRUP_UJI_B) } })).toBe(1);
    });

    it('tanpa pemicuPasien di ctx (pemicu biasa): berperilaku identik dengan saringKunciBaru pada kunci dasar', async () => {
      const k = kunci('saring-tanpa-pemicu-pasien');
      await enqueueMessage(
        { idempotencyKey: k, noRkmMedis: null, rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: { nama_pasien: 'Budi' } },
        ctx(),
      );

      const lolos = await saringKunciBaruPemicuPasien([{ id: k }], (r) => r.id, ctx());
      expect(lolos).toHaveLength(0);
    });
  });
});
