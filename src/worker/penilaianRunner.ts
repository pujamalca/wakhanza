import { getSetting, getSettingBool, getSettingNumber, setSetting, logAudit, ErmTarget } from '@/models';
import { rekapPenilaianAwal, normalkanKolomInti, type KolomInti } from '@/khanza/penilaianAwal';
import {
  varsBagianRekap,
  rekapKosong,
  JAM_PENILAIAN_BAWAAN,
  type RincianRekap,
} from '@/core/penilaianRekap';
import { bacaSlotRekap, slotJatuhTempo, tulisPenandaSlot, tulisJamRekap, hariRekap } from '@/core/rekapJadwal';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { formatTanggalPesan, formatJamPesan } from '@/core/tanggalPesan';
import { loadFarmasiContext, enqueueMessage } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * REKAP ASESMEN AWAL KEPERAWATAN -- pemicu pertama yang memberitakan sesuatu
 * yang TIDAK terjadi.
 *
 * ==========================================================================
 * Kelasnya WAKTU, dan di sini itu bukan pilihan melainkan paksaan
 * ==========================================================================
 *
 * Setiap pemicu lain berangkat dari BARIS yang muncul di `sik`. Yang ini
 * berangkat dari baris yang TIDAK PERNAH dibuat: pasien terdaftar `status_poli =
 * 'Baru'`, dan asesmennya tidak ada. Tidak ada apa pun yang bisa dipicu, tidak
 * ada watermark yang bisa maju, dan kelas sisip mustahil -- satu-satunya cara
 * mengetahuinya adalah membaca ulang seluruh hari itu lalu membandingkan dua
 * tabel.
 *
 * ==========================================================================
 * BANYAK JAM sehari -- satu-satunya di sistem ini
 * ==========================================================================
 *
 * Ketiga rekap yang sudah ada berbunyi sekali sehari lewat `jatuhTempoHarian()`,
 * yang penandanya bertanggal. Bentuk itu rusak di sini: rekap 13:00 menulis
 * "hari ini", lalu 19:30 membacanya sebagai "sudah" dan tidak pernah berangkat.
 *
 * Karena itu `slotJatuhTempo()` (`core/rekapJadwal.ts`) dan penanda bertanggal
 * BERIKUT SLOTNYA. `jatuhTempoHarian()` sengaja TIDAK disentuh -- ia dipakai tiga
 * fitur yang sedang berjalan di produksi, dan melebarkannya berarti mengubah
 * perilaku ketiganya sebagai efek samping fitur yang tidak meminta itu.
 *
 * Dua jam bawaannya punya peran berbeda, dan itu DIUKUR (lihat migrations/044):
 * 13:00 pengingat di tengah hari, 19:30 hitungan akhir setelah pengisian
 * praktis berhenti.
 */

export const TRIGGER_PENILAIAN = 'ERM_PENILAIAN_UMUM';
const KUNCI_PENANDA = 'erm.penilaian_last_run';
const AKTOR = 'system:erm_penilaian';

/** Tujuan yang mencentang rekap penilaian umum DAN masih aktif. */
export async function muatTargetPenilaian(): Promise<{ id: number; chatId: string; label: string }[]> {
  const rows = await ErmTarget.findAll({
    where: { isActive: true, terimaPenilaianUmum: true },
    order: [['id', 'ASC']],
  });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId, label: r.label }));
}

/** Baca `erm.penilaian_poli` -- kosong berarti seluruh poli. */
function bacaDaftar(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface HasilRekapPenilaian {
  tanggalRekap: string;
  /** Isi pesan hasil `renderTemplate`. null = sengaja diam. */
  body: string | null;
  /** Satu set vars per BAGIAN pesan. Kosong bila `body` null. */
  bagian: Record<string, string>[];
  jumlah: { total: number; belum: number; sebagian: number; lengkap: number };
}

/**
 * Menyusun isi rekap untuk satu tanggal.
 *
 * Dipisah dan diekspor supaya `dryrun:penilaian` dan pratinjau dashboard memakai
 * fungsi yang SAMA dipakai worker -- pratinjau yang berbeda dari kenyataan lebih
 * buruk daripada tanpa pratinjau.
 */
export async function susunRekapPenilaian(
  tanggalRekap: string,
  sekarang: Date,
): Promise<HasilRekapPenilaian> {
  const [kolomRaw, poliRaw, rincianRaw, maxBaris, bodyAda, bodyKosong] = await Promise.all([
    getSetting('erm.penilaian_kolom_inti', 'td,nadi,suhu,rr'),
    getSetting('erm.penilaian_poli', ''),
    getSetting('erm.penilaian_rincian', 'penuh'),
    getSettingNumber('erm.penilaian_max_baris', 40),
    getSetting('erm.template_penilaian', ''),
    getSetting('erm.template_penilaian_kosong', ''),
  ]);

  // `normalkanKolomInti` menyaring terhadap daftar-izin `KOLOM_INTI`. Itu bukan
  // kerapian: nilainya masuk ke NAMA KOLOM di SQL, dan nama kolom tidak bisa
  // jadi parameter terikat.
  const kolomInti: KolomInti[] = normalkanKolomInti(bacaDaftar(kolomRaw));
  const kdPoli = bacaDaftar(poliRaw);
  const rincian: RincianRekap = rincianRaw === 'ringkas' ? 'ringkas' : 'penuh';

  const ringkas = await rekapPenilaianAwal(tanggalRekap, {
    kolomInti,
    ...(kdPoli.length > 0 ? { kdPoli } : {}),
  });

  const kosong = rekapKosong(ringkas);
  const body: string | null = kosong ? ((bodyKosong ?? '').trim() ? (bodyKosong ?? '') : null) : (bodyAda ?? '');

  const waktu = { tanggal: formatTanggalPesan(sekarang), jam: formatJamPesan(sekarang) };
  const bagian =
    body === null
      ? []
      : varsBagianRekap(ringkas, rincian, maxBaris).map((v) => ({ ...v, ...waktu }));

  return {
    tanggalRekap,
    body,
    bagian,
    jumlah: {
      total: ringkas.total,
      belum: ringkas.belum,
      sebagian: ringkas.sebagian,
      lengkap: ringkas.lengkap,
    },
  };
}

/**
 * Dipanggil worker tiap siklus PINDAI.
 *
 * Sakelar dan DAFTAR JAM dibaca ULANG tiap kali, bukan sekali saat worker mulai
 * -- staf yang menambah jam ketiga di dashboard harus berlaku hari itu juga.
 * Perbaikan yang disengaja atas pola `startScheduler()` milik BOOK_REMIND.
 */
export async function runPenilaianRekapIfDue(): Promise<void> {
  // Sakelar BERTINGKAT: `erm.enabled` menahan seluruh menu ERM, lalu tiap
  // submenu punya sakelarnya sendiri. Bentuk yang sama dengan `bpjs.enabled`,
  // dan alasannya sama: submenu berikutnya (gigi, mata) harus bisa dinyalakan
  // sendiri-sendiri tanpa memaksa RS menyalakan semuanya sekaligus.
  if (!(await getSettingBool('erm.enabled', false))) return;
  if (!(await getSettingBool('erm.penilaian_enabled', false))) return;

  const [jamRaw, offset, penanda] = await Promise.all([
    getSetting('erm.penilaian_jam', JAM_PENILAIAN_BAWAAN),
    getSettingNumber('erm.penilaian_offset_hari', 0),
    getSetting(KUNCI_PENANDA, ''),
  ]);

  /**
   * Daftar jam yang tidak terbaca jatuh ke bawaan, TIDAK mendiamkan rekapnya.
   *
   * Server action menolak jam salah bentuk di depan orang yang bisa
   * memperbaikinya seketika; di sini, pukul tujuh malam tanpa siapa-siapa untuk
   * diberi tahu, menolak diam berarti rekapnya berhenti selamanya tanpa satu pun
   * tanda. Pola `bacaJamRekap()` yang sudah dipakai ketiga rekap lain.
   */
  let slots = bacaSlotRekap(jamRaw);
  if (slots.length === 0) {
    logger.warn(
      { jam: jamRaw, dipakai: JAM_PENILAIAN_BAWAAN },
      'erm.penilaian_jam tidak memuat satu pun jam yang sah, memakai bawaan',
    );
    slots = bacaSlotRekap(JAM_PENILAIAN_BAWAAN);
  }

  const sekarang = new Date();
  const slot = slotJatuhTempo(sekarang, slots, penanda);
  if (!slot) return;

  /**
   * Tujuan diperiksa SEBELUM `sik` disentuh, dan penandanya sengaja TIDAK
   * dimajukan di cabang ini.
   *
   * Berbeda dari cabang "hari ini tidak ada yang perlu diisi" di bawah: ini
   * keadaan salah setel yang bisa diperbaiki dalam hitungan detik lewat satu
   * centang, dan memajukan penandanya berarti rekap slot itu hilang begitu saja.
   */
  const tujuan = await muatTargetPenilaian();
  if (tujuan.length === 0) {
    logger.warn({ slot: tulisJamRekap(slot) }, 'rekap penilaian jatuh tempo tapi belum ada tujuan aktif');
    return;
  }

  const tanggalRekap = hariRekap(sekarang, offset);

  let hasil: HasilRekapPenilaian;
  try {
    hasil = await susunRekapPenilaian(tanggalRekap, sekarang);
  } catch (err) {
    /**
     * Penanda TIDAK dimajukan. Pelajaran `bpjs.kontrol_last_run`: menulisnya
     * lebih dulu terasa lebih aman, tapi satu kegagalan sesaat lalu menghapus
     * rekap slot itu tanpa percobaan kedua. Siklus berikutnya mencobanya lagi;
     * `uq_idem` yang menahan kiriman ganda, bukan penanda ini.
     */
    logger.error({ tanggalRekap, ...safeError(err) }, 'gagal menyusun rekap penilaian awal');
    return;
  }

  if (hasil.body === null) {
    logger.info(
      { tanggalRekap, slot: tulisJamRekap(slot), ...hasil.jumlah },
      'rekap penilaian: seluruh asesmen sudah lengkap dan pesan kosong tidak diisi, lewati',
    );
  } else {
    const ctx = await loadFarmasiContext(TRIGGER_PENILAIAN, hasil.body, hasil.body);

    /**
     * BAGIAN di luar, TUJUAN di dalam -- terbalik, seluruh bagian ke grup
     * pertama terkirim sebelum grup kedua menerima apa pun (pelajaran
     * migrations/022).
     */
    for (const [i, varsBagian] of hasil.bagian.entries()) {
      /**
       * Kunci memuat TANGGAL REKAP + SLOT + chat_id, dan ketiganya perlu.
       *
       * Tanggal rekap (bukan `sekarang`): `sekarang` berbeda tiap siklus, jadi
       * kegagalan menulis penanda akan membuat rekapnya terkirim ulang tiap lima
       * menit dengan kunci yang selalu dianggap baru.
       *
       * SLOT: inilah yang membedakan fitur ini dari ketiga rekap lain. Tanpa
       * slot di dalam kunci, rekap 19:30 punya kunci yang SAMA PERSIS dengan
       * rekap 13:00 hari itu dan ditolak `uq_idem` sebagai duplikat -- diam-diam,
       * karena INSERT-nya memang `ignoreDuplicates`.
       *
       * chat_id: tanpa itu tujuan KEDUA dan seterusnya ditolak sebagai duplikat
       * dan hanya satu grup yang pernah menerima apa pun.
       */
      for (const t of tujuan) {
        await enqueueMessage(
          {
            // `turunkanKunciBagian` MENGHASH ULANG, bukan menyambung: kolomnya
            // VARCHAR(64) sementara SHA1 hex sudah 40 karakter, dan sambungan
            // yang melewatinya dipotong DIAM oleh MariaDB non-strict tepat di
            // bagian yang membedakan satu bagian dari bagian lain (migrations/018).
            // Bagian PERTAMA memakai kunci dasarnya apa adanya.
            idempotencyKey: turunkanKunciBagian(
              buildIdempotencyKey(TRIGGER_PENILAIAN, tanggalRekap, tulisJamRekap(slot), t.chatId),
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
        tanggalRekap,
        slot: tulisJamRekap(slot),
        ...hasil.jumlah,
        bagian: hasil.bagian.length,
        tujuan: tujuan.length,
      },
      'rekap penilaian awal terkirim',
    );
    await logAudit(
      AKTOR,
      'erm_penilaian_kirim',
      `${tanggalRekap} ${tulisJamRekap(slot)}`,
      `${hasil.jumlah.total} pasien baru, ${hasil.jumlah.belum} belum diisi, ` +
        `${hasil.jumlah.sebagian} terisi sebagian, ${tujuan.length} tujuan`,
    );
  }

  /**
   * Penanda dimajukan SESUDAH berhasil -- termasuk saat "berhasil" berarti
   * sengaja diam.
   *
   * Bandingkan cabang "belum ada tujuan" di atas, yang sengaja TIDAK
   * memajukannya karena ia keadaan salah setel, bukan keputusan.
   */
  await setSetting(KUNCI_PENANDA, tulisPenandaSlot(hariRekap(sekarang, 0), slot));
}
