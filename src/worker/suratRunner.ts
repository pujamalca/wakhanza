import { OptOut, getSettingNumber, getSetting, getSettingJson, logAudit } from '@/models';
import { pollSuratSakitJendela, JENDELA_OTOMATIS_PENUH, type BarisSuratSakit } from '@/khanza/suratPasien';
import {
  jendelaSuratOtomatis,
  putuskanSuratOtomatis,
  type AlasanLewatSurat,
  type KandidatSurat,
} from '@/core/suratOtomatis';
import { buildIdempotencyKey } from '@/core/idempotency';
import { namaBerkasSurat } from '@/core/suratDoc';
import { periksaPanjangKeterangan } from '@/core/media';
import { renderTemplate } from '@/core/template';
import {
  susunSuratSakit,
  suratKeHtml,
  sertakanDiagnosa,
  otomatisAktif,
  bacaPesanPengantar,
  SETTING_AUTO_LOOKBACK,
  SETTING_AUTO_KUOTA,
  SETTING_AUTO_SEJAK,
  AUTO_LOOKBACK_BAWAAN,
  AUTO_KUOTA_BAWAAN,
} from '@/lib/surat';
import { htmlKePdf } from '@/lib/pdf';
import { simpanPdfSurat } from '@/lib/mediaStorage';
import { loadAdministrasiContext, enqueueMessage, saringKunciBaru, previewUniqueCodeFooter } from './pipeline';
import { resolvePhone } from './contactResolver';
import { logger, safeError } from '@/lib/logger';

/**
 * SURAT SAKIT OTOMATIS -- kelas pemicu KETUJUH BELAS di daftar, dan yang
 * pertama mengirim BERKAS tanpa ada manusia yang melihatnya lebih dulu.
 *
 * ==========================================================================
 * Itu perbedaan yang menentukan, dan bukan sekadar "versi otomatis"
 * ==========================================================================
 *
 * `EnqueueInput.media` sampai sekarang punya syarat yang ditulis di tempatnya:
 * "ADA STAF YANG MELIHATNYA sebelum menekan Kirim", dan alasannya masih benar
 * -- berkas yang keliru jauh lebih sulit ditarik kembali daripada kalimat yang
 * keliru. Jalur ini melanggar syarat itu dengan sengaja, jadi ia harus
 * membayarnya dengan pagar yang tidak dipunyai jalur manual:
 *
 *   1. Sakelarnya BERTINGKAT (`administrasi.enabled` + `administrasi.auto_enabled`),
 *      keduanya default MATI.
 *   2. Hanya surat SAKIT. Surat sehat tidak punya kejadian "disimpan" untuk
 *      dipicu sama sekali -- lihat `lib/surat.ts`.
 *   3. LANTAI aktivasi: hanya surat yang bernomor sejak hari sakelarnya
 *      dinyalakan. Menyalakan sakelar tidak pernah membongkar arsip.
 *   4. KUOTA per siklus, karena tiap surat berarti satu peluncuran Chromium di
 *      dalam proses yang juga memegang sesi WhatsApp.
 *   5. Poli sensitif MENOLAK, bukan diganti template generik -- sama seperti
 *      jalur manual, dan di sini tidak ada staf yang bisa membacanya di layar.
 *
 * Yang TIDAK berbeda dari jalur manual, dan memang tidak boleh berbeda: isi
 * suratnya, pesan pengantarnya, catatan kakinya, dan QR pengesahannya. Semuanya
 * lewat `susunSuratSakit()` -> `suratKeHtml()` -> `htmlKePdf()` yang sama
 * persis. Dua penurunan untuk satu surat berarti staf memeriksa bentuk yang
 * berbeda dari yang diterima pasien.
 *
 * ==========================================================================
 * Kelas PINDAI, dan sebabnya ada di bentuk tabelnya
 * ==========================================================================
 *
 * `suratsakit` tidak punya kolom waktu sama sekali, dan tanggal di `no_surat`
 * bukan tanggal barisnya tersimpan. Watermark karena itu MUSTAHIL benar --
 * uraian lengkapnya di `core/suratOtomatis.ts`. Yang dipakai: jendela ±N hari
 * yang dipindai ulang tiap siklus, dedup murni lewat kunci idempoten.
 */

export const TRIGGER_SURAT_SAKIT = 'SURAT_SAKIT';
const AKTOR = 'system:surat_otomatis';

/**
 * Dijalankan di siklus PINDAI (5 menit), bukan siklus rapat (60 detik).
 *
 * Bukan karena suratnya tidak penting, melainkan karena harganya: satu surat =
 * satu peluncuran Chromium (~480 ms) di dalam proses yang juga memegang sesi
 * WhatsApp, dan Chromium yatim di proses inilah yang pernah menjatuhkan worker
 * ke crash loop 29 kali beruntun. Selisih empat menit tidak berarti apa-apa
 * bagi pasien yang baru saja meninggalkan loket; peluang menumpuknya peramban
 * berarti banyak.
 */
export async function runSuratOtomatisCycle(): Promise<void> {
  if (!(await otomatisAktif())) return;

  const [lookback, kuota, sejak, diagnosa] = await Promise.all([
    getSettingNumber(SETTING_AUTO_LOOKBACK, AUTO_LOOKBACK_BAWAAN),
    getSettingNumber(SETTING_AUTO_KUOTA, AUTO_KUOTA_BAWAAN),
    getSetting(SETTING_AUTO_SEJAK),
    sertakanDiagnosa(),
  ]);

  const jendela = jendelaSuratOtomatis(new Date(), lookback, sejak?.trim() || null);

  let baris: BarisSuratSakit[];
  try {
    baris = await pollSuratSakitJendela(jendela.dari, jendela.sampai, diagnosa);
  } catch (err) {
    // Tidak ada watermark yang bisa tertinggal salah di sini -- jendelanya
    // dihitung ulang dari tanggal hari ini tiap siklus, jadi kegagalan sesaat
    // (MariaDB terkunci SIMRS, jaringan berkedip) pulih sendiri lima menit lagi.
    logger.error({ ...jendela, ...safeError(err) }, 'gagal membaca jendela surat sakit otomatis');
    return;
  }

  if (baris.length >= JENDELA_OTOMATIS_PENUH) {
    logger.warn(
      { ...jendela, terbaca: baris.length },
      'jendela surat sakit otomatis terbaca PENUH -- surat tertua mungkin belum terjangkau, persempit lookback-nya',
    );
  }
  if (baris.length === 0) return;

  // Dedup DULU, keputusan belakangan. Terbalik, kuota per siklus habis dimakan
  // surat yang sudah terkirim kemarin dan yang baru tidak pernah kebagian --
  // kegagalan yang tidak meninggalkan satu pun galat.
  const belum = await saringKunciBaru(baris, (row) => kunciSurat(row.no_surat));
  if (belum.length === 0) return;

  const kandidat = await susunKandidat(belum);
  const poliSensitif = await getSettingJson<string[]>('privacy.sensitive_poli_codes', []);
  const { kirim, lewat } = putuskanSuratOtomatis(kandidat, { poliSensitif, kuota });

  const ctxPesan = await bacaPesanPengantar('sakit');
  const ctx = await loadAdministrasiContext(ctxPesan, TRIGGER_SURAT_SAKIT);

  // Baris tanpa lampiran untuk yang nomornya tak terpakai / sudah minta
  // berhenti: statusnya ditentukan `enqueueMessage` sendiri, dan barisnya yang
  // membuat surat itu tersaring dari siklus-siklus berikutnya. Lihat
  // AlasanLewatSurat di core/suratOtomatis.ts.
  for (const l of lewat) {
    if (l.alasan !== 'nomor' && l.alasan !== 'opt_out') continue;
    await catat(l.kandidat, ctx, null);
  }

  let terkirim = 0;
  let terlaluPanjang = 0;
  for (const k of kirim) {
    const isi = susunSuratSakit(k.baris);
    const pesan = renderTemplate(ctxPesan, {
      nama_pasien: isi.namaPasien,
      no_rm: isi.noRm,
      nama_rs: ctx.identity.namaRs,
      alamat_rs: ctx.identity.alamatRs,
      kontak_rs: ctx.identity.kontakRs,
    });

    // Batas 1.024 karakter berlaku KARENA ada lampiran. Diperiksa sebelum
    // merender, dan TIDAK menulis baris outbox: ini kesalahan setelan yang
    // mengenai semua surat sekaligus, dan begitu staf memendekkan pesannya
    // surat-surat ini terkirim sendiri pada siklus berikutnya.
    const footer = await previewUniqueCodeFooter(`administrasi|sakit|${k.baris.no_surat}`);
    if (!periksaPanjangKeterangan(pesan, footer ? footer.length + 1 : 0).ok) {
      terlaluPanjang++;
      continue;
    }

    try {
      const pdf = await htmlKePdf(await suratKeHtml(isi));
      const mediaPath = await simpanPdfSurat(pdf);
      await catat(k, ctx, {
        path: mediaPath,
        mime: 'application/pdf',
        name: namaBerkasSurat('sakit', isi.namaPasien),
      });
      // Nomor tujuan TIDAK ikut dicatat (§9.7) -- `no_rkm_medis` sudah menjawab
      // surat siapa yang dikirim, tanpa menaruh nomor telepon di tabel yang
      // tidak pernah dipangkas.
      await logAudit(
        AKTOR,
        'administrasi_kirim_otomatis',
        `sakit:${k.baris.no_surat}`,
        `rm=${k.baris.no_rkm_medis} diagnosa=${diagnosa ? 'ikut' : 'tidak'} pdf=${pdf.byteLength}B`,
      );
      terkirim++;
    } catch (err) {
      /**
       * Siklusnya DIHENTIKAN, bukan dilanjutkan ke surat berikutnya.
       *
       * `suratKeHtml()` merangkai string yang seluruhnya kita lolos sendiri,
       * jadi kegagalan di sini hampir pasti Chromium-nya yang bermasalah
       * (memori habis, peramban mati) -- bukan satu surat yang beracun.
       * Meneruskan berarti meluncurkan Chromium sekian kali lagi selagi ia
       * rusak, persis cara proses yatim menumpuk. Jendelanya dibaca ulang lima
       * menit lagi, jadi tidak ada yang hilang; `no_surat`-nya ikut dicatat
       * supaya kalau ternyata memang SATU surat, ia langsung kelihatan.
       */
      logger.error(
        { noSurat: k.baris.no_surat, terkirim, ...safeError(err) },
        'gagal mengirim surat sakit otomatis, siklus dihentikan',
      );
      return;
    }
  }

  logger.info(
    {
      ...jendela,
      terbaca: baris.length,
      baru: belum.length,
      terkirim,
      ...ringkasAlasan(lewat.map((l) => l.alasan)),
      ...(terlaluPanjang ? { pesanTerlaluPanjang: terlaluPanjang } : {}),
    },
    'siklus surat sakit otomatis selesai',
  );
}

function kunciSurat(noSurat: string): string {
  /**
   * Per `no_surat`, dan TANPA stempel waktu -- kebalikan dari jalur manual.
   *
   * Di sana stempel waktu ada supaya staf bisa mengirim ulang, dan itu benar
   * karena ada manusia yang memutuskan tiap kalinya. Di sini tidak ada
   * siapa-siapa: kunci yang selalu baru berarti jendela pindai mengirimkan surat
   * yang sama setiap lima menit selama berhari-hari. Kirim ulang tetap mungkin,
   * lewat tombol di tab Surat sakit.
   */
  return buildIdempotencyKey(TRIGGER_SURAT_SAKIT, 'sakit', noSurat);
}

/**
 * Melengkapi tiap baris dengan dua hal yang hanya database yang tahu.
 *
 * `resolvePhone()` dipakai APA ADANYA, bukan `normalizePhone(no_tlp)`: koreksi
 * manual yang dimasukkan petugas lewat `/nomor-bermasalah` mengalahkan
 * normalisasi otomatis (F2.1-F2.3), dan memutuskan dari `no_tlp` mentah akan
 * menolak persis pasien yang nomornya sudah dibetulkan. Efek sampingnya
 * disengaja: `patient_contact` ikut tersegarkan, jadi halaman nomor bermasalah
 * tetap mencerminkan keadaan sekarang.
 */
async function susunKandidat(baris: BarisSuratSakit[]): Promise<Array<KandidatSurat<BarisSuratSakit>>> {
  const hasil: Array<KandidatSurat<BarisSuratSakit>> = [];
  for (const row of baris) {
    const { phoneE164 } = await resolvePhone(row.no_rkm_medis, row.no_tlp);
    hasil.push({
      baris: row,
      kdPoli: row.kd_poli,
      phoneE164,
      // Diperiksa di sini HANYA untuk menghindari render yang sia-sia.
      // `enqueueMessage` memeriksanya lagi dan itulah yang menentukan statusnya
      // -- SURAT_SAKIT terdaftar di OPT_OUT_TRIGGERS (core/optOut.ts).
      optOut: phoneE164 ? (await OptOut.findByPk(phoneE164)) !== null : false,
    });
  }
  return hasil;
}

/** Satu jalan masuk ke outbox, dengan atau tanpa lampiran -- supaya keduanya tidak menyimpang. */
async function catat(
  k: KandidatSurat<BarisSuratSakit>,
  ctx: Awaited<ReturnType<typeof loadAdministrasiContext>>,
  media: { path: string; mime: string; name: string } | null,
): Promise<void> {
  const isi = susunSuratSakit(k.baris);
  await enqueueMessage(
    {
      idempotencyKey: kunciSurat(k.baris.no_surat),
      noRkmMedis: k.baris.no_rkm_medis,
      rawPhone: k.baris.no_tlp,
      /**
       * Waktu DETEKSI, bukan tanggal apa pun milik suratnya -- pilihan yang
       * sama dengan BOOK_CONFIRM/BOOK_CANCEL. Tabelnya memang tidak punya waktu
       * penyimpanan, dan memakai tanggal kunjungan akan membuat surat untuk
       * kunjungan pekan lalu dinilai basi lalu ditandai `expired` (F5.3) --
       * padahal ia baru saja dibuat.
       */
      eventAt: new Date(),
      kdPoli: k.baris.kd_poli,
      vars: { nama_pasien: isi.namaPasien, no_rm: isi.noRm },
      media,
    },
    ctx,
  );
}

function ringkasAlasan(alasan: AlasanLewatSurat[]): Record<string, number> {
  const hitung: Record<string, number> = {};
  for (const a of alasan) hitung[`lewat_${a}`] = (hitung[`lewat_${a}`] ?? 0) + 1;
  return hitung;
}
