import { Op } from 'sequelize';
import { FarmasiTarget, StokAlertSchedule, getSetting, getSettingBool, logAudit } from '@/models';
import { cariDaruratStok } from '@/khanza/stokDarurat';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { computeNextRunAt } from '@/core/schedule';
import {
  pecahDaftarDarurat,
  ringkasDarurat,
  BATAS_KARAKTER_BAGIAN,
  BATAS_KERAS_BARIS,
  SEMUA_BARIS,
  type RingkasanDarurat,
} from '@/core/stokDarurat';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import type { TemplateVariable } from '@/core/template';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * DARURAT STOK -- peringatan persediaan, dipicu WAKTU.
 *
 * Kelas pemicu keenam, dan pemicunya adalah satu-satunya yang tidak berasal
 * dari kejadian mana pun:
 *
 *   sisip/pindai        kejadian di `sik`
 *   broadcast           staf menekan kirim
 *   broadcast terjadwal jadwal + segmen pasien
 *   balasan otomatis    pesan masuk pasien
 *   notifikasi farmasi  resep divalidasi/diserahkan
 *   DARURAT STOK        jadwal jatuh tempo, dan keadaan gudang saat itu
 *
 * Yang membuatnya perlu pagar sendiri: tidak ada kejadian yang membatasi
 * volumenya. Sebuah pemicu resep berhenti sendiri saat resepnya habis; daftar
 * barang di bawah ambang minimal tidak pernah "habis" -- ia justru cenderung
 * tetap panjang sampai apoteknya memesan ulang. Karena itu batas baris per
 * pesan (`max_baris`) bukan kerapian melainkan syarat agar peringatannya tetap
 * dibaca, dan sekali kirim per jadwal per jatuh tempo ditegakkan lewat kunci
 * idempoten di mesin database.
 */

const AKTOR = 'system:stok_darurat';
export const TRIGGER_DARURAT = 'FARMASI_STOK_DARURAT';

export interface TujuanDarurat {
  id: number;
  chatId: string;
  label: string;
}

/**
 * Tujuan yang menerima peringatan persediaan.
 *
 * Menyaring `terimaDaruratStok`, BUKAN `isActive`. Keduanya sengaja terpisah
 * (migrations/021): sebuah grup sangat wajar perlu tahu tiap resep masuk tanpa
 * perlu rekap persediaan tiap pagi, dan nomor kepala instalasi sangat wajar
 * justru kebalikannya.
 */
export async function muatTujuanDarurat(): Promise<TujuanDarurat[]> {
  const rows = await FarmasiTarget.findAll({
    where: { terimaDaruratStok: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

export interface HasilDarurat {
  ringkasan: RingkasanDarurat;
  /** Teks yang benar-benar dirender, atau null bila jadwalnya memilih diam. */
  body: string | null;
  /**
   * Satu set variabel per PESAN. Daftar yang tidak muat dalam satu pesan
   * WhatsApp dipecah, dan tiap bagian dikirim sebagai barisnya sendiri --
   * seluruhnya, bukan sebagian lalu sisanya dibuang.
   *
   * Selalu berisi tepat satu elemen dalam keadaan biasa; daftar 208 barang di
   * mesin ini ~9.300 karakter, jauh di bawah `BATAS_KARAKTER_BAGIAN`.
   */
  bagian: Array<Partial<Record<TemplateVariable, string>>>;
  /** Ringkas untuk pemanggil yang cuma perlu bagian pertama (pratinjau). */
  vars: Partial<Record<TemplateVariable, string>>;
}

interface OpsiSusun {
  kdJenis?: string | null;
  namaJenis?: string;
  /** 0 = seluruh barang yang di bawah ambang. Lihat `SEMUA_BARIS`. */
  maxBaris: number;
  pakaiBatch: boolean;
  bodyAda: string;
  bodyKosong: string;
  saatIni: Date;
}


/**
 * Membaca gudang lalu menyusun isi pesannya.
 *
 * Dipisahkan dari pengirimannya dan diekspor, supaya PRATINJAU di halaman
 * `/farmasi` memakai fungsi yang SAMA dipakai worker. Pratinjau yang berbeda
 * dari kenyataan lebih buruk daripada tanpa pratinjau -- pelajaran yang sudah
 * dibayar di kotak uji coba balasan otomatis dan balasan stok.
 *
 * `limit` diminta `maxBaris + 1` supaya "terpotong" bisa dibedakan dari
 * "kebetulan pas" -- kecuali saat `maxBaris` 0 (semua), yang memang tidak
 * pernah memotong sehingga yang dipakai adalah batas kerasnya. Dengan begitu
 * `jumlah_total` pada mode semua adalah hitungan sungguhan, bukan "setidaknya
 * sebanyak ini".
 */
export async function susunPesanDarurat(opsi: OpsiSusun): Promise<HasilDarurat> {
  const semua = !Number.isFinite(opsi.maxBaris) || opsi.maxBaris <= 0;
  const rows = await cariDaruratStok({
    pakaiBatch: opsi.pakaiBatch,
    kdJenis: opsi.kdJenis,
    limit: semua ? BATAS_KERAS_BARIS : Math.floor(opsi.maxBaris) + 1,
  });

  const ringkasan = ringkasDarurat(rows, semua ? SEMUA_BARIS : opsi.maxBaris);
  const kosong = ringkasan.total === 0;

  const dasar: Partial<Record<TemplateVariable, string>> = {
    jumlah_habis: String(ringkasan.habis),
    jumlah_menipis: String(ringkasan.menipis),
    jumlah_total: String(ringkasan.total),
    nama_jenis: opsi.namaJenis ?? '',
    tanggal: formatTanggalPesan(opsi.saatIni),
    jam: formatJamPesan(opsi.saatIni),
  };

  /**
   * Daftar dipecah SEBELUM template dirender, bukan sesudah.
   *
   * Memecah teks yang sudah jadi berarti memotong di tengah kalimat pembuka
   * yang ditulis staf, dan bagian kedua akan dibuka oleh potongan sembarang
   * tanpa judul apa pun. Dengan memecah daftarnya lebih dulu, tiap bagian
   * adalah pesan utuh: pembuka staf, potongan daftarnya, dan penutupnya.
   */
  const potongan = pecahDaftarDarurat(ringkasan, BATAS_KARAKTER_BAGIAN);
  // Daftar kosong tetap menghasilkan SATU set variabel: cabang "gudang aman"
  // memakai templatenya sendiri, yang tetap boleh menyebut {jumlah_total},
  // {tanggal}, dan {nama_rs}.
  const bagian: Array<Partial<Record<TemplateVariable, string>>> =
    potongan.length > 0
      ? potongan.map((teks) => ({ ...dasar, daftar_stok: teks }))
      : [{ ...dasar, daftar_stok: '' }];

  // Template kosong = DIAM, bukan mengirim pesan hampa. Alasan yang sama
  // dengan `autoreply.fallback_body`: peringatan harian yang isinya "tidak ada
  // apa-apa" berhenti dibaca dalam seminggu, dan sejak itu yang sungguhan ikut
  // tidak terbaca.
  const body = kosong ? (opsi.bodyKosong.trim() ? opsi.bodyKosong : null) : opsi.bodyAda;

  return { ringkasan, body, bagian, vars: bagian[0] ?? dasar };
}

/**
 * Satu jadwal, satu kali jalan.
 *
 * Diekspor supaya bisa dijalankan langsung saat verifikasi -- yang diuji harus
 * fungsi yang SAMA dipakai worker, bukan tiruannya.
 */
export async function jalankanSatuJadwal(
  jadwal: StokAlertSchedule,
  tujuan: TujuanDarurat[],
  sekarang: Date,
): Promise<number> {
  const [bodyAda, bodyKosong, pakaiBatch] = await Promise.all([
    getSetting('farmasi.template_darurat', ''),
    getSetting('farmasi.template_darurat_kosong', ''),
    getSettingBool('farmasi.stok_pakai_batch', false),
  ]);

  const hasil = await susunPesanDarurat({
    kdJenis: jadwal.kdJenis,
    maxBaris: jadwal.maxBaris,
    pakaiBatch,
    bodyAda: bodyAda ?? '',
    bodyKosong: bodyKosong ?? '',
    saatIni: sekarang,
  });

  if (hasil.body === null) {
    logger.info(
      { jadwalId: jadwal.id, nama: jadwal.nama },
      'darurat stok: tidak ada barang di bawah ambang dan pesan kosong tidak diisi, lewati',
    );
  } else {
    const ctx = await loadFarmasiContext(TRIGGER_DARURAT, hasil.body, hasil.body);
    /**
     * BAGIAN di luar, TUJUAN di dalam -- urutannya menentukan urutan baca.
     *
     * Baris `outbox` diambil dispatcher menurut urutan pembuatannya, jadi
     * perulangan yang terbalik akan mengirim seluruh bagian 1 dan 2 ke grup
     * pertama sebelum grup kedua menerima apa pun. Yang sekarang: setiap tujuan
     * menerima bagian 1 lebih dulu, lalu bagian 2 -- daftar yang tiba terbalik
     * lebih membingungkan daripada daftar yang tiba pelan.
     */
    for (const [i, varsBagian] of hasil.bagian.entries()) {
      for (const t of tujuan) {
        await enqueueMessage(
          {
            /**
             * Kuncinya memuat waktu JATUH TEMPO (`nextRunAt`), bukan `sekarang`.
             *
             * Bedanya menentukan apakah idempotensinya berarti apa-apa: `sekarang`
             * berbeda tiap siklus 60 detik, jadi jadwal yang gagal memajukan
             * `next_run_at` akan mengirim ulang tiap menit dan tiap kunci
             * dianggap baru. Waktu jatuh tempo tetap sama sampai benar-benar
             * dimajukan, sehingga UNIQUE KEY uq_idem menahan kiriman kedua di
             * mesin database.
             *
             * `chatId` ikut masuk dengan alasan yang sudah dibayar di notifikasi
             * farmasi: tanpa itu tujuan KEDUA dan seterusnya ditolak sebagai
             * duplikat, dan hanya satu grup yang pernah menerima apa pun -- tanpa
             * satu pun galat, karena INSERT-nya memang `ignoreDuplicates`.
             *
             * Indeks bagian ditambahkan lewat `turunkanKunciBagian`, yang
             * mengembalikan kunci dasarnya apa adanya untuk bagian pertama --
             * jadi pesan yang tidak terpecah berkunci persis seperti sebelum
             * pemecahan ada.
             */
            idempotencyKey: turunkanKunciBagian(
              buildIdempotencyKey(
                TRIGGER_DARURAT,
                String(jadwal.id),
                (jadwal.nextRunAt ?? sekarang).toISOString(),
                t.chatId,
              ),
              i,
            ),
            noRkmMedis: null,
            rawPhone: null,
            chatId: t.chatId,
            eventAt: sekarang,
            vars: varsBagian,
          },
          ctx,
        );
      }
    }
    logger.info(
      {
        jadwalId: jadwal.id,
        nama: jadwal.nama,
        total: hasil.ringkasan.total,
        tujuan: tujuan.length,
        bagian: hasil.bagian.length,
      },
      'darurat stok terkirim',
    );
    await logAudit(
      AKTOR,
      'stok_darurat_run',
      String(jadwal.id),
      `${hasil.ringkasan.total} barang (${hasil.ringkasan.habis} habis), ${tujuan.length} tujuan`,
    );
  }

  const berikutnya = computeNextRunAt(
    {
      repeatKind: jadwal.repeatKind,
      timeOfDay: jadwal.timeOfDay,
      dayOfWeek: jadwal.dayOfWeek,
      dayOfMonth: jadwal.dayOfMonth,
      intervalDays: jadwal.intervalDays,
    },
    sekarang,
  );

  /**
   * `next_run_at` dimajukan bahkan saat pesannya tidak jadi dikirim.
   *
   * Kalau tidak, jadwal yang gudangnya sedang aman (atau yang pesan kosongnya
   * sengaja dibiarkan diam) tetap jatuh tempo pada siklus 60 detik berikutnya,
   * membaca seluruh katalog lagi, dan begitu seterusnya sepanjang hari --
   * pemindaian penuh `databarang` tiap menit terhadap database yang sedang
   * dipakai melayani pasien. Itu justru beban yang izin `allowFullScan`-nya
   * dibenarkan dengan alasan "jalan sekali sehari".
   */
  await jadwal.update({
    lastRunAt: sekarang,
    lastJumlah: hasil.ringkasan.total,
    nextRunAt: berikutnya,
    isActive: berikutnya ? jadwal.isActive : false,
  });

  return hasil.ringkasan.total;
}

/**
 * Dipanggil worker tiap siklus.
 *
 * Sakelar utama diperiksa SETIAP kali, bukan sekali saat worker mulai -- staf
 * yang mematikannya dari dashboard harus berlaku dalam satu siklus, bukan
 * menunggu worker dimulai ulang.
 */
export async function runDueStokDarurat(): Promise<void> {
  if (!(await getSettingBool('farmasi.darurat_enabled', false))) return;

  const sekarang = new Date();
  const jatuhTempo = await StokAlertSchedule.findAll({
    where: { isActive: true, nextRunAt: { [Op.lte]: sekarang } },
    order: [['id', 'ASC']],
  });
  if (jatuhTempo.length === 0) return;

  const tujuan = await muatTujuanDarurat();
  if (tujuan.length === 0) {
    /**
     * Jadwal jatuh tempo tapi tidak ada yang menerimanya.
     *
     * `next_run_at` TIDAK dimajukan di sini, dan itu berbeda dari cabang
     * "tidak ada barang" di atas: yang ini keadaan salah setel yang bisa
     * diperbaiki dalam hitungan detik lewat satu centang di dashboard, dan
     * memajukannya berarti peringatan hari itu hilang begitu saja. Biayanya
     * satu query ringan tiap siklus sampai ada yang membetulkannya -- daftar
     * barangnya sendiri belum dibaca, karena pemeriksaan ini di depan.
     *
     * Dicatat `warn`, bukan `debug`: berbeda dari sakelar yang mati (keadaan
     * yang memang dipilih), ini konfigurasi setengah jadi yang tidak seorang
     * pun bermaksud membuatnya.
     */
    logger.warn(
      { jadwal: jatuhTempo.length },
      'darurat stok jatuh tempo tapi belum ada tujuan yang mencentang "terima darurat stok"',
    );
    return;
  }

  for (const jadwal of jatuhTempo) {
    await jalankanSatuJadwal(jadwal, tujuan, sekarang).catch((err) => {
      logger.error(
        { jadwalId: jadwal.id, nama: jadwal.nama, ...safeError(err) },
        'gagal menjalankan jadwal darurat stok',
      );
    });
  }
}
