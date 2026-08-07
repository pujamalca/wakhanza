import { FarmasiTarget, getSetting, getSettingBool, getSettingNumber, logAudit } from '@/models';
import {
  pollPengadaanJendela,
  ambilDetailPengadaan,
  JENDELA_PENGADAAN_PENUH,
} from '@/khanza/pengadaan';
import {
  pecahDaftarBarang,
  kelompokkanDetail,
  formatRupiah,
  formatTanggalBeli,
  BATAS_KARAKTER_PENGADAAN,
  type BarisPengadaan,
  type BarisDetailPengadaan,
} from '@/core/pengadaan';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { loadFarmasiContext, enqueueMessage, saringKunciBaru } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * PENGADAAN -- nota pembelian langsung obat/alkes/BHP, dikirim ke gudang/apotek
 * begitu transaksinya disimpan di Khanza.
 *
 * ==========================================================================
 * Kelas PINDAI, dan sekali lagi bentuk tabelnya yang memaksanya
 * ==========================================================================
 *
 * `pembelian` tidak punya kolom jam sama sekali -- hanya `tgl_beli` bertipe
 * DATE, dan tanggal itu DIPILIH staf (tanggal nota pemasok), bukan diisi jam
 * server. Jadi tidak ada satu pun nilai di tabel itu yang menyatakan "baris ini
 * tersimpan pukul sekian", dan watermark karena itu mustahil benar. Uraian
 * lengkapnya berikut pengukurannya ada di `khanza/pengadaan.ts`.
 *
 * Yang dipakai: jendela ±N hari yang dibaca ulang tiap siklus, dedup murni lewat
 * kunci idempoten -- bentuk yang sama dengan SURAT_SAKIT.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak ada satu pun pasien yang terlibat
 * ==========================================================================
 *
 * Ini yang membedakannya dari sembilan pemicu pasien DAN dari notifikasi resep:
 * sebuah nota pembelian tidak menyebut seorang pasien pun, dan TIDAK BISA --
 * `pembelian`/`detailbeli` tidak punya satu kolom pun yang menautkannya. Akibat
 * langsungnya, tiga hal yang selalu jadi pertanyaan pada pemicu lain di sini
 * terjawab sendiri:
 *
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan,
 *                  dan seorang pasien tidak bisa memberhentikan koordinasi kerja
 *                  internal RS. `PENGADAAN` sengaja TIDAK didaftarkan ke
 *                  `OPT_OUT_TRIGGERS` (core/optOut.ts).
 *   jam tenang     DILEWATI, alasan yang sama dengan notifikasi farmasi: jam
 *                  tenang melindungi orang yang tidur di rumah, bukan gudang
 *                  yang menerima barang. Diukur pula bahwa ini nyaris tidak
 *                  pernah menggigit -- dari 910 faktur, tidak satu pun tersimpan
 *                  lewat pukul 20:00.
 *   poli sensitif  tidak relevan; tidak ada poli pada sebuah pembelian.
 */

export const TRIGGER_PENGADAAN = 'FARMASI_PENGADAAN';
const AKTOR = 'system:pengadaan';

export interface TujuanPengadaan {
  id: number;
  chatId: string;
  label: string;
}

/**
 * Tujuan yang menerima nota pembelian.
 *
 * Menyaring `terimaPengadaan`, BUKAN `isActive`. Keempat kolom di
 * `farmasi_target` menjawab pertanyaan yang berbeda-beda (migrations/028), dan
 * pemisahan yang ini paling tajam: nota pembelian memuat harga beli dari
 * pemasok, yang punya nilai dagang tersendiri.
 */
export async function muatTujuanPengadaan(): Promise<TujuanPengadaan[]> {
  const rows = await FarmasiTarget.findAll({
    where: { terimaPengadaan: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/**
 * Satu faktur jadi satu-atau-beberapa set variabel.
 *
 * Diekspor supaya PRATINJAU di halaman `/farmasi` memakai fungsi yang SAMA
 * dipakai worker saat benar-benar mengirim -- pratinjau yang berbeda dari
 * kenyataan lebih buruk daripada tanpa pratinjau, pelajaran yang sudah dibayar
 * di kotak uji coba balasan otomatis, balasan stok, dan darurat stok.
 */
export function susunVarsPengadaan(
  header: BarisPengadaan,
  detail: BarisDetailPengadaan[],
  sekarang: Date,
): Array<Partial<Record<TemplateVariable, string>>> {
  const dasar: Partial<Record<TemplateVariable, string>> = {
    no_faktur: header.no_faktur,
    tgl_beli: formatTanggalBeli(header.tgl_beli),
    nama_suplier: header.nama_suplier ?? '',
    nama_petugas: header.nama_petugas ?? '',
    nama_gudang: header.nm_bangsal ?? '',
    jumlah_item: String(detail.length),
    total: formatRupiah(header.total1),
    potongan: formatRupiah(header.potongan),
    ppn: formatRupiah(header.ppn),
    tagihan: formatRupiah(header.tagihan),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };

  /**
   * Daftar dipecah SEBELUM template dirender, bukan sesudah.
   *
   * Memecah teks yang sudah jadi berarti memotong di tengah kalimat pembuka
   * yang ditulis staf, dan bagian kedua akan dibuka oleh potongan sembarang
   * tanpa nomor faktur maupun nama pemasok. Dengan memecah daftarnya lebih dulu,
   * tiap bagian adalah nota utuh: kepalanya, potongan barangnya, dan totalnya.
   */
  const potongan = pecahDaftarBarang(detail, BATAS_KARAKTER_PENGADAAN);
  // Faktur tanpa satu baris detail pun tetap menghasilkan SATU pesan: itu
  // keadaan yang benar-benar terjadi bila staf menyimpan header lalu mengisi
  // barangnya belakangan, dan mendiamkannya berarti nota itu tidak pernah
  // diberitahukan sama sekali.
  return potongan.length > 0
    ? potongan.map((teks) => ({ ...dasar, daftar_barang: teks }))
    : [{ ...dasar, daftar_barang: '' }];
}

function kunciPengadaan(noFaktur: string, chatId: string): string {
  /**
   * Per (`no_faktur`, tujuan), dan TANPA stempel waktu.
   *
   * Tanpa stempel waktu karena jendela pindai membaca faktur yang sama tiap lima
   * menit selama berhari-hari; kunci yang selalu baru berarti gudang dibanjiri
   * nota yang sama sampai jendelanya lewat.
   *
   * `chatId` WAJIB ikut, dengan alasan yang sudah dibayar di notifikasi farmasi:
   * tanpa itu tujuan KEDUA dan seterusnya ditolak `uq_idem` sebagai duplikat dan
   * hanya satu grup yang pernah menerima apa pun -- tanpa satu pun galat, karena
   * INSERT-nya memang `ignoreDuplicates`.
   */
  return buildIdempotencyKey(TRIGGER_PENGADAAN, noFaktur, chatId);
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelarnya diperiksa SETIAP kali, bukan sekali saat worker mulai -- staf yang
 * mematikannya dari dashboard harus berlaku dalam satu siklus, bukan menunggu
 * worker dimulai ulang oleh orang yang tidak tahu ia perlu melakukannya.
 */
export async function runPengadaanCycle(): Promise<void> {
  if (!(await getSettingBool('farmasi.pengadaan_enabled', false))) return;

  const [lookback, kuota, sejak, sertakanHarga] = await Promise.all([
    getSettingNumber('farmasi.pengadaan_lookback_hari', 7),
    getSettingNumber('farmasi.pengadaan_max_per_siklus', 5),
    getSetting('farmasi.pengadaan_sejak'),
    getSettingBool('farmasi.pengadaan_harga', true),
  ]);

  /**
   * Tujuan diperiksa DI DEPAN, sebelum `sik` disentuh sama sekali.
   *
   * Sakelar yang menyala tanpa satu pun tujuan tercentang adalah keadaan setengah
   * jadi yang tidak seorang pun bermaksud membuatnya, dan ia bergejala persis
   * seperti yang benar: halaman tampak wajar, nol pesan keluar. Dicatat `warn`
   * (bukan `debug`) justru karena itu -- dan tanpa membaca `pembelian` lebih
   * dulu, karena tidak ada gunanya membaca sesuatu yang tidak akan dikirim ke
   * mana pun.
   */
  const tujuan = await muatTujuanPengadaan();
  if (tujuan.length === 0) {
    logger.warn({}, 'pengadaan menyala tapi belum ada tujuan yang mencentang "terima pengadaan"');
    return;
  }

  const jendela = hitungJendelaPindai(new Date(), lookback, sejak?.trim() || null);

  let header: BarisPengadaan[];
  try {
    header = await pollPengadaanJendela(jendela.dari, jendela.sampai);
  } catch (err) {
    // Tidak ada watermark yang bisa tertinggal salah di sini -- jendelanya
    // dihitung ulang dari tanggal hari ini tiap siklus, jadi kegagalan sesaat
    // (MariaDB terkunci SIMRS, jaringan berkedip) pulih sendiri lima menit lagi.
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca jendela pengadaan');
    return;
  }

  if (header.length >= JENDELA_PENGADAAN_PENUH) {
    logger.warn(
      { ...jendela, terbaca: header.length },
      'jendela pengadaan terbaca PENUH -- faktur tertua mungkin belum terjangkau, persempit lookback-nya',
    );
  }
  if (header.length === 0) return;

  /**
   * Dedup DULU, kuota belakangan.
   *
   * Terbalik, kuota per siklus habis dimakan faktur yang sudah terkirim kemarin
   * dan yang baru tidak pernah kebagian -- kegagalan yang tidak meninggalkan
   * satu pun galat. Pelajaran yang sama sudah dibayar di `suratRunner.ts`.
   *
   * Disaring atas tujuan PERTAMA saja, dan itu cukup: seluruh tujuan di-enqueue
   * dalam satu perulangan, jadi sebuah faktur yang sudah terkirim ke tujuan
   * pertama pasti sudah terkirim ke semuanya. `uq_idem` tetap penjaga
   * terakhirnya bila ternyata tidak (mis. tujuan baru ditambahkan sesudahnya) --
   * yang dibeli penyaringan di depan cuma kuota yang tidak termakan sia-sia.
   */
  const tujuanPertama = tujuan[0];
  if (!tujuanPertama) return;
  const belum = await saringKunciBaru(header, (h) => kunciPengadaan(h.no_faktur, tujuanPertama.chatId));
  if (belum.length === 0) return;

  const dikerjakan = belum.slice(0, Math.max(0, kuota));
  const ditunda = belum.length - dikerjakan.length;
  if (dikerjakan.length === 0) return;

  let detail: BarisDetailPengadaan[];
  try {
    detail = await ambilDetailPengadaan(
      dikerjakan.map((h) => h.no_faktur),
      sertakanHarga,
    );
  } catch (err) {
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca rincian pengadaan');
    return;
  }
  const perFaktur = kelompokkanDetail(detail);

  const body = (await getSetting('farmasi.template_pengadaan', '')) ?? '';
  /**
   * `genericBody` sengaja SAMA dengan `body`.
   *
   * `checkPrivacy()` tetap dijalankan `enqueueMessage` untuk tiap baris, dan
   * jalur generiknya tidak akan pernah menyala di sini karena tidak ada `kdPoli`
   * maupun `kdJenisPrw` yang diserahkan -- sebuah pembelian tidak punya poli.
   * Menyerahkan template yang sama membuat "kalau toh menyala" berarti pesan
   * yang identik, bukan pesan kosong.
   */
  const ctx = await loadFarmasiContext(TRIGGER_PENGADAAN, body, body);

  const sekarang = new Date();
  let terkirim = 0;
  for (const h of dikerjakan) {
    const bagian = susunVarsPengadaan(h, perFaktur.get(h.no_faktur) ?? [], sekarang);
    /**
     * BAGIAN di luar, TUJUAN di dalam -- urutannya menentukan urutan baca.
     *
     * Baris `outbox` diambil dispatcher menurut urutan pembuatannya, jadi
     * perulangan yang terbalik akan mengirim seluruh bagian ke grup pertama
     * sebelum grup kedua menerima apa pun. Pelajaran yang sudah dibayar di
     * `stokDaruratRunner.ts`.
     */
    for (const [i, vars] of bagian.entries()) {
      for (const t of tujuan) {
        await enqueueMessage(
          {
            idempotencyKey: turunkanKunciBagian(kunciPengadaan(h.no_faktur, t.chatId), i),
            noRkmMedis: null,
            rawPhone: null,
            chatId: t.chatId,
            /**
             * Waktu DETEKSI, bukan `tgl_beli` -- pilihan yang sama dengan
             * BOOK_CONFIRM/BOOK_CANCEL dan SURAT_SAKIT. `tgl_beli` adalah
             * tanggal NOTA PEMASOK yang bisa berumur berminggu-minggu, dan
             * memakainya akan membuat nota yang baru saja dimasukkan dinilai
             * basi lalu ditandai `expired` (F5.3) tanpa pernah terkirim.
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
    'pengadaan_kirim',
    dikerjakan.map((h) => h.no_faktur).join(','),
    `${terkirim} faktur, ${tujuan.length} tujuan, harga=${sertakanHarga ? 'ikut' : 'tidak'}`,
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
    'siklus pengadaan selesai',
  );
}
