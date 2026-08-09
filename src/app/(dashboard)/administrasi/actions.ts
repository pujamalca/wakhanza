'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, setSetting } from '@/models';
import { requireRole } from '@/lib/authz';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadAdministrasiContext, enqueueMessage, previewUniqueCodeFooter } from '@/worker/pipeline';
import { checkPrivacy } from '@/core/privacy';
import { normalizePhone } from '@/core/phone';
import { periksaPanjangKeterangan } from '@/core/media';
import { simpanPdfSurat } from '@/lib/mediaStorage';
import { namaBerkasSurat, type JenisSurat } from '@/core/suratDoc';
import {
  muatSurat,
  suratKeHtml,
  sertakanDiagnosa,
  administrasiAktif,
  bacaPesanPengantar,
  SETTING_AKTIF,
  SETTING_DIAGNOSA,
  SETTING_PESAN_SAKIT,
  SETTING_PESAN_SEHAT,
  SETTING_CATATAN_KAKI,
  SETTING_AUTO,
  SETTING_AUTO_SEJAK,
  SETTING_AUTO_LOOKBACK,
  SETTING_AUTO_KUOTA,
} from '@/lib/surat';
import { htmlKePdf } from '@/lib/pdf';
import { renderTemplate, findUnknownVariables } from '@/core/template';
import type { JenisDokumen } from '@/core/dokumenDoc';
import {
  SETTING_AKTIF as SETTING_DOKUMEN_AKTIF,
  SETTING_PESAN as SETTING_PESAN_DOKUMEN,
  SETTING_RINCIAN_OBAT,
  SETTING_CATATAN_KAKI as SETTING_CATATAN_KAKI_DOKUMEN,
} from '@/lib/dokumen';

/**
 * Label yang dibaca staf, dan sengaja BUKAN kode jenisnya.
 *
 * Dipakai pesan sukses server action maupun pesan galat validasi -- staf yang
 * membaca "Pesan radiologi: ..." tahu kotak mana yang dimaksud, sementara
 * "Pesan rad: ..." memaksa menebak.
 */
const LABEL_DOKUMEN: Record<JenisDokumen, string> = {
  lab: 'Hasil laboratorium',
  radiologi: 'Hasil radiologi',
  nota: 'Rincian tagihan',
};

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function segarkan(): void {
  revalidatePath('/administrasi');
}

/** Variabel yang boleh dipakai pesan pengantar -- sengaja sesempit BROADCAST. */
const VARIABEL_PESAN = ['nama_pasien', 'no_rm', 'nama_rs', 'alamat_rs', 'kontak_rs'] as const;
const VARS_HINT = VARIABEL_PESAN.map((v) => `{${v}}`).join(' ');

// ---------------------------------------------------------------------------
// Sakelar & pengaturan
// ---------------------------------------------------------------------------

/**
 * Sakelar utama, dicatat `audit_log` sebagai peristiwanya sendiri -- pola yang
 * sama dengan `farmasi_toggle`, `auto_reply_toggle`, dan `bpjs_toggle`. Inilah
 * momen surat resmi rumah sakit mulai bisa beredar sebagai berkas WhatsApp;
 * menenggelamkannya jadi satu nama kunci di dalam `settings_update` membuat
 * perubahan paling berkonsekuensi di halaman ini jadi yang paling sulit
 * ditelusuri.
 */
export async function toggleAdministrasiAction(aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  await setSetting(SETTING_AKTIF, aktif ? '1' : '0');
  await logAudit(session!.user.username, 'administrasi_toggle', SETTING_AKTIF, aktif ? 'nyala' : 'mati');
  segarkan();
  return { sukses: aktif ? 'Pengiriman dokumen dinyalakan.' : 'Pengiriman dokumen dimatikan.' };
}

/**
 * Diagnosa dicatat TERPISAH dari sakelar utama, dan bukan demi kerapian: ini
 * satu-satunya setelan di halaman ini yang mengubah APA yang tercetak di dalam
 * surat, bukan sekadar apakah surat boleh dikirim. Baris auditnya harus bisa
 * menjawab "sejak kapan diagnosa ikut tercetak" tanpa membaca diff pengaturan.
 */
export async function toggleDiagnosaAction(aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  await setSetting(SETTING_DIAGNOSA, aktif ? '1' : '0');
  await logAudit(session!.user.username, 'administrasi_diagnosa_toggle', SETTING_DIAGNOSA, aktif ? 'nyala' : 'mati');
  segarkan();
  return {
    sukses: aktif
      ? 'Diagnosa akan ikut tercetak di surat keterangan sakit.'
      : 'Diagnosa tidak ikut tercetak.',
  };
}

/** Tanggal lokal sebagai YYYY-MM-DD -- lantai jendela pindai, bukan stempel waktu. */
function hariIniIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Sakelar KIRIM OTOMATIS. Dua hal yang menempel padanya, dan keduanya bukan
 * kerapian:
 *
 * 1. **Menolak menyala selama sakelar utama mati.** Bukan sekadar validasi:
 *    tanpa ini halaman menampilkan sakelar otomatis bercentang sementara
 *    `otomatisAktif()` di worker tetap `false`, dan yang terlihat staf adalah
 *    fitur yang menyala tapi tidak pernah mengirim apa pun -- keadaan
 *    "menyala tapi setengah jadi" yang sudah dibayar di /farmasi.
 *
 * 2. **Menulis lantai aktivasi pada saat yang sama.** Kalau tidak, siklus
 *    berikutnya membaca jendela penuh dan mengirimkan surat-surat lama
 *    sekaligus. Ditulis SEBELUM sakelarnya, supaya urutan yang salah tidak
 *    pernah menyisakan celah beberapa milidetik dengan sakelar menyala tanpa
 *    lantai -- worker berjalan di proses lain dan tidak menunggu siapa pun.
 */
export async function toggleAutoAction(aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  if (aktif && !(await administrasiAktif())) {
    return { error: 'Nyalakan dulu "Pengiriman dokumen ke pasien" di atas — tanpa itu pengiriman otomatis tidak akan mengirim apa pun.' };
  }

  const sejak = hariIniIso();
  if (aktif) await setSetting(SETTING_AUTO_SEJAK, sejak);
  await setSetting(SETTING_AUTO, aktif ? '1' : '0');
  await logAudit(
    session!.user.username,
    'administrasi_auto_toggle',
    SETTING_AUTO,
    aktif ? `nyala sejak=${sejak}` : 'mati',
  );
  segarkan();
  return {
    sukses: aktif
      ? `Kirim otomatis dinyalakan. Yang dikirimkan hanya surat bernomor mulai ${sejak}; surat yang lebih lama tetap harus dikirim manual dari tab Surat sakit.`
      : 'Kirim otomatis dimatikan. Pengiriman manual tetap bisa dipakai.',
  };
}

/**
 * Lebar jendela dan kuota per siklus.
 *
 * Sengaja TIDAK didaftarkan ke `EDITABLE_KEYS` di `/api/settings`, alasan yang
 * sama seperti kunci `farmasi.*`: form Pengaturan mengirim ULANG semua kunci
 * tiap kali Simpan ditekan, jadi membiarkannya di sana membuka jalan agar
 * nilainya tertimpa oleh halaman yang bahkan tidak menampilkannya.
 */
export async function simpanAutoAction(_prev: HasilForm, form: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const lookback = Number(form.get('auto_lookback'));
  const kuota = Number(form.get('auto_kuota'));

  // Dijepit, bukan sekadar ditolak saat kosong. Nol pada lookback berarti "hari
  // ini saja" dan itu sah; nol pada kuota berarti fitur yang menyala tapi tidak
  // pernah mengirim -- persis keadaan yang paling sulit dikenali dari layar.
  if (!Number.isInteger(lookback) || lookback < 0 || lookback > 30) {
    return { error: 'Lebar jendela harus bilangan bulat 0–30 hari.' };
  }
  if (!Number.isInteger(kuota) || kuota < 1 || kuota > 100) {
    return { error: 'Kuota per siklus harus bilangan bulat 1–100.' };
  }

  await setSetting(SETTING_AUTO_LOOKBACK, String(lookback));
  await setSetting(SETTING_AUTO_KUOTA, String(kuota));
  await logAudit(session!.user.username, 'administrasi_auto_update', 'administrasi.auto', `lookback=${lookback} kuota=${kuota}`);
  segarkan();
  return { sukses: 'Pengaturan kirim otomatis disimpan.' };
}

export async function simpanTeksAction(_prev: HasilForm, form: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const pesanSakit = String(form.get('pesan_sakit') ?? '').trim();
  const pesanSehat = String(form.get('pesan_sehat') ?? '').trim();
  const catatanKaki = String(form.get('catatan_kaki') ?? '').trim();

  // Ditolak SAAT DISIMPAN, bukan saat kirim -- aturan yang sama untuk seluruh
  // template di proyek ini. Variabel salah ketik yang baru ketahuan setelah
  // pesannya terkirim kosong ke pasien adalah cara termahal untuk memberi tahu.
  for (const [label, teks] of [
    ['Pesan surat sakit', pesanSakit],
    ['Pesan surat sehat', pesanSehat],
  ] as const) {
    const tidakDikenal = findUnknownVariables(teks, VARIABEL_PESAN);
    if (tidakDikenal.length) {
      return { error: `${label}: variabel tidak dikenal ${tidakDikenal.join(', ')}. Yang tersedia: ${VARS_HINT}` };
    }
  }

  await setSetting(SETTING_PESAN_SAKIT, pesanSakit);
  await setSetting(SETTING_PESAN_SEHAT, pesanSehat);
  await setSetting(SETTING_CATATAN_KAKI, catatanKaki);
  // ISI pesannya tidak ikut dicatat -- hanya panjangnya. `audit_log` sengaja
  // append-only dan tidak pernah dipangkas, jadi menyalin teks ke sana berarti
  // menyimpannya selamanya; yang perlu dijawab audit adalah siapa mengubah apa
  // dan kapan, dan teks terbarunya selalu bisa dibaca di halamannya.
  await logAudit(
    session!.user.username,
    'administrasi_teks_update',
    'administrasi.pesan',
    `sakit=${pesanSakit.length} sehat=${pesanSehat.length} catatan_kaki=${catatanKaki ? 'diisi' : 'kosong'}`,
  );
  segarkan();
  return { sukses: 'Teks disimpan.' };
}

// ---------------------------------------------------------------------------
// Kirim
// ---------------------------------------------------------------------------

/**
 * Kirim satu surat ke satu pasien.
 *
 * URUTANNYA MENGIKAT, dan tiap langkah menolak lebih awal daripada langkah
 * berikutnya supaya kegagalan yang paling sering tidak pernah sampai
 * menghasilkan berkas di disk:
 *
 *   1. izin & sakelar
 *   2. baris masih ada di Khanza
 *   3. poli sensitif      -> TOLAK, bukan ganti template generik
 *   4. nomor terpakai     -> tolak sebelum merender
 *   5. render PDF, simpan
 *   6. enqueue
 */
export async function kirimSuratAction(jenis: JenisSurat, kunci: string): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  if (!(await administrasiAktif())) {
    return { error: 'Pengiriman dokumen masih dimatikan. Nyalakan lebih dulu di tab Pengaturan.' };
  }

  const surat = await muatSurat(jenis, kunci);
  if (!surat) {
    return { error: 'Data suratnya tidak ditemukan lagi di Khanza. Muat ulang halamannya.' };
  }
  const { isi } = surat;

  const ctxPesan = await bacaPesanPengantar(jenis);
  const ctx = await loadAdministrasiContext(ctxPesan);

  /**
   * Poli sensitif MENOLAK, tidak diganti template generik.
   *
   * Sepuluh pemicu lain mengganti isi pesannya dengan kalimat tanpa identitas,
   * dan itu cukup karena yang bocor memang cuma beberapa kata. Di sini yang
   * menyertai pesan adalah BERKAS berisi nama, alamat, dan nomor rekam medis
   * pasien -- mengganti kalimat pengantarnya tidak menyembunyikan apa pun
   * selama lampirannya tetap ikut, dan mengirim lampiran tanpa pesan yang
   * menjelaskannya justru lebih membingungkan.
   *
   * Menolak di sini bukan berarti pasien tidak bisa mendapat suratnya: ia tetap
   * bisa mengambilnya di loket, jalur yang kendali aksesnya memang ada.
   */
  const privasi = checkPrivacy({ kdPoli: surat.kdPoli, kdJenisPrw: null }, ctx.sensitivePoli, ctx.sensitiveExam);
  if (!privasi.safe) {
    await logAudit(
      session!.user.username,
      'administrasi_kirim_ditolak',
      `${jenis}:${kunci}`,
      privasi.reason ?? 'sensitif',
    );
    return {
      error:
        'Kunjungan ini berada di poli yang ditandai sensitif, jadi dokumennya tidak dikirim lewat WhatsApp. Serahkan langsung di loket.',
    };
  }

  /**
   * Nomor diperiksa SEBELUM PDF dirender, bukan sesudah.
   *
   * `enqueueMessage()` sendiri sudah menangani nomor tak terpakai (barisnya
   * ditulis `skipped_no_contact`), jadi ini bukan pemeriksaan yang hilang --
   * ini pemeriksaan yang DIMAJUKAN. Dua alasannya: staf yang menekan kirim
   * harus tahu SEKARANG bahwa suratnya tidak akan sampai, bukan menemukannya di
   * halaman Antrean nanti; dan tanpa ini setiap surat untuk pasien tanpa nomor
   * tetap meninggalkan berkas PDF di disk yang tidak pernah dikirim ke siapa
   * pun. Di rumah sakit ini 40% nomor pasien tidak terpakai, jadi itu bukan
   * kasus pinggiran.
   */
  const nomor = normalizePhone(surat.noTlp);
  if (!nomor.ok) {
    const sebab: Record<string, string> = {
      empty: 'belum diisi',
      too_short: 'terlalu pendek',
      not_mobile: 'bukan nomor ponsel',
      unparseable: 'tidak bisa dibaca',
    };
    return {
      error: `Nomor WhatsApp pasien ${sebab[nomor.reason] ?? nomor.reason}. Perbaiki lebih dulu lewat menu Nomor bermasalah, lalu coba lagi.`,
    };
  }

  const pesan = renderTemplate(ctxPesan, {
    nama_pasien: isi.namaPasien,
    no_rm: isi.noRm,
    nama_rs: ctx.identity.namaRs,
    alamat_rs: ctx.identity.alamatRs,
    kontak_rs: ctx.identity.kontakRs,
  });

  // Batas 1024 karakter berlaku KARENA ada lampiran -- pesan teks biasa boleh
  // panjang. Diperiksa di sini, bukan saat kirim, berikut panjang baris kode
  // pengiriman yang ikut memakan jatahnya.
  const footer = await previewUniqueCodeFooter(`administrasi|${jenis}|${kunci}`);
  const panjang = periksaPanjangKeterangan(pesan, footer ? footer.length + 1 : 0);
  if (!panjang.ok) return { error: panjang.error };

  const pdf = await htmlKePdf(await suratKeHtml(isi));
  const mediaPath = await simpanPdfSurat(pdf);

  /**
   * Kunci idempoten memuat STEMPEL WAKTU, jadi surat yang sama boleh dikirim
   * ulang.
   *
   * Berbeda dari sepuluh pemicu lain, yang justru ada untuk memastikan satu
   * kejadian = satu pesan. Di sini pengirimnya manusia yang menekan tombol
   * untuk satu pasien: permintaan kirim ulang adalah keadaan NORMAL (berkas
   * terhapus dari ponsel, pasien ganti nomor, kiriman pertama gagal). Menolaknya
   * sebagai duplikat berarti staf menekan tombol, halaman menjawab berhasil,
   * dan tidak ada apa pun yang terkirim -- kegagalan tak terlihat yang sama
   * dengan yang sudah dibayar berkali-kali di proyek ini.
   *
   * Perlindungan terhadap tekan-ganda tetap ada, tapi tempatnya di layar
   * (tombol dinonaktifkan selama proses) -- bukan di database.
   */
  const idempotencyKey = buildIdempotencyKey('ADMINISTRASI', jenis, kunci, Date.now());

  await enqueueMessage(
    {
      idempotencyKey,
      noRkmMedis: surat.noRkmMedis,
      rawPhone: surat.noTlp,
      eventAt: new Date(),
      kdPoli: surat.kdPoli,
      vars: {
        nama_pasien: isi.namaPasien,
        no_rm: isi.noRm,
      },
      media: { path: mediaPath, mime: 'application/pdf', name: namaBerkasSurat(jenis, isi.namaPasien) },
    },
    ctx,
  );

  // Nomor tujuan TIDAK ikut dicatat -- §9.7. Yang perlu dijawab audit adalah
  // siapa mengirim surat apa untuk pasien mana, dan `no_rkm_medis` sudah
  // menjawabnya tanpa menaruh nomor telepon di tabel yang tidak pernah dihapus.
  await logAudit(
    session!.user.username,
    'administrasi_kirim',
    `${jenis}:${kunci}`,
    `rm=${surat.noRkmMedis} diagnosa=${jenis === 'sakit' && (await sertakanDiagnosa()) ? 'ikut' : 'tidak'} pdf=${pdf.byteLength}B`,
  );

  segarkan();
  return { sukses: `Surat untuk ${isi.namaPasien} dimasukkan ke antrean kirim.` };
}

// ---------------------------------------------------------------------------
// Dokumen hasil lab / radiologi / nota (migrations/038)
// ---------------------------------------------------------------------------

/**
 * Sakelar per jenis dokumen, dicatat `audit_log` sebagai peristiwanya SENDIRI
 * dan menyebut jenisnya -- pola yang sama dengan `administrasi_toggle`.
 *
 * Bukan kerapian. Inilah momen data medis mulai beredar sebagai berkas: angka
 * hasil laboratorium, narasi bacaan radiologi, daftar rinci layanan berikut
 * nama obat. Menenggelamkannya jadi satu nama kunci di dalam `settings_update`
 * membuat perubahan paling berkonsekuensi di seluruh halaman ini jadi yang
 * paling sulit ditelusuri -- dan pertanyaan "sejak kapan hasil lab ikut
 * terkirim" adalah pertanyaan yang harus bisa dijawab tanpa membaca diff.
 */
export async function toggleDokumenAction(jenis: JenisDokumen, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  await setSetting(SETTING_DOKUMEN_AKTIF[jenis], aktif ? '1' : '0');
  await logAudit(
    session!.user.username,
    'dokumen_toggle',
    SETTING_DOKUMEN_AKTIF[jenis],
    `${jenis}=${aktif ? 'nyala' : 'mati'}`,
  );
  segarkan();
  return {
    sukses: aktif
      ? `${LABEL_DOKUMEN[jenis]} akan ikut dilampirkan sebagai PDF.`
      : `${LABEL_DOKUMEN[jenis]} tidak lagi dilampirkan.`,
  };
}

/**
 * Rincian nama obat pada nota -- sakelar tersendiri, dicatat tersendiri.
 *
 * Alasannya sama dengan `administrasi_diagnosa_toggle`: ini setelan yang
 * mengubah APA yang tercetak di dalam berkas, bukan apakah berkasnya boleh
 * dikirim. Daftar obat seseorang mengatakan penyakitnya dengan cukup jelas, dan
 * `FARMASI_TEMPLATE_VARIABLES` sampai sekarang tidak punya variabelnya justru
 * karena itu.
 */
export async function toggleRincianObatAction(aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  await setSetting(SETTING_RINCIAN_OBAT, aktif ? '1' : '0');
  await logAudit(
    session!.user.username,
    'dokumen_rincian_obat_toggle',
    SETTING_RINCIAN_OBAT,
    aktif ? 'nyala' : 'mati',
  );
  segarkan();
  return {
    sukses: aktif
      ? 'Nama obat akan tercetak satu per satu di nota.'
      : 'Nama obat diringkas jadi satu subtotal di nota.',
  };
}

export async function simpanTeksDokumenAction(_prev: HasilForm, form: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const teks: Record<JenisDokumen, string> = {
    lab: String(form.get('pesan_lab') ?? '').trim(),
    radiologi: String(form.get('pesan_rad') ?? '').trim(),
    nota: String(form.get('pesan_nota') ?? '').trim(),
  };
  const catatanKaki = String(form.get('catatan_kaki_dokumen') ?? '').trim();

  for (const jenis of ['lab', 'radiologi', 'nota'] as const) {
    const tidakDikenal = findUnknownVariables(teks[jenis], VARIABEL_PESAN);
    if (tidakDikenal.length) {
      return {
        error: `Pesan ${LABEL_DOKUMEN[jenis]}: variabel tidak dikenal ${tidakDikenal.join(', ')}. Yang tersedia: ${VARS_HINT}`,
      };
    }
    /**
     * Batas 1.024 karakter diperiksa DI SINI, bukan saat kirim.
     *
     * Pesan yang membawa lampiran menjadi *caption* dan tunduk pada batas jauh
     * lebih pendek daripada pesan teks biasa. Kalau baru ketahuan saat kirim,
     * gejalanya adalah lampiran yang diam-diam tidak pernah ikut -- pasien
     * menerima pesannya, tanpa berkasnya, tanpa satu pun galat di layar
     * siapa pun. Cadangan panjang untuk baris kode pengiriman ikut dihitung.
     */
    const cek = periksaPanjangKeterangan(teks[jenis], 64);
    if (!cek.ok) return { error: `Pesan ${LABEL_DOKUMEN[jenis]}: ${cek.error}` };
  }

  await setSetting(SETTING_PESAN_DOKUMEN.lab, teks.lab);
  await setSetting(SETTING_PESAN_DOKUMEN.radiologi, teks.radiologi);
  await setSetting(SETTING_PESAN_DOKUMEN.nota, teks.nota);
  await setSetting(SETTING_CATATAN_KAKI_DOKUMEN, catatanKaki);
  await logAudit(
    session!.user.username,
    'dokumen_teks_update',
    'dokumen.pesan',
    `lab=${teks.lab.length} rad=${teks.radiologi.length} nota=${teks.nota.length} catatan_kaki=${catatanKaki ? 'diisi' : 'kosong'}`,
  );
  segarkan();
  return { sukses: 'Teks dokumen disimpan.' };
}
