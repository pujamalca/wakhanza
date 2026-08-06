import { BpjsTarget, getSetting, getSettingBool, getSettingNumber, setSetting } from '@/models';
import { buildIdempotencyKey, turunkanKunciTujuan } from '@/core/idempotency';
import { isChatIdValid } from '@/core/farmasiTarget';
import { normalizePhone } from '@/core/phone';
import type { TemplateVariable } from '@/core/template';
import { bacaHariSebelum, sasaranKontrol, labelSisaHari, jatuhTempoHarian, tanggalLokal } from '@/core/bpjs';
import { pollBpjsBatal, type BpjsBatalRow } from '@/khanza/bpjsBatal';
import { pollBpjsKontrol, type BpjsKontrolRow } from '@/khanza/bpjsKontrol';
import { loadFarmasiContext, enqueueMessage, type PipelineContext } from './pipeline';
import { resolvePhone } from './contactResolver';
import { getCursor, advanceCursor, recordCursorError } from './cursor';
import { logger, safeError, maskPhone } from '@/lib/logger';

/**
 * BPJS -- dua pemicu di satu berkas karena sumber datanya satu kanal, tapi
 * arahnya berlawanan dan hampir tidak ada yang bisa dipakai bersama:
 *
 *   BPJS_BATAL    sik -> LOKET   dipicu kejadian, tiap siklus polling
 *   BPJS_KONTROL  sik -> PASIEN  dipicu waktu, sekali sehari
 *
 * `loadFarmasiContext()` dipakai keduanya, dan namanya memang jadi keliru sejak
 * dipakai di luar apotek. Yang ia lakukan bukan sesuatu yang khas farmasi:
 * memuat konteks pipeline yang isi pesannya dari `app_setting` alih-alih dari
 * tabel `template` -- persis yang dibutuhkan di sini. Membuat salinannya dengan
 * nama lain akan menghasilkan dua fungsi yang mengerjakan hal yang sama, dan
 * itu bentuk kegagalan yang sudah dibayar berkali-kali di proyek ini.
 */

// ---------------------------------------------------------------------------
// Tujuan
// ---------------------------------------------------------------------------

export interface TujuanBpjs {
  id: number;
  chatId: string;
  label: string;
}

/**
 * @param kolom centang mana yang menentukan -- `terimaBatal` atau
 *   `terimaKontrol`. Sengaja parameter, bukan dua fungsi: keduanya menyaring
 *   tabel yang sama dengan cara yang sama, dan dua salinan yang berbeda satu
 *   nama kolom adalah cara paling gampang membuat perbaikan pada satu tab
 *   diam-diam tidak berlaku di tab satunya.
 */
export async function muatTujuanBpjs(kolom: 'terimaBatal' | 'terimaKontrol'): Promise<TujuanBpjs[]> {
  const rows = await BpjsTarget.findAll({ where: { isActive: true, [kolom]: true }, order: [['id', 'ASC']] });

  const hasil: TujuanBpjs[] = [];
  for (const row of rows) {
    // Alasan yang sama dengan muatTujuanTambahan() di pipeline.ts: nilainya
    // pulang-pergi lewat database, dan baris yang disunting lewat SQL mentah
    // tidak pernah melewati server action mana pun. Alamat tidak sah tidak
    // ditolak WhatsApp dengan galat yang berguna -- ia menghasilkan baris gagal
    // yang di Antrean terlihat persis seperti gangguan jaringan biasa.
    if (!isChatIdValid(row.chatId)) {
      logger.error({ targetId: row.id, label: row.label }, 'tujuan BPJS dilewati: alamatnya bukan JID yang sah');
      continue;
    }
    hasil.push({ id: row.id, chatId: row.chatId, label: row.label });
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Tab 1: PEMBATALAN MOBILE JKN -> loket
// ---------------------------------------------------------------------------

/**
 * Diekspor supaya `poll:dryrun` memakai pemetaan yang SAMA, bukan salinannya.
 *
 * Pelajaran yang sudah dibayar penuh saat `{cara_bayar}` ditambahkan: pemetaan
 * baris->variabel dulu ditulis dua kali, dan yang tertinggal adalah
 * PRATINJAUNYA -- sehingga staf membaca variabel kosong di dryrun sementara
 * produksi mengisinya, lalu menyimpulkan variabelnya rusak dan membuangnya dari
 * template. Itulah kenapa `worker/triggerVars.ts` ada, dan kenapa yang ini ikut
 * diekspor sejak awal alih-alih menunggu penyimpangannya terjadi.
 */
export function varsBatal(row: BpjsBatalRow): Partial<Record<TemplateVariable, string>> {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    nama_poli: row.nm_poli ?? '',
    nama_dokter: row.nm_dokter ?? '',
    // Jadwal yang DIBATALKAN -- bukan waktu pembatalannya.
    tanggal: row.tanggalperiksa ?? '',
    jam: row.jampraktek ?? '',
    tanggal_batal: row.tanggalbatal,
    keterangan: row.keterangan ?? '',
  };
}

/**
 * Satu siklus pembatalan. Diekspor supaya verifikasi menjalankan fungsi yang
 * SAMA dipakai worker, bukan tiruannya.
 *
 * @returns berapa baris pembatalan yang terbaca (bukan berapa pesan terkirim --
 *   satu pembatalan menyebar ke semua tujuan).
 */
export async function runBpjsBatalCycle(targets: TujuanBpjs[]): Promise<number> {
  const lookbackDays = await getSettingNumber('polling.lookback_days', 30);
  const cursorTs = await getCursor('BPJS_BATAL', lookbackDays);

  let rows: BpjsBatalRow[];
  try {
    rows = await pollBpjsBatal(cursorTs);
  } catch (err) {
    const e = safeError(err);
    logger.error({ triggerCode: 'BPJS_BATAL', ...e }, 'siklus pembatalan BPJS gagal, watermark tidak dimajukan');
    await recordCursorError('BPJS_BATAL', e.message);
    return 0;
  }

  if (rows.length === 0) return 0;

  const [body, bodyGenerik, bodyRekap, maxPerCycle] = await Promise.all([
    getSetting('bpjs.template_batal', ''),
    getSetting('bpjs.template_batal_generic', ''),
    getSetting('bpjs.template_batal_rekap', ''),
    getSettingNumber('bpjs.batal_max_per_cycle', 20),
  ]);

  // Watermark BARU = pembatalan terbaru yang terbaca. Dihitung dari seluruh
  // baris, bukan dari yang terakhir: ORDER BY memang menaik, tapi bergantung
  // pada urutan berarti satu perubahan ORDER BY diam-diam memundurkan watermark.
  let maxTs = cursorTs;
  for (const row of rows) {
    const at = new Date(row.tanggalbatal.replace(' ', 'T'));
    if (at > maxTs) maxTs = at;
  }

  if (rows.length > maxPerCycle) {
    /**
     * Di atas ambang: SATU rekap per tujuan. Alasannya sama persis dengan
     * farmasi.max_per_cycle, dan pemicunya di sini sangat konkret -- seorang
     * dokter berhalangan, admin membatalkan seluruh jadwalnya, dan puluhan
     * baris muncul dalam satu siklus. Mengirimnya satuan adalah pola beruntun
     * yang memicu deteksi spam pada SATU-SATUNYA nomor rumah sakit, sehingga
     * notifikasi pasien ikut mati bersamanya.
     */
    const ctxRekap = await loadFarmasiContext('BPJS_BATAL', bodyRekap ?? '', bodyRekap ?? '');
    for (const target of targets) {
      await enqueueMessage(
        {
          idempotencyKey: buildIdempotencyKey('BPJS_BATAL_REKAP', maxTs.toISOString(), String(rows.length), target.chatId),
          noRkmMedis: null,
          rawPhone: null,
          chatId: target.chatId,
          eventAt: maxTs,
          vars: { jumlah_batal: String(rows.length), tanggal_batal: rows[rows.length - 1]?.tanggalbatal ?? '' },
        },
        ctxRekap,
      );
    }
    logger.warn(
      { jumlah: rows.length, maxPerCycle, tujuan: targets.length },
      'pembatalan BPJS melebihi ambang satu siklus, dikirim sebagai satu rekap',
    );
    await advanceCursor('BPJS_BATAL', maxTs, rows.length);
    return rows.length;
  }

  const ctx = await loadFarmasiContext('BPJS_BATAL', body ?? '', bodyGenerik ?? '');
  for (const row of rows) {
    const eventAt = new Date(row.tanggalbatal.replace(' ', 'T'));
    for (const target of targets) {
      await enqueueMessage(
        {
          // chat_id WAJIB masuk kunci -- tanpa itu tujuan kedua dan seterusnya
          // ditolak uq_idem sebagai duplikat, dan hanya satu grup yang pernah
          // menerima apa pun. Tanpa galat, karena INSERT-nya ignoreDuplicates.
          idempotencyKey: buildIdempotencyKey('BPJS_BATAL', row.nobooking, target.chatId),
          // Dicatat supaya pencarian di /antrean menemukan pesan ini juga.
          // Nomornya sendiri tidak dipakai: tujuannya chat_id, dan
          // enqueueMessage melewati resolvePhone seluruhnya saat chatId terisi.
          noRkmMedis: row.no_rkm_medis,
          rawPhone: null,
          chatId: target.chatId,
          eventAt,
          kdPoli: row.kd_poli,
          vars: varsBatal(row),
        },
        ctx,
      );
    }
  }

  await advanceCursor('BPJS_BATAL', maxTs, rows.length);
  logger.info({ pembatalan: rows.length, tujuan: targets.length }, 'siklus pembatalan BPJS selesai');
  return rows.length;
}

/** Dipanggil worker tiap `polling.interval_ms`. */
export async function runBpjsBatalCycles(): Promise<void> {
  if (!(await getSettingBool('bpjs.enabled', false))) return;
  if (!(await getSettingBool('bpjs.batal_enabled', false))) return;

  const targets = await muatTujuanBpjs('terimaBatal');
  if (targets.length === 0) {
    // Bukan galat: sakelarnya menyala tapi belum ada tujuan yang dicentang.
    // debug supaya tidak berisik tiap 60 detik -- halaman /bpjs menampilkannya
    // sebagai peringatan, di depan orang yang bisa memperbaikinya.
    logger.debug('pembatalan BPJS menyala tapi belum ada tujuan yang menerimanya');
    return;
  }
  await runBpjsBatalCycle(targets);
}

// ---------------------------------------------------------------------------
// Tab 2: PENGINGAT SURAT KONTROL -> pasien
// ---------------------------------------------------------------------------

/** Diekspor untuk `poll:dryrun` -- alasan yang sama seperti `varsBatal`. */
export function varsKontrol(row: BpjsKontrolRow, hariSebelum: number): Partial<Record<TemplateVariable, string>> {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis ?? '',
    nama_poli: row.nm_poli_bpjs ?? '',
    nama_dokter: row.nm_dokter_bpjs ?? '',
    tanggal_kontrol: row.tgl_rencana,
    sisa_hari: labelSisaHari(hariSebelum),
  };
}

/**
 * Nomor tujuan untuk satu pengingat kontrol, berikut CADANGAN dari SEP.
 *
 * Urutannya, dan tiap tingkat ada alasannya:
 *
 *   1. koreksi manual petugas  (di dalam resolvePhone, F2.1-F2.3)
 *   2. pasien.no_tlp           (jalur normal seluruh proyek)
 *   3. bridging_sep.notelep    (cadangan, HANYA untuk pesan ini)
 *
 * Tingkat 3 SENGAJA tidak ditulis ke `patient_contact`, dan itu bagian yang
 * paling gampang "diperbaiki" ke arah yang salah. Tabel itu adalah cerminan
 * `pasien.no_tlp` berikut koreksi manual di atasnya; menulis nomor SEP ke sana
 * membuat baris pasien yang sama berbolak-balik antara "terpakai" dan
 * "bermasalah" tergantung pemicu mana yang terakhir menyentuhnya -- dan halaman
 * /nomor-bermasalah, yang justru ada untuk menunjukkan apa yang perlu
 * diperbaiki petugas, jadi tidak bisa dipercaya. Nomor di `pasien` tetap perlu
 * dibetulkan; cadangan ini hanya mencegah satu pengingat hilang sementara itu.
 *
 * Bukan optimasi spekulatif: 618 dari 18.843 surat di database rujukan milik
 * pasien ber-`no_tlp` tak terpakai, dan 602 di antaranya punya nomor sah di SEP.
 */
async function nomorUntukKontrol(row: BpjsKontrolRow): Promise<{ phone: string | null; dariSep: boolean }> {
  if (!row.no_rkm_medis) return { phone: null, dariSep: false };

  const utama = await resolvePhone(row.no_rkm_medis, row.no_tlp);
  if (utama.phoneE164) return { phone: utama.phoneE164, dariSep: false };

  const cadangan = normalizePhone(row.notelep);
  if (cadangan.ok) return { phone: cadangan.value, dariSep: true };

  return { phone: null, dariSep: false };
}

async function kirimSatuPengingat(
  row: BpjsKontrolRow,
  hariSebelum: number,
  ctx: PipelineContext,
  kePasien: boolean,
  targets: TujuanBpjs[],
  now: Date,
): Promise<void> {
  /**
   * Kunci idempoten memuat KETIGANYA: nomor surat, tanggal rencana, dan selisih
   * harinya.
   *
   * - `no_surat` -- satuan yang benar; satu surat satu rencana kontrol.
   * - `tgl_rencana` -- tanggalnya bisa direvisi. Tanpa ini, surat yang
   *   dijadwalkan ulang tidak pernah diingatkan lagi karena kuncinya sudah ada.
   * - `hariSebelum` -- setelan "7,1" harus menghasilkan DUA pengingat untuk
   *   surat yang sama. Tanpa ini yang kedua ditolak sebagai duplikat, diam-diam,
   *   dan yang terlihat cuma "pengingat H-1 tidak jalan".
   */
  const kunci = buildIdempotencyKey('BPJS_KONTROL', row.no_surat, row.tgl_rencana, String(hariSebelum));
  const vars = varsKontrol(row, hariSebelum);

  if (kePasien) {
    const { phone, dariSep } = await nomorUntukKontrol(row);
    if (dariSep) {
      logger.info(
        { noRkmMedis: row.no_rkm_medis, phone: maskPhone(phone) },
        'nomor pasien diambil dari SEP karena pasien.no_tlp tidak terpakai',
      );
    }
    await enqueueMessage(
      {
        idempotencyKey: kunci,
        noRkmMedis: row.no_rkm_medis,
        // rawPhone tidak dipakai: nomornya sudah ditentukan nomorUntukKontrol()
        // di atas, berikut penulisan patient_contact-nya. Menyerahkannya lagi ke
        // resolvePhone akan menulis baris yang sama dua kali per pesan.
        rawPhone: null,
        phoneOverride: phone,
        eventAt: now,
        kdPoli: row.kd_poli,
        vars,
      },
      ctx,
    );
  }

  for (const target of targets) {
    await enqueueMessage(
      {
        idempotencyKey: turunkanKunciTujuan(kunci, target.chatId),
        noRkmMedis: row.no_rkm_medis,
        rawPhone: null,
        chatId: target.chatId,
        eventAt: now,
        kdPoli: row.kd_poli,
        vars,
      },
      ctx,
    );
  }
}

/**
 * Satu kali jalan pengingat kontrol -- seluruh selisih hari yang disetel.
 * Diekspor untuk verifikasi dan untuk tombol "Kirim sekarang" di dashboard.
 *
 * @returns berapa surat kontrol yang diproses.
 */
export async function runBpjsKontrolJob(now: Date = new Date()): Promise<number> {
  const [rawHari, kePasien, bodyGenerikKhusus] = await Promise.all([
    getSetting('bpjs.kontrol_hari_sebelum', '1'),
    getSettingBool('bpjs.kontrol_ke_pasien', true),
    getSetting('bpjs.template_kontrol_generic', ''),
  ]);

  const hariSebelum = bacaHariSebelum(rawHari);
  if (hariSebelum.length === 0) {
    // Menyalakan tab tanpa satu pun selisih hari yang sah berarti pengingatnya
    // tidak akan pernah terkirim. Server action menolaknya saat menyimpan; ini
    // jaring untuk nilai yang masuk lewat jalan lain.
    logger.warn({ rawHari }, 'pengingat kontrol BPJS menyala tapi tidak ada "hari sebelum" yang sah');
    return 0;
  }

  const targets = await muatTujuanBpjs('terimaKontrol');
  if (!kePasien && targets.length === 0) {
    /**
     * Pasien dimatikan DAN tidak ada tujuan aktif = pesannya tidak pergi ke mana
     * pun, dan tidak ada satu pun baris outbox yang menandainya. Alasan dan
     * bentuknya sama persis dengan mode 'tujuan' tanpa tujuan di
     * enqueuePemicuPasien() -- dan sengaja TIDAK jatuh kembali ke pasien: rumah
     * sakit sudah memutuskan pesan ini bukan untuk pasien, dan membatalkan
     * keputusan itu diam-diam lebih buruk daripada tidak mengirim.
     */
    logger.error('pengingat kontrol BPJS disetel bukan-ke-pasien tapi tidak ada tujuan aktif -- tidak dikirim ke mana pun');
    return 0;
  }

  const sasaran = sasaranKontrol(hariSebelum, now);
  let rows: BpjsKontrolRow[];
  try {
    rows = await pollBpjsKontrol(sasaran.map((s) => s.tanggal));
  } catch (err) {
    // DILEMPAR ULANG, tidak ditelan. Pemanggil terjadwal memakai berhasil-atau-
    // tidaknya untuk memutuskan apakah penanda hariannya boleh maju; menelan
    // galat di sini membuat satu kegagalan sesaat menghapus pengingat SEHARIAN.
    logger.error(safeError(err), 'gagal membaca surat kontrol BPJS');
    throw err;
  }

  if (rows.length === 0) {
    logger.info({ sasaran: sasaran.map((s) => s.tanggal) }, 'tidak ada surat kontrol yang jatuh tempo diingatkan');
    return 0;
  }

  const body = (await getSetting('bpjs.template_kontrol', '')) ?? '';
  // Kosong = pakai privacy.generic_template seperti pemicu pasien lain.
  // loadFarmasiContext memakai argumen kedua apa adanya sebagai genericTemplate,
  // jadi bedanya ditentukan di sini, bukan di sana.
  const ctx = await loadFarmasiContext('BPJS_KONTROL', body, bodyGenerikKhusus || (await getSetting('privacy.generic_template')) || body);

  // Peta tanggal -> selisih hari. Satu query mengembalikan beberapa tanggal
  // sekaligus, jadi tiap baris harus tahu ia pengingat yang keberapa.
  const selisihPerTanggal = new Map(sasaran.map((s) => [s.tanggal, s.hariSebelum]));

  let diproses = 0;
  for (const row of rows) {
    const hari = selisihPerTanggal.get(row.tgl_rencana);
    // Tidak mungkin dalam keadaan normal (WHERE-nya persis daftar itu), tapi
    // menebak 0 akan mengirim "hari ini" untuk kontrol yang masih seminggu lagi.
    if (hari === undefined) continue;
    await kirimSatuPengingat(row, hari, ctx, kePasien, targets, now);
    diproses++;
  }

  logger.info(
    { surat: rows.length, diproses, sasaran: sasaran.map((s) => s.tanggal), kePasien, tujuan: targets.length },
    'pengingat kontrol BPJS selesai',
  );
  return diproses;
}

/**
 * Dipanggil worker tiap siklus pindai. Menentukan sendiri apakah sudah waktunya.
 *
 * TIDAK memakai node-cron seperti BOOK_REMIND, dan itu perbaikan yang disengaja:
 * `startScheduler()` membaca `schedule.book_remind_hour` SEKALI saat worker
 * mulai, jadi mengubah jamnya lewat dashboard tidak berlaku sampai ada yang
 * menyalakan ulang worker -- dan tidak ada satu pun tanda bahwa setelan barunya
 * belum aktif. Di sini `bpjs.kontrol_jam` dibaca ulang tiap siklus, jadi
 * mengubahnya berlaku hari itu juga.
 *
 * Penanda hariannya cuma penghemat query, BUKAN penentu kebenaran: yang
 * benar-benar mencegah kirim ganda adalah kunci idempoten di
 * `kirimSatuPengingat()`, ditegakkan `uq_idem` di mesin database.
 */
export async function runBpjsKontrolIfDue(now: Date = new Date()): Promise<void> {
  if (!(await getSettingBool('bpjs.enabled', false))) return;
  if (!(await getSettingBool('bpjs.kontrol_enabled', false))) return;

  const jam = await getSettingNumber('bpjs.kontrol_jam', 9);
  const penanda = await getSetting('bpjs.kontrol_last_run', '');
  if (!jatuhTempoHarian(now, jam, penanda ?? '')) return;

  /**
   * Penanda ditulis SESUDAH pekerjaannya berhasil, dan hanya kalau berhasil.
   *
   * Menulisnya lebih dulu tampak lebih aman -- ia menjamin pembacaan 18 ribu
   * baris tidak terulang -- tapi biaya yang dihindarinya ternyata tidak ada:
   * siklusnya tiap `polling.scan_interval_ms` (5 menit, bukan 1 menit) dan satu
   * pembacaan terukur ~35 ms, jadi mengulanginya sepanjang hari berjumlah
   * sekitar sepuluh detik waktu database. Yang dibayar sebagai gantinya jauh
   * lebih mahal: satu kegagalan sesaat -- MariaDB sedang terkunci SIMRS, jaringan
   * berkedip -- menghapus pengingat SEHARIAN untuk semua pasien yang kontrol
   * besok, dan tidak ada percobaan kedua.
   *
   * Mencoba ulang aman justru karena kunci idempotennya: pesan yang telanjur
   * masuk `outbox` sebelum kegagalannya ditolak `uq_idem` pada percobaan
   * berikutnya, jadi tidak ada pasien yang menerima dua kali.
   */
  try {
    await runBpjsKontrolJob(now);
  } catch {
    // Sudah dicatat di dalam. Penanda TIDAK dimajukan, jadi siklus berikutnya
    // mencobanya lagi.
    return;
  }
  await setSetting('bpjs.kontrol_last_run', tanggalLokal(now));
}
