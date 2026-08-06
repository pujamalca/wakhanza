import { Op } from 'sequelize';
import { Outbox, OptOut } from '@/models';
import { db } from '@/db/wakhanza';
import { sik } from '@/db/sik';
import { buildIdempotencyKey, turunkanKunciTujuan } from '@/core/idempotency';
import { enqueueMessage, type PipelineContext } from './pipeline';

/**
 * Uji integrasi untuk KEDUA pemicu BPJS, terhadap database `wakhanza`
 * sungguhan.
 *
 * Yang dibuktikan di sini justru hal-hal yang TIDAK bisa dibuktikan unit test:
 * bahwa pendaftaran kode pemicu di `core/optOut.ts` dan `core/quietHours.ts`
 * benar-benar berakibat pada baris `outbox` yang ditulis. Keduanya berupa
 * daftar berisi string, dan kode pemicu yang lupa didaftarkan tidak
 * menghasilkan satu pun galat -- ia cuma berperilaku sebagai "tidak terdaftar",
 * yang untuk BPJS_KONTROL berarti pesan tetap terkirim ke pasien yang sudah
 * meminta berhenti.
 *
 * Setiap baris ditandai pada `idempotency_key` dan dibersihkan di afterAll.
 */

const TANDA = 'INTTESTBPJS';
const NOMOR_UJI = '628000000011';
const NOMOR_OPTOUT = '628000000012';
const GRUP_UJI = '120363000000000001@g.us';

function ctxBatal(): PipelineContext {
  return {
    triggerCode: 'BPJS_BATAL',
    template: { body: 'Batal: {nama_pasien} ({no_rm}) poli {nama_poli} jadwal {tanggal}.' },
    genericTemplate: 'Ada satu booking yang dibatalkan pada {tanggal_batal}.',
    identity: { namaRs: 'RS Uji', alamatRs: 'Jl. Uji 1', kontakRs: '021-000' },
    quietStart: 21,
    quietEnd: 7,
    sensitivePoli: [],
    sensitiveExam: [],
    uniqueCodeTemplate: 'Kode Pengiriman : {waktu} {kode}',
  };
}

function ctxKontrol(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    triggerCode: 'BPJS_KONTROL',
    template: { body: 'Yth. {nama_pasien}, kontrol {tanggal_kontrol} ({sisa_hari}) di {nama_poli}.' },
    genericTemplate: 'Bpk/Ibu {nama_pasien}, ada informasi dari {nama_rs}.',
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
const kunci = (nama: string) => `${TANDA}|${nama}|${++nomorUrut}`;
const ambil = (idempotencyKey: string) => Outbox.findOne({ where: { idempotencyKey } });

/** 22:30 -- di dalam jam tenang 21..07. */
const MALAM = new Date(2026, 7, 5, 22, 30, 0, 0);

beforeAll(async () => {
  await db.authenticate();
  // destroy-lalu-create, bukan findOrCreate: yang kedua memancing peringatan
  // Sequelize tentang transaksi, dan peringatan rutin yang tidak berarti apa-apa
  // adalah persis yang membuat peringatan sungguhan berhenti dibaca.
  await OptOut.destroy({ where: { phoneE164: NOMOR_OPTOUT } });
  await OptOut.create({ phoneE164: NOMOR_OPTOUT, source: 'manual', note: 'uji integrasi BPJS', createdAt: new Date() });
});

afterAll(async () => {
  await Outbox.destroy({ where: { idempotencyKey: { [Op.like]: `${TANDA}|%` } } });
  await OptOut.destroy({ where: { phoneE164: NOMOR_OPTOUT } });
  await db.close();
  await sik.close();
});

describe('BPJS_BATAL -- penerimanya STAF', () => {
  it('menulis baris bertujuan chat_id, tanpa phone_e164', async () => {
    const k = kunci('batal-grup');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: '000130',
        rawPhone: null,
        chatId: GRUP_UJI,
        eventAt: new Date(),
        vars: { nama_pasien: 'RISNAWATI', no_rm: '000130', nama_poli: 'Jantung', tanggal: '2026-08-05' },
      },
      ctxBatal(),
    );

    const row = await ambil(k);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.chatId).toBe(GRUP_UJI);
    // Tujuannya grup: tidak ada nomor pasien yang boleh ikut tercatat sebagai
    // penerima, walau no_rkm_medis-nya sengaja tetap disimpan supaya pencarian
    // di /antrean menemukan ke mana saja pesan pasien ini pergi.
    expect(row!.phoneE164).toBeNull();
    expect(row!.noRkmMedis).toBe('000130');
    expect(row!.body).toContain('RISNAWATI');
  });

  it('MELEWATI jam tenang -- slot yang batal sering untuk besok pagi', async () => {
    const k = kunci('batal-malam');
    await enqueueMessage(
      { idempotencyKey: k, noRkmMedis: null, rawPhone: null, chatId: GRUP_UJI, eventAt: MALAM, vars: {} },
      ctxBatal(),
    );
    const row = await ambil(k);
    // Tidak ditunda ke 07.00 keesokan harinya.
    expect(row!.scheduledAt.getTime()).toBe(MALAM.getTime());
  });

  it('TIDAK tunduk pada daftar tolak -- tidak ada nomor pasien untuk dicocokkan', async () => {
    const k = kunci('batal-optout');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: null,
        rawPhone: null,
        phoneOverride: NOMOR_OPTOUT,
        eventAt: new Date(),
        vars: {},
      },
      ctxBatal(),
    );
    const row = await ambil(k);
    // Sekalipun nomornya ada di daftar tolak, BPJS_BATAL tidak terikat --
    // koordinasi kerja internal bukan sesuatu yang bisa dihentikan pasien.
    expect(row!.status).toBe('pending');
  });
});

describe('BPJS_KONTROL -- penerimanya PASIEN', () => {
  it('TUNDUK pada daftar tolak', async () => {
    const k = kunci('kontrol-optout');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: '007360',
        rawPhone: null,
        phoneOverride: NOMOR_OPTOUT,
        eventAt: new Date(),
        vars: { nama_pasien: 'YESNI' },
      },
      ctxKontrol(),
    );
    const row = await ambil(k);
    // Inilah yang tidak bisa dibuktikan unit test: bahwa 'BPJS_KONTROL' yang
    // ditambahkan ke OPT_OUT_TRIGGERS benar-benar mengubah baris outbox-nya.
    expect(row!.status).toBe('skipped_opt_out');
  });

  it('TUNDUK pada jam tenang -- ditunda ke jendela kirim berikutnya', async () => {
    const k = kunci('kontrol-malam');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: '007360',
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: MALAM,
        vars: {},
      },
      ctxKontrol(),
    );
    const row = await ambil(k);
    expect(row!.scheduledAt.getTime()).toBeGreaterThan(MALAM.getTime());
    expect(row!.scheduledAt.getHours()).toBe(7);
  });

  it('poli sensitif diganti template generik', async () => {
    const k = kunci('kontrol-sensitif');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: '007360',
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        kdPoli: 'U0012',
        vars: { nama_pasien: 'YESNI', nama_poli: 'Jantung' },
      },
      ctxKontrol({ sensitivePoli: ['U0012'] }),
    );
    const row = await ambil(k);
    expect(row!.body).toContain('ada informasi dari RS Uji');
    // Nama polinya TIDAK boleh ikut keluar.
    expect(row!.body).not.toContain('Jantung');
  });

  it('kunci idempoten memuat selisih hari, jadi H-7 dan H-1 adalah dua pesan', async () => {
    const noSurat = `${TANDA}-SURAT-1`;
    const tgl = '2026-09-01';
    const k7 = buildIdempotencyKey('BPJS_KONTROL', noSurat, tgl, '7');
    const k1 = buildIdempotencyKey('BPJS_KONTROL', noSurat, tgl, '1');
    expect(k7).not.toBe(k1);

    for (const [k, sisa] of [
      [k7, '7 hari lagi'],
      [k1, 'besok'],
    ] as const) {
      await enqueueMessage(
        {
          idempotencyKey: k,
          noRkmMedis: '007360',
          rawPhone: null,
          phoneOverride: NOMOR_UJI,
          eventAt: new Date(),
          vars: { nama_pasien: 'YESNI', tanggal_kontrol: tgl, sisa_hari: sisa },
        },
        ctxKontrol(),
      );
    }

    const a = await ambil(k7);
    const b = await ambil(k1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.body).toContain('7 hari lagi');
    expect(b!.body).toContain('besok');

    // Dibersihkan lewat pola TANDA di afterAll? Kunci ini HASIL HASH, jadi
    // tidak berawalan TANDA -- dihapus eksplisit di sini supaya tidak menetap.
    await Outbox.destroy({ where: { idempotencyKey: { [Op.in]: [k7, k1] } } });
  });

  it('salinan ke tujuan memakai kunci turunan, bukan kunci yang sama', async () => {
    const dasar = kunci('kontrol-salinan');
    const turunan = turunkanKunciTujuan(dasar, GRUP_UJI);
    expect(turunan).not.toBe(dasar);
    // Panjangnya WAJIB muat di VARCHAR(64) -- sambungan biasa (SHA1 40 karakter
    // + JID grup 24 karakter = 65) dipotong MariaDB non-strict tepat di bagian
    // yang membedakan satu tujuan dari tujuan lain.
    expect(turunan.length).toBeLessThanOrEqual(64);

    await enqueueMessage(
      { idempotencyKey: dasar, noRkmMedis: '007360', rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: new Date(), vars: {} },
      ctxKontrol(),
    );
    await enqueueMessage(
      { idempotencyKey: turunan, noRkmMedis: '007360', rawPhone: null, chatId: GRUP_UJI, eventAt: new Date(), vars: {} },
      ctxKontrol(),
    );

    const kePasien = await ambil(dasar);
    const keGrup = await ambil(turunan);
    expect(kePasien!.phoneE164).toBe(NOMOR_UJI);
    expect(keGrup!.chatId).toBe(GRUP_UJI);
    expect(keGrup!.phoneE164).toBeNull();

    await Outbox.destroy({ where: { idempotencyKey: turunan } });
  });

  it('salinan ke grup TETAP terkirim walau pasiennya sudah minta berhenti', async () => {
    const dasar = kunci('kontrol-optout-salinan');
    const turunan = turunkanKunciTujuan(dasar, GRUP_UJI);

    await enqueueMessage(
      { idempotencyKey: dasar, noRkmMedis: '007360', rawPhone: null, phoneOverride: NOMOR_OPTOUT, eventAt: new Date(), vars: {} },
      ctxKontrol(),
    );
    await enqueueMessage(
      { idempotencyKey: turunan, noRkmMedis: '007360', rawPhone: null, chatId: GRUP_UJI, eventAt: new Date(), vars: {} },
      ctxKontrol(),
    );

    // Konsekuensi yang HARUS disadari rumah sakit, dan karena itu dipatok uji:
    // yang pasien hentikan adalah pesan KEPADANYA, bukan salinan ke grup.
    expect((await ambil(dasar))!.status).toBe('skipped_opt_out');
    expect((await ambil(turunan))!.status).toBe('pending');

    await Outbox.destroy({ where: { idempotencyKey: turunan } });
  });
});

/**
 * PERMINTAAN lab/radiologi (migrations/025). Ikut di berkas ini karena yang
 * dibuktikan sama persis: bahwa mendaftarkan sebuah kode pemicu ke
 * `OPT_OUT_TRIGGERS` benar-benar berakibat pada baris `outbox`, bukan cuma
 * menambah string ke sebuah Set. Kode yang lupa didaftarkan tidak menghasilkan
 * satu pun galat -- ia hanya berperilaku sebagai "tidak terikat", dan pesannya
 * tetap terkirim ke pasien yang sudah meminta berhenti.
 */
describe('LAB_REQUEST / RAD_REQUEST -- pasangan RESULT_READY dari ujung yang lain', () => {
  function ctxPermintaan(triggerCode: string): PipelineContext {
    return {
      triggerCode,
      template: { body: 'Bpk/Ibu {nama_pasien}, dokter {nama_dokter} meminta pemeriksaan pada {tanggal}.' },
      genericTemplate: 'Bpk/Ibu {nama_pasien}, ada informasi dari {nama_rs}.',
      identity: { namaRs: 'RS Uji', alamatRs: 'Jl. Uji 1', kontakRs: '021-000' },
      quietStart: 21,
      quietEnd: 7,
      sensitivePoli: [],
      sensitiveExam: [],
      uniqueCodeTemplate: 'Kode Pengiriman : {waktu} {kode}',
    };
  }

  it.each(['LAB_REQUEST', 'RAD_REQUEST'])('%s TUNDUK pada daftar tolak', async (triggerCode) => {
    const k = kunci(`${triggerCode}-optout`);
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: '002040',
        rawPhone: null,
        phoneOverride: NOMOR_OPTOUT,
        eventAt: new Date(),
        vars: { nama_pasien: 'LASTRI', nama_dokter: 'dr. Uji', tanggal: '2026-08-06' },
      },
      ctxPermintaan(triggerCode),
    );
    expect((await ambil(k))!.status).toBe('skipped_opt_out');
  });

  it('TUNDUK pada jam tenang -- berbeda dari pemicu yang penerimanya staf', async () => {
    const k = kunci('lab-request-malam');
    await enqueueMessage(
      { idempotencyKey: k, noRkmMedis: '002040', rawPhone: null, phoneOverride: NOMOR_UJI, eventAt: MALAM, vars: {} },
      ctxPermintaan('LAB_REQUEST'),
    );
    const row = await ambil(k);
    expect(row!.scheduledAt.getTime()).toBeGreaterThan(MALAM.getTime());
    expect(row!.scheduledAt.getHours()).toBe(7);
  });

  it('kode pemeriksaan sensitif -> template generik, dan kodenya TIDAK ikut keluar', async () => {
    const k = kunci('lab-request-sensitif');
    await enqueueMessage(
      {
        idempotencyKey: k,
        noRkmMedis: '002040',
        rawPhone: null,
        phoneOverride: NOMOR_UJI,
        eventAt: new Date(),
        // Satu kode sensitif di antara beberapa sudah cukup (core/privacy.ts).
        kdJenisPrw: ['242-RJ', '290-RJ'],
        vars: { nama_pasien: 'LASTRI', nama_dokter: 'dr. Uji' },
      },
      { ...ctxPermintaan('LAB_REQUEST'), sensitiveExam: ['290-RJ'] },
    );
    const row = await ambil(k);
    expect(row!.body).toContain('ada informasi dari RS Uji');
    expect(row!.body).not.toContain('dr. Uji');
    expect(row!.body).not.toContain('290-RJ');
  });
});
