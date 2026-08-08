import { FarmasiTarget, getSetting, getSettingBool, getSettingNumber, logAudit } from '@/models';
import {
  pollPemesananJendela,
  ambilDetailPemesanan,
  JENDELA_PEMESANAN_PENUH,
} from '@/khanza/pemesanan';
import {
  pecahDaftarBarangPemesanan,
  kelompokkanDetailPemesanan,
  type BarisPemesanan,
  type BarisDetailPemesanan,
} from '@/core/pemesanan';
import { formatRupiah, formatTanggalDokumen, BATAS_KARAKTER_NOTA } from '@/core/notaBarang';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { loadFarmasiContext, enqueueMessage, saringKunciBaru } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * SURAT PEMESANAN -- nota pesanan obat/alkes/BHP ke pemasok, dikirim ke
 * gudang/apotek begitu pesanannya disimpan di Khanza.
 *
 * ==========================================================================
 * Pasangan PENGADAAN dari ujung yang lain, bukan salinannya
 * ==========================================================================
 *
 *   SURAT PEMESANAN (ini)   pesanan DIKIRIM ke pemasok    "sedang dipesan"
 *   PENGADAAN               barang DITERIMA dari pemasok  "sudah datang"
 *
 * Bentuk yang sama dengan LAB_REQUEST/LAB_RESULT (migrations/025). Khanza
 * sendiri yang menyambung keduanya: `DlgPembelian.java:1810-1826` membaca
 * `surat_pemesanan_medis` untuk mengisi layar pembelian, jadi kedatangan barang
 * melahirkan baris `pembelian` tersendiri yang sudah diberitakan PENGADAAN.
 * Pemicu ini karena itu berbunyi tepat sekali, saat pesanannya disimpan --
 * memberitakan kedatangan di sini berarti gudang menerima dua pesan untuk satu
 * kejadian, dari dua fitur yang tidak saling tahu.
 *
 * ==========================================================================
 * Kelas PINDAI, lewat sebab yang sama persis dengan PENGADAAN dan HIBAH
 * ==========================================================================
 *
 * `surat_pemesanan_medis` tidak punya kolom jam sama sekali -- hanya `tanggal`
 * bertipe DATE yang DIPILIH staf. Watermark karena itu mustahil benar. Uraian
 * lengkapnya berikut pengukurannya ada di `khanza/pemesanan.ts`.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak ada satu pun pasien yang terlibat
 * ==========================================================================
 *
 * Sebuah surat pemesanan tidak menyebut seorang pasien pun, dan TIDAK BISA --
 * kedua tabelnya tidak punya satu kolom pun yang menautkannya. Akibat
 * langsungnya, tiga hal yang selalu jadi pertanyaan pada pemicu lain terjawab
 * sendiri:
 *
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *                  `FARMASI_PEMESANAN` sengaja TIDAK didaftarkan ke
 *                  `OPT_OUT_TRIGGERS` (core/optOut.ts).
 *   jam tenang     DILEWATI, alasan yang sama dengan notifikasi farmasi: jam
 *                  tenang melindungi orang yang tidur di rumah, bukan gudang.
 *   poli sensitif  tidak relevan; tidak ada poli pada sebuah pesanan.
 */

export const TRIGGER_PEMESANAN = 'FARMASI_PEMESANAN';
const AKTOR = 'system:pemesanan';

export interface TujuanPemesanan {
  id: number;
  chatId: string;
  label: string;
}

/**
 * Tujuan yang menerima nota pesanan.
 *
 * Menyaring `terimaPemesanan`, BUKAN `isActive` dan bukan `terimaPengadaan`.
 * Keenam kolom di `farmasi_target` menjawab pertanyaan yang berbeda-beda, dan
 * pemisahan yang ini soal WAKTU bukan kerahasiaan: nota pesanan berguna bagi
 * yang perlu tahu sesuatu sedang DALAM PERJALANAN, nota pembelian bagi yang
 * mencocokkan barang yang SUDAH datang (migrations/030).
 */
export async function muatTujuanPemesanan(): Promise<TujuanPemesanan[]> {
  const rows = await FarmasiTarget.findAll({
    where: { terimaPemesanan: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/**
 * Satu pesanan jadi satu-atau-beberapa set variabel.
 *
 * Diekspor supaya PRATINJAU di halaman `/farmasi` memakai fungsi yang SAMA
 * dipakai worker saat benar-benar mengirim -- pratinjau yang berbeda dari
 * kenyataan lebih buruk daripada tanpa pratinjau.
 */
export function susunVarsPemesanan(
  header: BarisPemesanan,
  detail: BarisDetailPemesanan[],
  sekarang: Date,
): Array<Partial<Record<TemplateVariable, string>>> {
  const dasar: Partial<Record<TemplateVariable, string>> = {
    no_pemesanan: header.no_pemesanan,
    tgl_pemesanan: formatTanggalDokumen(header.tanggal),
    nama_suplier: header.nama_suplier ?? '',
    nama_petugas: header.nama_petugas ?? '',
    status: header.status ?? '',
    jumlah_item: String(detail.length),
    total: formatRupiah(header.total1),
    potongan: formatRupiah(header.potongan),
    ppn: formatRupiah(header.ppn),
    meterai: formatRupiah(header.meterai),
    tagihan: formatRupiah(header.tagihan),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };

  /**
   * Daftar dipecah SEBELUM template dirender, bukan sesudah.
   *
   * Memecah teks yang sudah jadi berarti memotong di tengah kalimat pembuka yang
   * ditulis staf, dan bagian kedua akan dibuka oleh potongan sembarang tanpa
   * nomor pemesanan maupun nama pemasok. Dengan memecah daftarnya lebih dulu,
   * tiap bagian adalah nota utuh: kepalanya, potongan barangnya, dan totalnya.
   *
   * Berbeda dari pengadaan, TIDAK ada cabang "daftar kosong" di sini: pesanan
   * tanpa satu baris rincian pun sudah disaring lebih dulu oleh runner-nya, dan
   * alasannya ada di sana.
   */
  return pecahDaftarBarangPemesanan(detail, BATAS_KARAKTER_NOTA).map((teks) => ({
    ...dasar,
    daftar_barang: teks,
  }));
}

function kunciPemesanan(noPemesanan: string, chatId: string): string {
  /**
   * Per (`no_pemesanan`, tujuan). TANPA stempel waktu, dan TANPA `status`.
   *
   * Tanpa stempel waktu karena jendela pindai membaca pesanan yang sama tiap
   * lima menit selama berhari-hari; kunci yang selalu baru berarti gudang
   * dibanjiri nota yang sama sampai jendelanya lewat.
   *
   * Tanpa `status` walau BOOK_CONFIRM/BOOK_CANCEL justru memasukkannya -- dan
   * inilah keputusan yang paling gampang keliru di berkas ini. Di sana status
   * menandai KEJADIAN yang berbeda (booking dikonfirmasi vs dibatalkan). Di sini
   * ia sakelar alur kerja yang dibalik staf lewat klik kanan, dan arah baliknya
   * TIDAK PUNYA PENJAGA SAMA SEKALI (`DlgCariSuratPemesanan.java:1230`). Kunci
   * yang memuatnya berarti satu orang yang bolak-balik menekan dua butir menu
   * itu bisa menghasilkan pesan tanpa batas ke grup gudang.
   *
   * `chatId` WAJIB ikut, dengan alasan yang sudah dibayar di notifikasi farmasi:
   * tanpa itu tujuan KEDUA dan seterusnya ditolak `uq_idem` sebagai duplikat dan
   * hanya satu grup yang pernah menerima apa pun -- tanpa satu pun galat, karena
   * INSERT-nya memang `ignoreDuplicates`.
   */
  return buildIdempotencyKey(TRIGGER_PEMESANAN, noPemesanan, chatId);
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelarnya diperiksa SETIAP kali, bukan sekali saat worker mulai -- staf yang
 * mematikannya dari dashboard harus berlaku dalam satu siklus, bukan menunggu
 * worker dimulai ulang oleh orang yang tidak tahu ia perlu melakukannya.
 */
export async function runPemesananCycle(): Promise<void> {
  if (!(await getSettingBool('farmasi.pemesanan_enabled', false))) return;

  const [lookback, kuota, sejak, sertakanHarga] = await Promise.all([
    getSettingNumber('farmasi.pemesanan_lookback_hari', 7),
    getSettingNumber('farmasi.pemesanan_max_per_siklus', 5),
    getSetting('farmasi.pemesanan_sejak'),
    getSettingBool('farmasi.pemesanan_harga', true),
  ]);

  /**
   * Tujuan diperiksa DI DEPAN, sebelum `sik` disentuh sama sekali.
   *
   * Sakelar yang menyala tanpa satu pun tujuan tercentang adalah keadaan
   * setengah jadi yang tidak seorang pun bermaksud membuatnya, dan ia bergejala
   * persis seperti yang benar: halaman tampak wajar, nol pesan keluar. Dicatat
   * `warn` justru karena itu -- dan tanpa membaca `surat_pemesanan_medis` lebih
   * dulu, karena tidak ada gunanya membaca sesuatu yang tidak akan dikirim ke
   * mana pun.
   */
  const tujuan = await muatTujuanPemesanan();
  if (tujuan.length === 0) {
    logger.warn({}, 'pemesanan menyala tapi belum ada tujuan yang mencentang "terima pemesanan"');
    return;
  }

  const jendela = hitungJendelaPindai(new Date(), lookback, sejak?.trim() || null);

  let header: BarisPemesanan[];
  try {
    header = await pollPemesananJendela(jendela.dari, jendela.sampai);
  } catch (err) {
    // Tidak ada watermark yang bisa tertinggal salah di sini -- jendelanya
    // dihitung ulang dari tanggal hari ini tiap siklus, jadi kegagalan sesaat
    // (MariaDB terkunci SIMRS, jaringan berkedip) pulih sendiri lima menit lagi.
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca jendela pemesanan');
    return;
  }

  if (header.length >= JENDELA_PEMESANAN_PENUH) {
    logger.warn(
      { ...jendela, terbaca: header.length },
      'jendela pemesanan terbaca PENUH -- pesanan tertua mungkin belum terjangkau, persempit lookback-nya',
    );
  }
  if (header.length === 0) return;

  /**
   * Dedup DULU, kuota belakangan.
   *
   * Terbalik, kuota per siklus habis dimakan pesanan yang sudah terkirim kemarin
   * dan yang baru tidak pernah kebagian -- kegagalan yang tidak meninggalkan
   * satu pun galat. Pelajaran yang sama sudah dibayar di `suratRunner.ts`.
   *
   * Disaring atas tujuan PERTAMA saja, dan itu cukup: seluruh tujuan di-enqueue
   * dalam satu perulangan, jadi sebuah pesanan yang sudah terkirim ke tujuan
   * pertama pasti sudah terkirim ke semuanya. `uq_idem` tetap penjaga
   * terakhirnya bila ternyata tidak (mis. tujuan baru ditambahkan sesudahnya).
   */
  const tujuanPertama = tujuan[0];
  if (!tujuanPertama) return;
  const belum = await saringKunciBaru(header, (h) => kunciPemesanan(h.no_pemesanan, tujuanPertama.chatId));
  if (belum.length === 0) return;

  /**
   * Rincian dibaca untuk SELURUH pesanan baru, SEBELUM kuota diterapkan -- dan
   * urutan itulah bagian terpenting dari fungsi ini.
   *
   * Pengadaan membaca rinciannya SESUDAH kuota, dan di sana itu benar karena
   * setiap fakturnya pasti jadi pesan. Di sini tidak: sebuah pesanan tanpa satu
   * baris rincian pun TIDAK dikirim (lihat di bawah), dan sebuah pesanan yang
   * tidak dikirim tidak pernah menghasilkan baris `outbox` -- sehingga ia juga
   * tidak pernah tersaring `saringKunciBaru` pada siklus berikutnya.
   *
   * Kalau kuota diterapkan lebih dulu, pesanan kosong semacam itu memakan
   * jatahnya SETIAP siklus, selamanya. Dengan kuota 5 dan sembilan pesanan
   * kosong di dalam jendela -- bentuk data yang benar-benar ada di arsip `sik` --
   * tidak satu pun pesanan yang sah akan pernah terkirim, tanpa satu pun galat.
   * Bentuk kegagalan yang sama persis dengan yang membuat pemeriksaan kuota di
   * `core/suratOtomatis.ts` diletakkan paling akhir.
   *
   * Yang dibayar sebagai gantinya: satu query `IN` beruas paling banyak 300
   * nomor, lewat indeks, sekali per lima menit. Terukur 3,1 rincian per pesanan.
   */
  let detail: BarisDetailPemesanan[];
  try {
    detail = await ambilDetailPemesanan(
      belum.map((h) => h.no_pemesanan),
      sertakanHarga,
    );
  } catch (err) {
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca rincian pemesanan');
    return;
  }
  const perPemesanan = kelompokkanDetailPemesanan(detail);

  /**
   * Pesanan tanpa satu baris rincian pun DILEWATI, tidak dikirim sebagai nota
   * kosong -- dan ini perbedaan yang disengaja dari pengadaan.
   *
   * Pengadaan tetap mengirim satu pesan untuk faktur tanpa rincian, dengan
   * alasan bahwa staf mungkin menyimpan header lalu mengisi barangnya
   * belakangan, dan mendiamkannya berarti nota itu tidak pernah diberitahukan.
   * Alasan itu tidak berlaku di sini, dan justru kebalikannya yang benar:
   * jendelanya dipindai ULANG tiap siklus selama berhari-hari, jadi pesanan yang
   * barangnya diisi setengah jam kemudian tetap terkirim -- lengkap. Melewatinya
   * bukan "tidak pernah diberitahukan" melainkan "diberitahukan begitu ia jadi
   * nota".
   *
   * Dan sebuah surat pemesanan tanpa barang bukan pesanan: pesannya akan
   * berbunyi "Barang (0):" lalu kosong, diikuti tagihan berisi angka. Itu
   * terbaca sebagai sistem rusak, dan sejak itu nota yang benar pun tidak
   * dipercaya.
   *
   * Bentuk datanya nyata, bukan kehati-hatian: di arsip `sik`, SEMBILAN dari
   * sepuluh header tidak punya rincian sama sekali. Di keempat database yang
   * sehat, NOL dari 91. Jadi dalam pemakaian normal cabang ini tidak pernah
   * menyala -- ia ada untuk data yang sudah terbukti bisa berbentuk begitu.
   * Dicatat `warn` supaya keadaan itu terlihat alih-alih hilang diam-diam.
   */
  const kosong = belum.filter((h) => (perPemesanan.get(h.no_pemesanan) ?? []).length === 0);
  if (kosong.length > 0) {
    logger.warn(
      { nomor: kosong.map((h) => h.no_pemesanan), jumlah: kosong.length },
      'pesanan tanpa satu baris rincian pun dilewati -- akan dikirim begitu barangnya terisi',
    );
  }
  const layak = belum.filter((h) => (perPemesanan.get(h.no_pemesanan) ?? []).length > 0);
  if (layak.length === 0) return;

  const dikerjakan = layak.slice(0, Math.max(0, kuota));
  const ditunda = layak.length - dikerjakan.length;
  if (dikerjakan.length === 0) return;

  const body = (await getSetting('farmasi.template_pemesanan', '')) ?? '';
  /**
   * `genericBody` sengaja SAMA dengan `body`.
   *
   * `checkPrivacy()` tetap dijalankan `enqueueMessage` untuk tiap baris, dan
   * jalur generiknya tidak akan pernah menyala di sini karena tidak ada `kdPoli`
   * maupun `kdJenisPrw` yang diserahkan -- sebuah pesanan tidak punya poli.
   * Menyerahkan template yang sama membuat "kalau toh menyala" berarti pesan
   * yang identik, bukan pesan kosong.
   */
  const ctx = await loadFarmasiContext(TRIGGER_PEMESANAN, body, body);

  const sekarang = new Date();
  let terkirim = 0;
  for (const h of dikerjakan) {
    const bagian = susunVarsPemesanan(h, perPemesanan.get(h.no_pemesanan) ?? [], sekarang);
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
            idempotencyKey: turunkanKunciBagian(kunciPemesanan(h.no_pemesanan, t.chatId), i),
            noRkmMedis: null,
            rawPhone: null,
            chatId: t.chatId,
            /**
             * Waktu DETEKSI, bukan `tanggal` -- pilihan yang sama dengan
             * PENGADAAN, HIBAH, dan SURAT_SAKIT. `tanggal` adalah tanggal yang
             * DIPILIH staf dan bisa berumur berhari-hari, dan memakainya akan
             * membuat pesanan yang baru saja disimpan dinilai basi lalu ditandai
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
    'pemesanan_kirim',
    dikerjakan.map((h) => h.no_pemesanan).join(','),
    `${terkirim} pesanan, ${tujuan.length} tujuan, harga=${sertakanHarga ? 'ikut' : 'tidak'}`,
  );

  logger.info(
    {
      ...jendela,
      terbaca: header.length,
      baru: belum.length,
      terkirim,
      tujuan: tujuan.length,
      ...(kosong.length ? { dilewatiTanpaRincian: kosong.length } : {}),
      ...(ditunda ? { ditundaKuota: ditunda } : {}),
    },
    'siklus pemesanan selesai',
  );
}
