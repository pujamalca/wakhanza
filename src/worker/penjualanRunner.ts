import { Op } from 'sequelize';
import { FarmasiTarget, PenjualanPantau, getSetting, getSettingBool, getSettingNumber, logAudit } from '@/models';
import {
  pollPenjualanJendela,
  notaPenjualanYangAda,
  ambilRingkasPenjualan,
  ambilPenjualanTerpilih,
  ambilDetailPenjualan,
  JENDELA_PENJUALAN_PENUH,
} from '@/khanza/penjualan';
import {
  pecahDaftarBarangJual,
  kelompokkanDetailJual,
  hitungTotalNota,
  keteranganNota,
  type BarisPenjualan,
  type BarisDetailPenjualan,
} from '@/core/penjualan';
import { bandingkanPantau, bagiKuota, type JendelaNota, type NotaBaru } from '@/core/pantauPenjualan';
import { formatRupiah, formatTanggalDokumen, BATAS_KARAKTER_NOTA } from '@/core/notaBarang';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * PENJUALAN -- nota penjualan obat/alkes/BHP, dikirim ke gudang/apotek saat
 * transaksinya DISIMPAN dan saat DIHAPUS di Khanza.
 *
 * ==========================================================================
 * Yang membedakannya dari ketiga nota barang lain: DUA arah kejadian
 * ==========================================================================
 *
 * PENGADAAN, SURAT PEMESANAN, dan HIBAH semuanya cuma punya satu kejadian
 * ("baris ini muncul"). Yang ini punya dua, dan yang kedua tidak bisa dibaca
 * dari `sik` sama sekali: baris yang dihapus tidak meninggalkan apa pun.
 *
 * Mendeteksinya menuntut ingatan sendiri (`penjualan_pantau`, migrations/040),
 * dan keputusannya seluruhnya di `core/pantauPenjualan.ts` -- fungsi murni
 * berikut ujinya, karena satu-satunya kesalahan di fitur ini yang mengirim pesan
 * SALAH (bukan sekadar tidak mengirim) hidup di sana.
 *
 * ==========================================================================
 * SATU jendela, dihitung SEKALI, diserahkan ke keempat pembacaan
 * ==========================================================================
 *
 * Ini bukan kerapian melainkan syarat kebenaran. `bandingkanPantau()` menyimpulkan
 * "ada di buku pantau tapi tidak ada di `penjualan`" berarti terhapus, dan itu
 * hanya benar bila kedua pembacaan memakai jendela yang SAMA. Menghitungnya dua
 * kali membuat keduanya bisa jatuh di sisi berlawanan dari pergantian hari, dan
 * hasilnya adalah kabar pembatalan atas nota yang sebenarnya masih hidup.
 *
 * ==========================================================================
 * Penerimanya STAF, dan tidak ada pembeli yang disebut
 * ==========================================================================
 *
 *   daftar tolak   tidak berlaku -- tidak ada nomor pasien untuk dicocokkan.
 *                  `FARMASI_PENJUALAN` sengaja TIDAK didaftarkan ke
 *                  `OPT_OUT_TRIGGERS` (core/optOut.ts).
 *   jam tenang     DILEWATI, alasan yang sama dengan notifikasi farmasi: ia
 *                  melindungi orang yang tidur di rumah, bukan loket apotek.
 *   poli sensitif  tidak relevan; tidak ada poli pada sebuah penjualan.
 *
 * Identitas pembelinya TIDAK pernah dibaca sekalipun kolomnya ada -- lihat
 * komentar pembuka `khanza/penjualan.ts`.
 */

export const TRIGGER_PENJUALAN = 'FARMASI_PENJUALAN';
export const TRIGGER_PENJUALAN_HAPUS = 'FARMASI_PENJUALAN_HAPUS';
const AKTOR = 'system:penjualan';

export interface TujuanPenjualan {
  id: number;
  chatId: string;
  label: string;
}

/**
 * Tujuan yang menerima nota penjualan.
 *
 * Menyaring `terimaPenjualan`, BUKAN `isActive`. Ketujuh kolom di
 * `farmasi_target` menjawab pertanyaan yang berbeda-beda, dan yang ini terpisah
 * karena arah barangnya berlawanan dari pengadaan/pemesanan (migrations/040).
 */
export async function muatTujuanPenjualan(): Promise<TujuanPenjualan[]> {
  const rows = await FarmasiTarget.findAll({
    where: { terimaPenjualan: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/** Prefiks nota untuk batas jendela -- bentuk yang sama dipakai `khanza/penjualan.ts`. */
function jendelaNota(dari: string, sampai: string): JendelaNota {
  return { awal: `PJ${dari.replace(/-/g, '')}000`, akhir: `PJ${sampai.replace(/-/g, '')}999` };
}

/**
 * Kunci idempoten per (nota, tujuan), dan `generasi` ikut HANYA saat > 0.
 *
 * Tanpa stempel waktu, karena jendela pindai membaca nota yang sama tiap lima
 * menit selama berhari-hari -- kunci yang selalu baru berarti grup dibanjiri
 * nota yang sama sampai jendelanya lewat.
 *
 * `chatId` WAJIB ikut: tanpa itu tujuan KEDUA dan seterusnya ditolak `uq_idem`
 * sebagai duplikat dan hanya satu grup yang pernah menerima apa pun, tanpa satu
 * pun galat karena INSERT-nya memang `ignoreDuplicates`.
 *
 * `generasi` DIHILANGKAN saat 0 supaya nota yang sudah terlanjur dikabarkan
 * sebelum kolom itu ada tetap dikenali sebagai duplikat -- kunci yang berubah
 * bentuk adalah kunci yang membuat seluruh jendela terkirim ulang sekali.
 */
function kunciPenjualan(nota: string, chatId: string, generasi: number): string {
  return generasi > 0
    ? buildIdempotencyKey(TRIGGER_PENJUALAN, nota, chatId, `g${generasi}`)
    : buildIdempotencyKey(TRIGGER_PENJUALAN, nota, chatId);
}

function kunciPenjualanHapus(nota: string, chatId: string, generasi: number): string {
  return buildIdempotencyKey(TRIGGER_PENJUALAN_HAPUS, nota, chatId, `g${generasi}`);
}

/**
 * Satu nota jadi satu-atau-beberapa set variabel.
 *
 * Diekspor supaya PRATINJAU di `/farmasi` memakai fungsi yang SAMA dipakai
 * worker saat benar-benar mengirim -- pelajaran yang sudah dibayar di kotak uji
 * coba balasan otomatis, balasan stok, dan darurat stok.
 */
export function susunVarsPenjualan(
  header: BarisPenjualan,
  detail: BarisDetailPenjualan[],
  nota: {
    jmlItem: number | null;
    subtotal: number | null;
    ppn: number | null;
    ongkir: number | null;
    keterangan?: string | null;
  },
  sekarang: Date,
): Array<Partial<Record<TemplateVariable, string>>> {
  const dasar: Partial<Record<TemplateVariable, string>> = {
    no_nota: header.nota_jual,
    tgl_jual: formatTanggalDokumen(header.tgl_jual),
    jenis_jual: header.jns_jual ?? '',
    status_bayar: header.status ?? '',
    nama_gudang: header.nm_bangsal ?? '',
    nama_petugas: header.nama_petugas ?? '',
    /**
     * Teks bebas yang diketik kasir. Turunannya di `core/penjualan.ts` supaya
     * bisa diuji tanpa MariaDB, berikut alasan lengkap kenapa penanda Khanza
     * wajib dibuang dan kenapa sanitasinya diserahkan ke `renderTemplate`.
     */
    keterangan: keteranganNota(nota.keterangan),
    jumlah_item: String(nota.jmlItem ?? detail.length),
    subtotal: formatRupiah(nota.subtotal),
    ongkir: formatRupiah(nota.ongkir),
    ppn: formatRupiah(nota.ppn),
    total: formatRupiah(hitungTotalNota(nota.subtotal, nota.ppn, nota.ongkir)),
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };

  /**
   * Daftar dipecah SEBELUM template dirender, bukan sesudah. Memecah teks yang
   * sudah jadi berarti memotong di tengah kalimat pembuka yang ditulis staf, dan
   * bagian kedua dibuka oleh potongan sembarang tanpa nomor nota.
   */
  const potongan = pecahDaftarBarangJual(detail, BATAS_KARAKTER_NOTA);
  // Nota tanpa satu baris detail pun tetap menghasilkan SATU pesan -- keadaan
  // yang benar-benar terjadi (1 dari 16.787 di sini), dan mendiamkannya berarti
  // nota itu tidak pernah diberitahukan sama sekali.
  return potongan.length > 0
    ? potongan.map((teks) => ({ ...dasar, daftar_barang: teks }))
    : [{ ...dasar, daftar_barang: '' }];
}

/** Variabel pesan PEMBATALAN -- sengaja tanpa isi nota. Lihat migrations/040. */
export function susunVarsPenjualanHapus(
  nota: string,
  sekarang: Date,
): Partial<Record<TemplateVariable, string>> {
  return {
    no_nota: nota,
    tanggal: formatTanggalPesan(sekarang),
    jam: formatJamPesan(sekarang),
  };
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelarnya diperiksa SETIAP kali, bukan sekali saat worker mulai -- staf yang
 * mematikannya dari dashboard harus berlaku dalam satu siklus, bukan menunggu
 * worker dimulai ulang oleh orang yang tidak tahu ia perlu melakukannya.
 */
export async function runPenjualanCycle(): Promise<void> {
  if (!(await getSettingBool('farmasi.penjualan_enabled', false))) return;

  const [lookback, kuota, sejak, sertakanHarga, kabarHapus] = await Promise.all([
    getSettingNumber('farmasi.penjualan_lookback_hari', 7),
    getSettingNumber('farmasi.penjualan_max_per_siklus', 10),
    getSetting('farmasi.penjualan_sejak'),
    getSettingBool('farmasi.penjualan_harga', true),
    getSettingBool('farmasi.penjualan_hapus_kabar', true),
  ]);

  /**
   * Tujuan diperiksa DI DEPAN, sebelum `sik` disentuh sama sekali. Sakelar yang
   * menyala tanpa satu pun tujuan tercentang bergejala persis seperti yang benar
   * (halaman tampak wajar, nol pesan keluar), jadi ia dicatat `warn`.
   */
  const tujuan = await muatTujuanPenjualan();
  if (tujuan.length === 0) {
    logger.warn({}, 'penjualan menyala tapi belum ada tujuan yang mencentang "terima penjualan"');
    return;
  }

  const jendela = hitungJendelaPindai(new Date(), lookback, sejak?.trim() || null);
  const batas = jendelaNota(jendela.dari, jendela.sampai);

  let hadir: string[];
  try {
    hadir = await notaPenjualanYangAda(jendela.dari, jendela.sampai);
  } catch (err) {
    // Tidak ada watermark yang bisa tertinggal salah -- jendelanya dihitung ulang
    // dari tanggal hari ini tiap siklus, jadi kegagalan sesaat pulih sendiri.
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca jendela penjualan');
    return;
  }

  if (hadir.length >= JENDELA_PENJUALAN_PENUH) {
    /**
     * Berhenti TOTAL, tidak sekadar memperingatkan -- dan ini berbeda dari
     * pengadaan, yang cuma mencatat `warn` lalu jalan terus.
     *
     * Sebabnya deteksi penghapusan. Jendela yang terpotong `LIMIT` mengembalikan
     * SEBAGIAN nota yang ada, dan sisanya lalu terlihat persis seperti nota yang
     * dihapus -- grup menerima pembatalan borongan atas penjualan yang masih
     * hidup. Pada pengadaan, jendela terpotong paling buruk cuma menunda satu
     * nota; di sini ia mengirim pesan yang SALAH.
     */
    logger.error(
      { ...jendela, terbaca: hadir.length, batas: JENDELA_PENJUALAN_PENUH },
      'jendela penjualan terbaca PENUH -- siklus DIHENTIKAN supaya nota yang terpotong tidak dilaporkan terhapus; persempit farmasi.penjualan_lookback_hari',
    );
    return;
  }

  const pantau = await PenjualanPantau.findAll({
    where: { notaJual: { [Op.between]: [batas.awal, batas.akhir] } },
  });

  const hasil = bandingkanPantau({
    hadir,
    pantau: pantau.map((p) => ({ notaJual: p.notaJual, generasi: p.generasi, hapusAt: p.hapusAt })),
    jendela: batas,
  });

  // Kabar penghapusan bisa dimatikan sendiri; saat mati, buku pantaunya TETAP
  // ditandai supaya menyalakannya kembali tidak membongkar seluruh riwayat
  // penghapusan yang terjadi selama ia mati.
  const rencana = bagiKuota(
    { baru: hasil.baru, terhapus: kabarHapus ? hasil.terhapus : [] },
    kuota,
  );
  const diamHapus = kabarHapus ? [] : hasil.terhapus;

  if (rencana.baru.length === 0 && rencana.terhapus.length === 0 && diamHapus.length === 0) return;

  const sekarang = new Date();
  let kirimBaru = 0;
  let kirimHapus = 0;

  // ------------------------------------------------------------------
  // PEMBATALAN lebih dulu -- lihat `bagiKuota()` untuk alasannya.
  // ------------------------------------------------------------------
  if (rencana.terhapus.length > 0) {
    const bodyHapus = (await getSetting('farmasi.template_penjualan_hapus', '')) ?? '';
    const ctxHapus = await loadFarmasiContext(TRIGGER_PENJUALAN_HAPUS, bodyHapus, bodyHapus);
    const generasiPer = new Map(pantau.map((p) => [p.notaJual, p.generasi]));

    for (const nota of rencana.terhapus) {
      const generasi = generasiPer.get(nota) ?? 0;
      for (const t of tujuan) {
        await enqueueMessage(
          {
            idempotencyKey: kunciPenjualanHapus(nota, t.chatId, generasi),
            noRkmMedis: null,
            rawPhone: null,
            chatId: t.chatId,
            eventAt: sekarang,
            vars: susunVarsPenjualanHapus(nota, sekarang),
          },
          ctxHapus,
        );
      }
      kirimHapus++;
    }

    /**
     * Ditandai SESUDAH pesannya masuk `outbox`, bukan sebelum.
     *
     * Terbalik, satu kegagalan enqueue membuat notanya tercatat "sudah
     * dikabarkan" padahal tidak ada pesan yang pernah dibuat -- dan karena
     * `bandingkanPantau()` melewati baris ber-`hapusAt`, pembatalan itu tidak
     * akan pernah dicoba lagi. Urutan ini yang membuat kegagalan berarti
     * "diulang siklus berikutnya" alih-alih "hilang selamanya"; `uq_idem`
     * menahan pengulangannya jadi pesan ganda.
     */
    await PenjualanPantau.update(
      { hapusAt: sekarang },
      { where: { notaJual: { [Op.in]: rencana.terhapus } } },
    );
  }

  // Penghapusan yang TIDAK dikabarkan (sakelarnya mati) tetap ditandai, supaya
  // menyalakan sakelarnya besok tidak mengirim rentetan pembatalan lama.
  if (diamHapus.length > 0) {
    await PenjualanPantau.update(
      { hapusAt: sekarang },
      { where: { notaJual: { [Op.in]: diamHapus } } },
    );
  }

  // ------------------------------------------------------------------
  // Nota baru
  // ------------------------------------------------------------------
  let ditundaKuota = hasil.baru.length - rencana.baru.length;
  if (rencana.baru.length > 0) {
    const nomor = rencana.baru.map((b) => b.notaJual);

    let header: BarisPenjualan[];
    let detail: BarisDetailPenjualan[];
    let ringkas: Awaited<ReturnType<typeof ambilRingkasPenjualan>>;
    let terpilih: Awaited<ReturnType<typeof ambilPenjualanTerpilih>>;
    try {
      /**
       * Header dibaca untuk SELURUH jendela, bukan cuma untuk nota yang dikirim.
       *
       * Itu memang lebih dari yang dibutuhkan, dan disengaja: bentuk query yang
       * berbeda adalah bentuk yang belum diperiksa `verify:plans`, sementara yang
       * ini sudah (`FARMASI_PENJUALAN`, `range PRIMARY`). Biayanya terukur 1 ms
       * atas 142 baris, dan ia cuma jalan pada siklus yang memang punya nota
       * baru -- siklus yang tidak punya berhenti jauh di atas sini.
       *
       * Yang justru penting: pembacaan per siklus yang berjalan SELALU (deteksi
       * pembatalan) memakai `notaPenjualanYangAda`, yang cuma mengambil satu
       * kolom dan terukur `Using index`.
       */
      [header, ringkas, terpilih, detail] = await Promise.all([
        pollPenjualanJendela(jendela.dari, jendela.sampai),
        ambilRingkasPenjualan(nomor),
        ambilPenjualanTerpilih(nomor),
        ambilDetailPenjualan(nomor, sertakanHarga),
      ]);
    } catch (err) {
      logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca rincian penjualan');
      return;
    }

    const headerPer = new Map(header.map((h) => [h.nota_jual, h]));
    const ringkasPer = new Map(ringkas.map((r) => [r.nota_jual, r]));
    const terpilihPer = new Map(terpilih.map((t) => [t.nota_jual, t]));
    const detailPer = kelompokkanDetailJual(detail);

    const body = (await getSetting('farmasi.template_penjualan', '')) ?? '';
    /**
     * `genericBody` sengaja SAMA dengan `body`. `checkPrivacy()` tetap dijalankan
     * `enqueueMessage` untuk tiap baris, dan jalur generiknya tidak akan pernah
     * menyala di sini karena tidak ada `kdPoli` maupun `kdJenisPrw` yang
     * diserahkan -- sebuah penjualan tidak punya poli.
     */
    const ctx = await loadFarmasiContext(TRIGGER_PENJUALAN, body, body);

    const tercatat: NotaBaru[] = [];
    for (const b of rencana.baru) {
      const h = headerPer.get(b.notaJual);
      if (!h) {
        /**
         * Nota yang lenyap ANTARA pembacaan nomor dan pembacaan headernya.
         *
         * Dilewati diam-diam TANPA dicatat ke buku pantau, dan itu benar: ia
         * memang tidak pernah dikabarkan, jadi ia juga tidak boleh dilaporkan
         * terhapus nanti. Siklus berikutnya melihatnya sebagai nota yang tidak
         * pernah ada -- yang persis keadaannya.
         */
        continue;
      }
      const r = ringkasPer.get(b.notaJual);
      const t = terpilihPer.get(b.notaJual);
      const bagian = susunVarsPenjualan(
        h,
        detailPer.get(b.notaJual) ?? [],
        {
          jmlItem: r?.jml_item ?? null,
          subtotal: r?.subtotal ?? null,
          ppn: t?.ppn ?? null,
          ongkir: t?.ongkir ?? null,
          keterangan: t?.keterangan ?? null,
        },
        sekarang,
      );

      /**
       * BAGIAN di luar, TUJUAN di dalam -- urutannya menentukan urutan baca.
       * Baris `outbox` diambil dispatcher menurut urutan pembuatannya, jadi
       * perulangan yang terbalik mengirim seluruh bagian ke grup pertama sebelum
       * grup kedua menerima apa pun. Pelajaran `stokDaruratRunner.ts`.
       */
      for (const [i, vars] of bagian.entries()) {
        for (const t of tujuan) {
          await enqueueMessage(
            {
              idempotencyKey: turunkanKunciBagian(kunciPenjualan(b.notaJual, t.chatId, b.generasi), i),
              noRkmMedis: null,
              rawPhone: null,
              chatId: t.chatId,
              /**
               * Waktu DETEKSI, bukan `tgl_jual`. Tanggal nota bisa dipilih staf
               * dan berumur berhari-hari; memakainya membuat nota yang baru
               * dimasukkan dinilai basi lalu ditandai `expired` (F5.3) tanpa
               * pernah terkirim.
               */
              eventAt: sekarang,
              vars,
            },
            ctx,
          );
        }
      }
      tercatat.push(b);
      kirimBaru++;
    }

    /**
     * Dicatat ke buku pantau SESUDAH pesannya masuk `outbox`.
     *
     * Urutannya mengikat ke dua arah, dan keduanya gagal diam:
     *  - dicatat lebih dulu lalu enqueue gagal -> nota dianggap sudah dikabarkan
     *    padahal tidak pernah, dan penghapusannya nanti dilaporkan sebagai
     *    pembatalan atas pesan yang tidak pernah dikirim;
     *  - tidak dicatat sama sekali -> jendela mengirimnya ulang tiap siklus
     *    (ditahan `uq_idem`, jadi diam) dan penghapusannya tidak pernah
     *    terdeteksi.
     */
    if (tercatat.length > 0) {
      await PenjualanPantau.bulkCreate(
        tercatat.map((b) => ({
          notaJual: b.notaJual,
          generasi: b.generasi,
          dikabarkanAt: sekarang,
          hapusAt: null,
        })),
        // Nota yang nomornya dipakai ULANG sudah punya barisnya; yang perlu
        // diperbarui generasinya dan hapusAt-nya dikosongkan lagi.
        { updateOnDuplicate: ['generasi', 'dikabarkanAt', 'hapusAt'] },
      );
    }
    ditundaKuota += rencana.baru.length - tercatat.length;
  }

  if (kirimBaru > 0 || kirimHapus > 0) {
    await logAudit(
      AKTOR,
      'penjualan_kirim',
      [...rencana.terhapus, ...rencana.baru.map((b) => b.notaJual)].join(','),
      `${kirimBaru} nota baru, ${kirimHapus} pembatalan, ${tujuan.length} tujuan, harga=${sertakanHarga ? 'ikut' : 'tidak'}`,
    );
  }

  logger.info(
    {
      ...jendela,
      terbaca: hadir.length,
      dipantau: pantau.length,
      baru: hasil.baru.length,
      terhapus: hasil.terhapus.length,
      kirimBaru,
      kirimHapus,
      tujuan: tujuan.length,
      ...(ditundaKuota > 0 ? { ditundaKuota } : {}),
      ...(diamHapus.length > 0 ? { hapusTidakDikabarkan: diamHapus.length } : {}),
    },
    'siklus penjualan selesai',
  );
}
