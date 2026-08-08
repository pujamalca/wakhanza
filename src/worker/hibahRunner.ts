import { FarmasiTarget, getSetting, getSettingBool, getSettingNumber, logAudit } from '@/models';
import { pollHibahJendela, ambilDetailHibah, JENDELA_HIBAH_PENUH } from '@/khanza/hibah';
import {
  pecahDaftarBarangHibah,
  kelompokkanDetailHibah,
  namaPemberiHibah,
  type BarisHibah,
  type BarisDetailHibah,
} from '@/core/hibah';
import { formatRupiah, formatTanggalDokumen, BATAS_KARAKTER_NOTA } from '@/core/notaBarang';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { loadFarmasiContext, enqueueMessage, saringKunciBaru } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * HIBAH OBAT & BHP -- nota penerimaan barang pemberian, dikirim ke gudang/apotek
 * begitu transaksinya disimpan di Khanza.
 *
 * Kembaran `pengadaanRunner.ts`, dan sengaja dibentuk sedekat mungkin dengannya.
 * Yang perlu dibaca sebelum menyentuh berkas ini adalah bagian yang BERBEDA;
 * yang sama alasannya sudah tertulis lengkap di sana dan tidak diulang di sini.
 *
 * ==========================================================================
 * Kelas PINDAI, dan sekali lagi bentuk tabelnya yang memaksanya
 * ==========================================================================
 *
 * `hibah_obat_bhp` tidak punya kolom jam sama sekali -- hanya `tgl_hibah`
 * bertipe DATE, dan tanggal itu DIPILIH staf. Watermark karena itu mustahil
 * benar. Uraian lengkapnya berikut bacaan sumber Khanza-nya ada di
 * `khanza/hibah.ts`.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak ada satu pun pasien yang terlibat
 * ==========================================================================
 *
 * Sebuah penerimaan hibah tidak menyebut seorang pasien pun, dan TIDAK BISA --
 * `hibah_obat_bhp`/`detailhibah_obat_bhp` tidak punya satu kolom pun yang
 * menautkannya. Akibat langsungnya, tiga hal yang selalu jadi pertanyaan pada
 * pemicu lain di sini terjawab sendiri:
 *
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *                  `FARMASI_HIBAH` sengaja TIDAK didaftarkan ke
 *                  `OPT_OUT_TRIGGERS` (core/optOut.ts).
 *   jam tenang     DILEWATI, alasan yang sama dengan pengadaan dan notifikasi
 *                  farmasi: jam tenang melindungi orang yang tidur di rumah,
 *                  bukan gudang yang menerima barang.
 *   poli sensitif  tidak relevan; tidak ada poli pada sebuah penerimaan hibah.
 */

export const TRIGGER_HIBAH = 'FARMASI_HIBAH';
const AKTOR = 'system:hibah';

export interface TujuanHibah {
  id: number;
  chatId: string;
  label: string;
}

/**
 * Tujuan yang menerima nota hibah.
 *
 * Menyaring `terimaHibah`, BUKAN `isActive` dan BUKAN `terimaPengadaan`. Tiap
 * kolom di `farmasi_target` menjawab pertanyaan yang berbeda (migrations/031),
 * dan pemisahan yang ini ada karena batas kerahasiaannya berbeda dari nota
 * pembelian -- lihat komentar di modelnya.
 */
export async function muatTujuanHibah(): Promise<TujuanHibah[]> {
  const rows = await FarmasiTarget.findAll({
    where: { terimaHibah: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/**
 * Satu penerimaan hibah jadi satu-atau-beberapa set variabel.
 *
 * Diekspor supaya PRATINJAU di halaman `/farmasi` memakai fungsi yang SAMA
 * dipakai worker saat benar-benar mengirim -- pratinjau yang berbeda dari
 * kenyataan lebih buruk daripada tanpa pratinjau.
 */
export function susunVarsHibah(
  header: BarisHibah,
  detail: BarisDetailHibah[],
  sekarang: Date,
): Array<Partial<Record<TemplateVariable, string>>> {
  const dasar: Partial<Record<TemplateVariable, string>> = {
    no_hibah: header.no_hibah,
    tgl_hibah: formatTanggalDokumen(header.tgl_hibah),
    nama_pemberi: namaPemberiHibah(header.nama_pemberi),
    nama_petugas: header.nama_petugas ?? '',
    nama_gudang: header.nm_bangsal ?? '',
    jumlah_item: String(detail.length),
    /**
     * Kedua total SELALU terisi -- `farmasi.hibah_nilai` hanya memutus nilai per
     * barang. Kalau keduanya ikut dimatikan, templatenya menyisakan dua baris
     * label yang menggantung; uraiannya di `khanza/hibah.ts`.
     */
    total_hibah: formatRupiah(header.totalhibah),
    total_diakui: formatRupiah(header.totalnilai),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };

  // Daftar dipecah SEBELUM template dirender, supaya tiap bagian adalah nota
  // utuh: kepalanya, potongan barangnya, dan totalnya. Alasan lengkapnya di
  // `pengadaanRunner.ts`.
  const potongan = pecahDaftarBarangHibah(detail, BATAS_KARAKTER_NOTA);
  return potongan.length > 0
    ? potongan.map((teks) => ({ ...dasar, daftar_barang: teks }))
    : [{ ...dasar, daftar_barang: '' }];
}

/**
 * Per (`no_hibah`, tujuan), dan TANPA stempel waktu -- jendela pindai membaca
 * baris yang sama tiap lima menit selama berhari-hari, jadi kunci yang selalu
 * baru berarti gudang dibanjiri nota yang sama. `chatId` WAJIB ikut, dengan
 * alasan yang sudah dibayar di notifikasi farmasi.
 */
function kunciHibah(noHibah: string, chatId: string): string {
  return buildIdempotencyKey(TRIGGER_HIBAH, noHibah, chatId);
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelarnya diperiksa SETIAP kali, bukan sekali saat worker mulai -- staf yang
 * mematikannya dari dashboard harus berlaku dalam satu siklus.
 */
export async function runHibahCycle(): Promise<void> {
  if (!(await getSettingBool('farmasi.hibah_enabled', false))) return;

  const [lookback, kuota, sejak, sertakanNilai] = await Promise.all([
    getSettingNumber('farmasi.hibah_lookback_hari', 7),
    getSettingNumber('farmasi.hibah_max_per_siklus', 5),
    getSetting('farmasi.hibah_sejak'),
    getSettingBool('farmasi.hibah_nilai', true),
  ]);

  /**
   * Tujuan diperiksa DI DEPAN, sebelum `sik` disentuh sama sekali.
   *
   * Sakelar yang menyala tanpa satu pun tujuan tercentang bergejala persis
   * seperti yang benar: halaman tampak wajar, nol pesan keluar. Dicatat `warn`
   * justru karena itu -- dan tanpa membaca `hibah_obat_bhp` lebih dulu, karena
   * tidak ada gunanya membaca sesuatu yang tidak akan dikirim ke mana pun.
   */
  const tujuan = await muatTujuanHibah();
  if (tujuan.length === 0) {
    logger.warn({}, 'hibah menyala tapi belum ada tujuan yang mencentang "terima hibah"');
    return;
  }

  const jendela = hitungJendelaPindai(new Date(), lookback, sejak?.trim() || null);

  let header: BarisHibah[];
  try {
    header = await pollHibahJendela(jendela.dari, jendela.sampai);
  } catch (err) {
    // Tidak ada watermark yang bisa tertinggal salah -- jendelanya dihitung ulang
    // dari tanggal hari ini tiap siklus, jadi kegagalan sesaat pulih sendiri.
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca jendela hibah');
    return;
  }

  if (header.length >= JENDELA_HIBAH_PENUH) {
    logger.warn(
      { ...jendela, terbaca: header.length },
      'jendela hibah terbaca PENUH -- baris tertua mungkin belum terjangkau, persempit lookback-nya',
    );
  }
  if (header.length === 0) return;

  /**
   * Dedup DULU, kuota belakangan.
   *
   * Terbalik, kuota per siklus habis dimakan baris yang sudah terkirim kemarin
   * dan yang baru tidak pernah kebagian -- kegagalan yang tidak meninggalkan
   * satu pun galat. Pelajaran yang sama sudah dibayar di `suratRunner.ts`.
   */
  const tujuanPertama = tujuan[0];
  if (!tujuanPertama) return;
  const belum = await saringKunciBaru(header, (h) => kunciHibah(h.no_hibah, tujuanPertama.chatId));
  if (belum.length === 0) return;

  const dikerjakan = belum.slice(0, Math.max(0, kuota));
  const ditunda = belum.length - dikerjakan.length;
  if (dikerjakan.length === 0) return;

  let detail: BarisDetailHibah[];
  try {
    detail = await ambilDetailHibah(
      dikerjakan.map((h) => h.no_hibah),
      sertakanNilai,
    );
  } catch (err) {
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca rincian hibah');
    return;
  }
  const perNomor = kelompokkanDetailHibah(detail);

  const body = (await getSetting('farmasi.template_hibah', '')) ?? '';
  // `genericBody` sengaja SAMA dengan `body` -- jalur generik `checkPrivacy()`
  // tidak akan pernah menyala di sini (tidak ada poli pada sebuah hibah), jadi
  // "kalau toh menyala" berarti pesan yang identik, bukan pesan kosong.
  const ctx = await loadFarmasiContext(TRIGGER_HIBAH, body, body);

  const sekarang = new Date();
  let terkirim = 0;
  for (const h of dikerjakan) {
    const bagian = susunVarsHibah(h, perNomor.get(h.no_hibah) ?? [], sekarang);
    // BAGIAN di luar, TUJUAN di dalam -- urutan terbalik akan mengirim seluruh
    // bagian ke grup pertama sebelum grup kedua menerima apa pun.
    for (const [i, vars] of bagian.entries()) {
      for (const t of tujuan) {
        await enqueueMessage(
          {
            idempotencyKey: turunkanKunciBagian(kunciHibah(h.no_hibah, t.chatId), i),
            noRkmMedis: null,
            rawPhone: null,
            chatId: t.chatId,
            /**
             * Waktu DETEKSI, bukan `tgl_hibah` -- tanggal serah terima bisa
             * berumur berminggu-minggu saat entrinya dibuat, dan memakainya akan
             * membuat nota yang baru saja dimasukkan dinilai basi lalu ditandai
             * `expired` (F5.3) tanpa pernah terkirim.
             */
            eventAt: sekarang,
            vars,
          },
          ctx,
        );
      }
    }
    terkirim++;
  }

  await logAudit(
    AKTOR,
    'hibah_kirim',
    dikerjakan.map((h) => h.no_hibah).join(','),
    `${terkirim} hibah, ${tujuan.length} tujuan, nilai=${sertakanNilai ? 'ikut' : 'tidak'}`,
  );

  logger.info(
    {
      ...jendela,
      terbaca: header.length,
      baru: belum.length,
      terkirim,
      tujuan: tujuan.length,
      ...(ditunda ? { ditundaKuota: ditunda } : {}),
    },
    'siklus hibah selesai',
  );
}
