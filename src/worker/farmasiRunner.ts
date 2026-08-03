import { FarmasiTarget, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { buildIdempotencyKey } from '@/core/idempotency';
import type { TemplateVariable } from '@/core/template';
import { pollResepValidasi, pollResepPenyerahan, type ResepStafRow } from '@/khanza/farmasiStaf';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { getCursor, advanceCursor, recordCursorError } from './cursor';
import { logger, safeError } from '@/lib/logger';

/**
 * NOTIFIKASI FARMASI -- kelas pemicu kelima, dan satu-satunya yang penerimanya
 * staf rumah sakit alih-alih pasien.
 *
 * Tidak memakai `runSisipCycle()` seperti empat pemicu sisip lain, dan itu
 * bukan duplikasi yang terlewat: siklus sisip memetakan satu baris `sik`
 * menjadi SATU pesan ke SATU pasien. Di sini satu resep menyebar ke SEMUA
 * tujuan aktif (grup apotek, nomor kepala instalasi, ...), dan di atas ambang
 * tertentu seluruh siklus berubah bentuk menjadi satu pesan rekap. Memaksakan
 * keduanya ke dalam satu fungsi generik akan menambah dua parameter yang hanya
 * dipakai satu pemanggil.
 */

interface DefinisiPemicu {
  triggerCode: string;
  kunciSakelar: string;
  kunciTemplate: string;
  kunciRekap: string;
  fetchRows: (cursorTs: Date, lookbackDays: number) => Promise<ResepStafRow[]>;
  labelRekap: string;
}

const PEMICU: DefinisiPemicu[] = [
  {
    triggerCode: 'FARMASI_VALIDASI',
    kunciSakelar: 'farmasi.validasi_enabled',
    kunciTemplate: 'farmasi.template_validasi',
    kunciRekap: 'farmasi.template_rekap',
    fetchRows: pollResepValidasi,
    labelRekap: 'divalidasi',
  },
  {
    triggerCode: 'FARMASI_PENYERAHAN',
    kunciSakelar: 'farmasi.penyerahan_enabled',
    kunciTemplate: 'farmasi.template_penyerahan',
    kunciRekap: 'farmasi.template_rekap',
    fetchRows: pollResepPenyerahan,
    labelRekap: 'diserahkan',
  },
];

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

function varsUntukResep(row: ResepStafRow): Partial<Record<TemplateVariable, string>> {
  return {
    no_resep: row.no_resep,
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    nama_poli: row.nm_poli ?? '',
    nama_dokter: row.nm_dokter ?? '',
    tanggal: row.tgl_kejadian,
    jam: row.jam_kejadian,
  };
}

export interface TargetAktif {
  id: number;
  chatId: string;
  label: string;
}

export async function muatTargetAktif(): Promise<TargetAktif[]> {
  const rows = await FarmasiTarget.findAll({ where: { isActive: true }, order: [['id', 'ASC']] });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/**
 * Satu siklus untuk satu pemicu.
 *
 * Dipisahkan dan diekspor supaya bisa dijalankan langsung saat verifikasi --
 * yang diuji harus fungsi yang SAMA dipakai worker, bukan tiruannya.
 */
export async function runFarmasiCycle(pemicu: DefinisiPemicu, targets: TargetAktif[]): Promise<number> {
  const lookbackDays = await getSettingNumber('polling.lookback_days', 30);
  const cursorTs = await getCursor(pemicu.triggerCode, lookbackDays);

  let rows: ResepStafRow[];
  try {
    rows = await pemicu.fetchRows(cursorTs, lookbackDays);
  } catch (err) {
    const e = safeError(err);
    logger.error({ triggerCode: pemicu.triggerCode, ...e }, 'siklus farmasi gagal, watermark tidak dimajukan');
    await recordCursorError(pemicu.triggerCode, e.message);
    return 0;
  }

  if (rows.length === 0) return 0;

  const [body, bodyGenerik, bodyRekap, maxPerCycle] = await Promise.all([
    getSetting(pemicu.kunciTemplate, ''),
    getSetting('farmasi.template_generic', ''),
    getSetting(pemicu.kunciRekap, ''),
    getSettingNumber('farmasi.max_per_cycle', 20),
  ]);

  const ctx = await loadFarmasiContext(pemicu.triggerCode, body ?? '', bodyGenerik ?? '');

  // Waktu kejadian TERBESAR yang terbaca -- dipakai memajukan watermark, dan
  // (pada jalur rekap) sebagai event_at satu-satunya pesan yang dikirim.
  let maxTs = cursorTs;
  for (const row of rows) {
    const at = parseSikDateTime(row.tgl_kejadian, row.jam_kejadian);
    if (at > maxTs) maxTs = at;
  }

  if (rows.length > maxPerCycle) {
    /**
     * Ambang terlampaui: SATU pesan rekap per tujuan, bukan sekian puluh pesan
     * satuan.
     *
     * Ini bukan penghematan melainkan syarat agar sistemnya tetap hidup. Pagi
     * sibuk menghasilkan puluhan resep dalam satu siklus 60 detik; mengirimnya
     * satu per satu adalah persis pola beruntun yang memicu deteksi spam
     * WhatsApp (PRD F5.2) -- dan yang diblokir adalah SATU-SATUNYA nomor rumah
     * sakit, sehingga notifikasi pasien ikut mati bersamanya.
     *
     * Kunci idempotennya memakai watermark BARU (bukan nomor resep, yang di
     * sini ada banyak), jadi rekap yang sama tidak terkirim dua kali bila
     * siklusnya sempat tumpang tindih.
     */
    const ctxRekap = await loadFarmasiContext(pemicu.triggerCode, bodyRekap ?? '', bodyRekap ?? '');
    for (const target of targets) {
      await enqueueMessage(
        {
          idempotencyKey: buildIdempotencyKey(
            `${pemicu.triggerCode}_REKAP`,
            maxTs.toISOString(),
            String(rows.length),
            target.chatId,
          ),
          noRkmMedis: null,
          rawPhone: null,
          chatId: target.chatId,
          eventAt: maxTs,
          vars: {
            jumlah_resep: String(rows.length),
            tanggal: rows[0]?.tgl_kejadian ?? '',
            jam: rows[0]?.jam_kejadian ?? '',
          },
        },
        ctxRekap,
      );
    }
    logger.warn(
      { triggerCode: pemicu.triggerCode, jumlah: rows.length, maxPerCycle, tujuan: targets.length },
      'resep melebihi ambang satu siklus, dikirim sebagai satu rekap',
    );
    await advanceCursor(pemicu.triggerCode, maxTs, rows.length);
    return rows.length;
  }

  for (const row of rows) {
    const eventAt = parseSikDateTime(row.tgl_kejadian, row.jam_kejadian);
    for (const target of targets) {
      await enqueueMessage(
        {
          // chat_id ikut ke dalam kunci: tanpa itu, tujuan KEDUA dan seterusnya
          // ditolak `uq_idem` sebagai duplikat, dan hanya satu grup yang pernah
          // menerima apa pun -- kegagalan yang tidak meninggalkan galat sama
          // sekali karena INSERT-nya memang sengaja `ignoreDuplicates`.
          idempotencyKey: buildIdempotencyKey(pemicu.triggerCode, row.no_resep, target.chatId),
          noRkmMedis: row.no_rkm_medis,
          rawPhone: null,
          chatId: target.chatId,
          eventAt,
          kdPoli: row.kd_poli,
          vars: varsUntukResep(row),
        },
        ctx,
      );
    }
  }

  await advanceCursor(pemicu.triggerCode, maxTs, rows.length);
  logger.info(
    { triggerCode: pemicu.triggerCode, resep: rows.length, tujuan: targets.length },
    'siklus farmasi selesai',
  );
  return rows.length;
}

/**
 * Dipanggil worker tiap `polling.interval_ms`.
 *
 * Sakelar utama diperiksa SETIAP siklus, bukan sekali saat worker mulai --
 * staf yang mematikan notifikasi farmasi dari dashboard harus berlaku dalam
 * satu siklus, bukan menunggu worker dimulai ulang.
 *
 * Watermark TIDAK dimajukan selama fitur mati. Itu disengaja dan punya akibat
 * yang harus diketahui: menyalakannya kembali setelah lama mati akan membaca
 * seluruh resep sejak terakhir aktif sekaligus -- yang justru akan tertangkap
 * jalur rekap di atas alih-alih meledak jadi ratusan pesan.
 */
export async function runFarmasiCycles(): Promise<void> {
  if (!(await getSettingBool('farmasi.enabled', false))) return;

  const targets = await muatTargetAktif();
  if (targets.length === 0) {
    // Bukan kesalahan: sakelarnya menyala tapi belum ada tujuan yang dipasang.
    // Dicatat debug supaya tidak berisik tiap 60 detik, tapi halaman /farmasi
    // menampilkannya sebagai peringatan -- di sanalah orang yang bisa
    // memperbaikinya sedang melihat.
    logger.debug('notifikasi farmasi menyala tapi belum ada tujuan aktif');
    return;
  }

  for (const pemicu of PEMICU) {
    if (!(await getSettingBool(pemicu.kunciSakelar, true))) continue;
    await runFarmasiCycle(pemicu, targets);
  }
}

/** Untuk halaman /farmasi: daftar pemicu beserta kunci pengaturannya. */
export const PEMICU_FARMASI = PEMICU.map((p) => ({
  triggerCode: p.triggerCode,
  kunciSakelar: p.kunciSakelar,
  kunciTemplate: p.kunciTemplate,
  labelRekap: p.labelRekap,
}));
