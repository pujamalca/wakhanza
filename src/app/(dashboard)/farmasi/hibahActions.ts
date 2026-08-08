'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, logAudit, setSetting, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { findUnknownVariables, HIBAH_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { kelompokkanDetailHibah } from '@/core/hibah';
import { pollHibahJendela, ambilDetailHibah } from '@/khanza/hibah';
import { susunVarsHibah } from '@/worker/hibahRunner';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk bagian HIBAH di `/farmasi`.
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan `daruratActions.ts`
 * dan `pengadaanActions.ts` dari `actions.ts`: batasnya bukan panjang melainkan
 * pertanyaan yang dijawab.
 *
 * CATATAN: berkas `'use server'` tidak boleh mengekspor apa pun selain fungsi
 * async -- tipe sekalipun. `export type` lolos `tsc` DAN lolos `next build`,
 * lalu meledak sebagai ReferenceError saat server action pertama dipanggil
 * (pelajaran dari `/administrasi`). Interface hasil di bawah aman karena ia
 * dideklarasikan tanpa diekspor... kecuali yang memang dipakai komponen klien,
 * yang karena itu tinggal di sini sebagai `export interface` -- bentuk yang
 * SAMA dipakai `pengadaanActions.ts` dan terbukti jalan: yang dilarang adalah
 * `export type { X }` atas tipe yang diimpor dari tempat lain, bukan interface
 * yang dideklarasikan di berkas ini.
 */

export interface HasilHibah {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjauHibah {
  error?: string;
  teks?: string;
  noHibah?: string;
  jumlahItem?: number;
  /** >1 berarti daftarnya dipecah karena panjang. */
  jumlahPesan?: number;
  /** Tidak ada hibah sama sekali di jendela -- bukan galat, tapi harus dikatakan. */
  kosong?: boolean;
  /**
   * Tidak ada satu baris hibah pun DI SELURUH RIWAYAT, bukan cuma di jendela.
   *
   * Dibedakan dari `kosong` karena artinya sama sekali lain: yang pertama berarti
   * "belum ada yang baru", yang ini berarti rumah sakit ini belum pernah memakai
   * menu Hibah di Khanza sama sekali -- dan menyalakan sakelarnya tidak akan
   * pernah mengirim apa pun sampai itu berubah. Tanpa pembedaan ini keduanya
   * terbaca sama, dan staf menyimpulkan fiturnya rusak.
   */
  belumPernah?: boolean;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat sebagai peristiwa audit tersendiri.
 *
 * Alasan yang sama dengan `farmasi_toggle`, `stok_darurat_toggle`, dan
 * `pengadaan_toggle`: menenggelamkannya sebagai satu nama kunci di dalam
 * `settings_update` membuat perubahan paling berkonsekuensi di bagian ini jadi
 * yang paling sulit ditelusuri.
 *
 * LANTAI aktivasi ditulis di sini, dan hanya saat MENYALAKAN. Saat MEMATIKAN,
 * lantainya sengaja dibiarkan apa adanya: menghapusnya berarti mematikan lalu
 * menyalakan kembali membongkar arsip, dan itu justru urutan tindakan yang
 * paling wajar dilakukan orang yang sedang mencoba-coba.
 */
export async function toggleHibahAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  if (enabled) {
    const hariIni = new Date();
    const iso = `${hariIni.getFullYear()}-${String(hariIni.getMonth() + 1).padStart(2, '0')}-${String(hariIni.getDate()).padStart(2, '0')}`;
    await setSetting('farmasi.hibah_sejak', iso);
  }
  await setSetting('farmasi.hibah_enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'hibah_toggle', 'farmasi.hibah_enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

export async function toggleTerimaHibahAction(id: number, terima: boolean): Promise<HasilHibah> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ terimaHibah: terima, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_hibah',
    String(id),
    `${row.jenis} ${row.chatId} -> ${terima ? 'menerima nota hibah' : 'tidak menerima nota hibah'}`,
  );
  segarkan();
  return {
    sukses: terima ? `"${row.label}" sekarang menerima nota hibah.` : `"${row.label}" tidak lagi menerima nota hibah.`,
  };
}

export async function simpanHibahAction(_prev: HasilHibah, formData: FormData): Promise<HasilHibah> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const template = String(formData.get('template_hibah') ?? '');
  const nilai = formData.get('hibah_nilai') === 'on';
  const lookback = Number(formData.get('hibah_lookback_hari'));
  const kuota = Number(formData.get('hibah_max_per_siklus'));

  if (!template.trim()) {
    return { error: 'Isi pesan tidak boleh kosong — tanpa itu nota terkirim sebagai pesan hampa.' };
  }

  /**
   * Jendela dijepit 1-30 hari, sama seperti pengadaan.
   *
   * Batas ATASNYA bukan kerapian: jendela adalah jumlah hari yang dibaca ULANG
   * tiap lima menit, dan ia merentang ke DUA arah -- jadi 30 berarti 61 hari
   * dibaca tiap siklus. Batas BAWAHNYA 1, bukan 0: jendela nol hari cuma memuat
   * hari ini, sehingga satu siklus yang terlewat (worker mati semalam) berarti
   * hibah kemarin tidak pernah terkirim, selamanya.
   */
  if (!Number.isFinite(lookback) || lookback < 1 || lookback > 30) {
    return { error: 'Jendela pindai harus antara 1 dan 30 hari.' };
  }
  if (!Number.isFinite(kuota) || kuota < 1 || kuota > 50) {
    return { error: 'Kuota per siklus harus antara 1 dan 50.' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3).
  const takDikenal = findUnknownVariables(template, HIBAH_TEMPLATE_VARIABLES);
  if (takDikenal.length > 0) {
    return {
      error: `Variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${HIBAH_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
    };
  }

  await setSetting('farmasi.template_hibah', template);
  await setSetting('farmasi.hibah_nilai', nilai ? '1' : '0');
  await setSetting('farmasi.hibah_lookback_hari', String(Math.floor(lookback)));
  await setSetting('farmasi.hibah_max_per_siklus', String(Math.floor(kuota)));
  await logAudit(
    session!.user.username,
    'hibah_pesan',
    'farmasi.template_hibah',
    `isi pesan diperbarui; nilai per barang: ${nilai ? 'ikut' : 'tidak'}; jendela ${Math.floor(lookback)} hari; kuota ${Math.floor(kuota)}`,
  );
  segarkan();
  return { sukses: 'Pengaturan hibah tersimpan.' };
}

/**
 * Pratinjau atas penerimaan hibah SUNGGUHAN yang terakhir masuk.
 *
 * Memakai `susunVarsHibah()` dan `renderTemplate()` yang SAMA dipakai worker.
 * Dibaca dari nilai TERSIMPAN, bukan dari isi kotak yang sedang diketik --
 * pilihan yang sama dengan tombol "Kirim peringatan uji" di `/pengaturan`: yang
 * perlu dibuktikan staf adalah apa yang akan DIKIRIM WORKER, dan worker membaca
 * `app_setting`.
 */
export async function pratinjauHibahAction(
  _prev: HasilPratinjauHibah,
  _formData: FormData,
): Promise<HasilPratinjauHibah> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const [template, nilai, lookback] = await Promise.all([
    getSetting('farmasi.template_hibah', ''),
    getSettingBool('farmasi.hibah_nilai', true),
    getSettingNumber('farmasi.hibah_lookback_hari', 7),
  ]);

  if (!template?.trim()) return { error: 'Isi pesan masih kosong. Simpan isi pesannya lebih dulu.' };

  try {
    /**
     * Lantai aktivasi SENGAJA dilewati di pratinjau (`sejak` = null): yang ingin
     * dibuktikan staf adalah bentuk pesannya, dan lantai yang baru ditulis hari
     * ini akan membuat jendelanya kosong sepanjang hari pertama.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const header = await pollHibahJendela(jendela.dari, jendela.sampai);
    let terakhir = header[header.length - 1];

    /**
     * Kalau jendelanya kosong, dicoba SELURUH riwayat -- dan hasilnya dibedakan.
     *
     * Ini yang membuat halaman bisa menjawab pertanyaan yang benar-benar
     * ditanyakan staf di rumah sakit ini: `hibah_obat_bhp` KOSONG di database
     * produksi, jadi "tidak ada di jendela" dan "belum pernah ada sama sekali"
     * akan terlihat persis sama tanpa pembedaan ini -- dan yang kedua berarti
     * menyalakan sakelarnya tidak akan pernah mengirim apa pun.
     */
    if (!terakhir) {
      const seluruh = await pollHibahJendela('2000-01-01', '2099-12-31');
      if (seluruh.length === 0) return { belumPernah: true };
      terakhir = seluruh[seluruh.length - 1];
      if (!terakhir) return { belumPernah: true };
    }

    const detail = await ambilDetailHibah([terakhir.no_hibah], nilai);
    const bagian = susunVarsHibah(terakhir, kelompokkanDetailHibah(detail).get(terakhir.no_hibah) ?? [], new Date());

    /**
     * Identitas RS disisipkan sebagai DASAR, persis seperti `enqueueMessage`.
     * Tanpa ini `{nama_rs}` tampil kosong di pratinjau padahal terisi saat
     * benar-benar dikirim -- dan staf yang melihatnya wajar menyimpulkan
     * variabelnya tidak jalan lalu membuangnya dari template.
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
      noHibah: terakhir.no_hibah,
      jumlahItem: detail.length,
      jumlahPesan: bagian.length,
    };
  } catch (err) {
    return { error: `Gagal membaca data hibah: ${err instanceof Error ? err.message : String(err)}` };
  }
}
