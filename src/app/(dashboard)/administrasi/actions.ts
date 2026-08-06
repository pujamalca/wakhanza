'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logAudit, setSetting } from '@/models';
import { requireRole } from '@/lib/authz';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadAdministrasiContext, enqueueMessage, previewUniqueCodeFooter } from '@/worker/pipeline';
import { checkPrivacy } from '@/core/privacy';
import { normalizePhone } from '@/core/phone';
import { periksaPanjangKeterangan } from '@/core/media';
import { mediaDir } from '@/lib/mediaStorage';
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
} from '@/lib/surat';
import { htmlKePdf } from '@/lib/pdf';
import { renderTemplate, findUnknownVariables } from '@/core/template';

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
 * Menyimpan PDF ke direktori lampiran yang sudah ada.
 *
 * Memakai `uploads/broadcast/` yang sama, BUKAN direktori baru, dan itu bukan
 * kemalasan: `cleanupOrphanMedia()` di worker memangkas berkas yang tidak lagi
 * ditunjuk baris `outbox` mana pun dengan memindai direktori itu. Direktori
 * kedua berarti berkas surat tidak pernah ikut terpangkas -- setiap surat yang
 * pernah dikirim menetap di disk selamanya, memuat nama dan alamat pasien.
 *
 * Nama berkas di disk tetap ACAK (`namaBerkasSimpanan` tidak dipakai di sini
 * hanya karena sumbernya bukan unggahan, tapi aturannya sama): nama yang
 * dilihat pasien disimpan terpisah di `outbox.media_name`.
 */
async function simpanPdf(pdf: Buffer): Promise<string> {
  const nama = `${randomBytes(8).toString('hex')}.pdf`;
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(path.join(mediaDir(), nama), pdf);
  return nama;
}

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
  const mediaPath = await simpanPdf(pdf);

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
