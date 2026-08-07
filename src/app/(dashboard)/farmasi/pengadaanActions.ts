'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, logAudit, setSetting, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { findUnknownVariables, PENGADAAN_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { kelompokkanDetail } from '@/core/pengadaan';
import { pollPengadaanJendela, ambilDetailPengadaan } from '@/khanza/pengadaan';
import { susunVarsPengadaan } from '@/worker/pengadaanRunner';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk bagian PENGADAAN di `/farmasi`.
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan `daruratActions.ts`
 * dari `actions.ts`: batasnya bukan panjang melainkan pertanyaan yang dijawab.
 */

export interface HasilPengadaan {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjauPengadaan {
  error?: string;
  teks?: string;
  noFaktur?: string;
  jumlahItem?: number;
  /** >1 berarti daftarnya dipecah karena panjang. */
  jumlahPesan?: number;
  /** Tidak ada faktur sama sekali di jendela -- bukan galat, tapi harus dikatakan. */
  kosong?: boolean;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat sebagai peristiwa audit tersendiri.
 *
 * Alasan yang sama dengan `farmasi_toggle` dan `stok_darurat_toggle`: inilah
 * momen nota pembelian -- berikut harga beli dari pemasok -- mulai mengalir ke
 * WhatsApp. Menenggelamkannya sebagai satu nama kunci di dalam `settings_update`
 * membuat perubahan paling berkonsekuensi di bagian ini jadi yang paling sulit
 * ditelusuri.
 *
 * LANTAI aktivasi ditulis di sini, dan hanya saat MENYALAKAN. Tanpa itu,
 * menyalakan sakelar berarti seluruh isi jendela -- termasuk pembelian yang
 * sudah diurus tuntas minggu lalu -- langsung jadi pesan WhatsApp pada siklus
 * berikutnya. Pelajaran yang sama dengan `administrasi.auto_sejak`.
 *
 * Saat MEMATIKAN, lantainya sengaja dibiarkan apa adanya: menghapusnya berarti
 * mematikan lalu menyalakan kembali membongkar arsip, dan itu justru urutan
 * tindakan yang paling wajar dilakukan orang yang sedang mencoba-coba.
 */
export async function togglePengadaanAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  if (enabled) {
    const hariIni = new Date();
    const iso = `${hariIni.getFullYear()}-${String(hariIni.getMonth() + 1).padStart(2, '0')}-${String(hariIni.getDate()).padStart(2, '0')}`;
    await setSetting('farmasi.pengadaan_sejak', iso);
  }
  await setSetting('farmasi.pengadaan_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'pengadaan_toggle',
    'farmasi.pengadaan_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

export async function toggleTerimaPengadaanAction(id: number, terima: boolean): Promise<HasilPengadaan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ terimaPengadaan: terima, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_pengadaan',
    String(id),
    `${row.jenis} ${row.chatId} -> ${terima ? 'menerima nota pengadaan' : 'tidak menerima nota pengadaan'}`,
  );
  segarkan();
  return {
    sukses: terima
      ? `"${row.label}" sekarang menerima nota pengadaan.`
      : `"${row.label}" tidak lagi menerima nota pengadaan.`,
  };
}

export async function simpanPengadaanAction(
  _prev: HasilPengadaan,
  formData: FormData,
): Promise<HasilPengadaan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const template = String(formData.get('template_pengadaan') ?? '');
  const harga = formData.get('pengadaan_harga') === 'on';
  const lookback = Number(formData.get('pengadaan_lookback_hari'));
  const kuota = Number(formData.get('pengadaan_max_per_siklus'));

  if (!template.trim()) {
    return { error: 'Isi pesan tidak boleh kosong — tanpa itu nota terkirim sebagai pesan hampa.' };
  }

  /**
   * Jendela dijepit 1-30 hari.
   *
   * Batas ATASNYA bukan kerapian: jendela adalah jumlah hari yang dibaca ULANG
   * tiap lima menit, dan ia merentang ke DUA arah -- jadi 30 berarti 61 hari
   * faktur dibaca tiap siklus. Batas BAWAHNYA 1, bukan 0: jendela nol hari cuma
   * memuat hari ini, sehingga satu siklus yang terlewat (worker mati semalam)
   * berarti faktur kemarin tidak pernah terkirim, selamanya.
   */
  if (!Number.isFinite(lookback) || lookback < 1 || lookback > 30) {
    return { error: 'Jendela pindai harus antara 1 dan 30 hari.' };
  }
  if (!Number.isFinite(kuota) || kuota < 1 || kuota > 50) {
    return { error: 'Kuota per siklus harus antara 1 dan 50.' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3).
  const takDikenal = findUnknownVariables(template, PENGADAAN_TEMPLATE_VARIABLES);
  if (takDikenal.length > 0) {
    return {
      error: `Variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${PENGADAAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
    };
  }

  await setSetting('farmasi.template_pengadaan', template);
  await setSetting('farmasi.pengadaan_harga', harga ? '1' : '0');
  await setSetting('farmasi.pengadaan_lookback_hari', String(Math.floor(lookback)));
  await setSetting('farmasi.pengadaan_max_per_siklus', String(Math.floor(kuota)));
  await logAudit(
    session!.user.username,
    'pengadaan_pesan',
    'farmasi.template_pengadaan',
    `isi pesan diperbarui; harga: ${harga ? 'ikut' : 'tidak'}; jendela ${Math.floor(lookback)} hari; kuota ${Math.floor(kuota)}`,
  );
  segarkan();
  return { sukses: 'Pengaturan pengadaan tersimpan.' };
}

/**
 * Pratinjau atas faktur SUNGGUHAN yang terakhir masuk.
 *
 * Memakai `susunVarsPengadaan()` dan `renderTemplate()` yang SAMA dipakai worker
 * -- pratinjau yang berbeda dari kenyataan lebih buruk daripada tanpa pratinjau,
 * pelajaran yang sudah dibayar di kotak uji coba balasan otomatis, balasan stok,
 * dan darurat stok.
 *
 * Dibaca dari nilai TERSIMPAN, bukan dari isi kotak yang sedang diketik, dan itu
 * pilihan yang sama dengan tombol "Kirim peringatan uji" di `/pengaturan`: yang
 * perlu dibuktikan staf adalah apa yang akan DIKIRIM WORKER, dan worker membaca
 * `app_setting`. Pratinjau atas isian yang belum disimpan akan menampilkan
 * bentuk pesan yang tidak akan pernah dipakai -- persis kegagalan yang alasan
 * "pratinjau harus memakai fungsi yang sama" ada untuk mencegahnya.
 *
 * Halamannya mengatakan ini di depan staf, supaya "kenapa suntingan saya belum
 * kelihatan" terjawab tanpa harus menebak.
 */
export async function pratinjauPengadaanAction(
  _prev: HasilPratinjauPengadaan,
  _formData: FormData,
): Promise<HasilPratinjauPengadaan> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const [template, harga, lookback] = await Promise.all([
    getSetting('farmasi.template_pengadaan', ''),
    getSettingBool('farmasi.pengadaan_harga', true),
    getSettingNumber('farmasi.pengadaan_lookback_hari', 7),
  ]);

  if (!template?.trim()) return { error: 'Isi pesan masih kosong. Simpan isi pesannya lebih dulu.' };

  try {
    /**
     * Lantai aktivasi SENGAJA dilewati di pratinjau (`sejak` = null).
     *
     * Yang ingin dibuktikan staf adalah bentuk pesannya, dan lantai yang baru
     * ditulis hari ini akan membuat jendelanya kosong sepanjang hari pertama --
     * sehingga pratinjau menjawab "belum ada faktur" pada instalasi yang
     * fakturnya jelas ada, dan staf menyimpulkan query-nya rusak.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const header = await pollPengadaanJendela(jendela.dari, jendela.sampai);
    const terakhir = header[header.length - 1];
    if (!terakhir) return { kosong: true };

    const detail = await ambilDetailPengadaan([terakhir.no_faktur], harga);
    const bagian = susunVarsPengadaan(terakhir, kelompokkanDetail(detail).get(terakhir.no_faktur) ?? [], new Date());

    /**
     * Identitas RS disisipkan sebagai DASAR, persis seperti `enqueueMessage`.
     *
     * Tanpa ini `{nama_rs}` tampil kosong di pratinjau padahal terisi saat
     * benar-benar dikirim -- dan staf yang melihatnya wajar menyimpulkan
     * variabelnya tidak jalan lalu membuangnya dari template. Bentuk kegagalan
     * yang sama persis dengan `{cara_bayar}` yang dulu kosong di `poll:dryrun`.
     */
    const identitas = await getHospitalIdentity();
    const teks = bagian
      .map((v) =>
        renderTemplate(template, {
          nama_rs: identitas.namaRs,
          alamat_rs: identitas.alamatRs,
          kontak_rs: identitas.kontakRs,
          ...v,
        }),
      )
      .join('\n\n──────────\n\n');

    return {
      teks,
      noFaktur: terakhir.no_faktur,
      jumlahItem: detail.length,
      jumlahPesan: bagian.length,
    };
  } catch (err) {
    return { error: `Gagal membaca data pengadaan: ${err instanceof Error ? err.message : String(err)}` };
  }
}
