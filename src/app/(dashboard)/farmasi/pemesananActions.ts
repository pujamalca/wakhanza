'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, logAudit, setSetting, getSetting, getSettingBool, getSettingNumber } from '@/models';
import { findUnknownVariables, PEMESANAN_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { kelompokkanDetailPemesanan } from '@/core/pemesanan';
import { pollPemesananJendela, ambilDetailPemesanan } from '@/khanza/pemesanan';
import { susunVarsPemesanan } from '@/worker/pemesananRunner';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk bagian SURAT PEMESANAN di `/farmasi`.
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan `daruratActions.ts`,
 * `pengadaanActions.ts`, dan `hibahActions.ts` dari `actions.ts`: batasnya bukan
 * panjang melainkan pertanyaan yang dijawab.
 *
 * CATATAN: berkas `'use server'` tidak boleh mengekspor apa pun selain fungsi
 * async -- tipe sekalipun. `export type { X }` atas tipe yang DIIMPOR dari tempat
 * lain lolos `tsc` DAN lolos `next build`, lalu meledak sebagai ReferenceError
 * saat server action pertama dipanggil (pelajaran dari `/administrasi`).
 * `export interface` yang dideklarasikan di berkas ini sendiri aman -- bentuk
 * yang sama dipakai `pengadaanActions.ts` dan `hibahActions.ts`.
 */

export interface HasilPemesanan {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjauPemesanan {
  error?: string;
  teks?: string;
  noPemesanan?: string;
  jumlahItem?: number;
  /** >1 berarti daftarnya dipecah karena panjang. */
  jumlahPesan?: number;
  /** Tidak ada pesanan sama sekali di jendela -- bukan galat, tapi harus dikatakan. */
  kosong?: boolean;
  /**
   * Tidak ada satu baris pesanan pun DI SELURUH RIWAYAT, bukan cuma di jendela.
   *
   * Dibedakan dari `kosong` karena artinya sama sekali lain: yang pertama berarti
   * "belum ada yang baru", yang ini berarti rumah sakit ini belum pernah memakai
   * menu Surat Pemesanan di Khanza sama sekali -- dan menyalakan sakelarnya tidak
   * akan pernah mengirim apa pun. Tanpa pembedaan ini keduanya terbaca sama, dan
   * staf menyimpulkan fiturnya rusak. Pelajaran yang sama sudah dibayar di hibah.
   */
  belumPernah?: boolean;
  /**
   * Pesanan terakhir ada, tapi tidak punya satu baris rincian pun.
   *
   * Keadaan KETIGA, dan ia harus dibedakan dari kedua di atas karena ia satu-
   * satunya yang berarti "worker akan MELEWATINYA". Bentuk datanya nyata: di
   * arsip `sik`, sembilan dari sepuluh header begitu. Menampilkan nota kosong
   * di sini akan membuat staf mengira itulah yang akan terkirim.
   */
  tanpaRincian?: boolean;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat sebagai peristiwa audit tersendiri.
 *
 * Alasan yang sama dengan `farmasi_toggle`, `stok_darurat_toggle`,
 * `pengadaan_toggle`, dan `hibah_toggle`: menenggelamkannya sebagai satu nama
 * kunci di dalam `settings_update` membuat perubahan paling berkonsekuensi di
 * bagian ini jadi yang paling sulit ditelusuri.
 *
 * LANTAI aktivasi ditulis di sini, dan hanya saat MENYALAKAN. Saat MEMATIKAN,
 * lantainya sengaja dibiarkan apa adanya: menghapusnya berarti mematikan lalu
 * menyalakan kembali membongkar arsip, dan itu justru urutan tindakan yang paling
 * wajar dilakukan orang yang sedang mencoba-coba.
 */
export async function togglePemesananAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  if (enabled) {
    const hariIni = new Date();
    const iso = `${hariIni.getFullYear()}-${String(hariIni.getMonth() + 1).padStart(2, '0')}-${String(hariIni.getDate()).padStart(2, '0')}`;
    await setSetting('farmasi.pemesanan_sejak', iso);
  }
  await setSetting('farmasi.pemesanan_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'pemesanan_toggle',
    'farmasi.pemesanan_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

export async function toggleTerimaPemesananAction(id: number, terima: boolean): Promise<HasilPemesanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ terimaPemesanan: terima, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_pemesanan',
    String(id),
    `${row.jenis} ${row.chatId} -> ${terima ? 'menerima nota pemesanan' : 'tidak menerima nota pemesanan'}`,
  );
  segarkan();
  return {
    sukses: terima
      ? `"${row.label}" sekarang menerima nota pemesanan.`
      : `"${row.label}" tidak lagi menerima nota pemesanan.`,
  };
}

export async function simpanPemesananAction(
  _prev: HasilPemesanan,
  formData: FormData,
): Promise<HasilPemesanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const template = String(formData.get('template_pemesanan') ?? '');
  const harga = formData.get('pemesanan_harga') === 'on';
  const lookback = Number(formData.get('pemesanan_lookback_hari'));
  const kuota = Number(formData.get('pemesanan_max_per_siklus'));

  if (!template.trim()) {
    return { error: 'Isi pesan tidak boleh kosong — tanpa itu nota terkirim sebagai pesan hampa.' };
  }

  /**
   * Jendela dijepit 1-30 hari, sama seperti pengadaan dan hibah.
   *
   * Batas ATASNYA bukan kerapian: jendela adalah jumlah hari yang dibaca ULANG
   * tiap lima menit, dan ia merentang ke DUA arah -- jadi 30 berarti 61 hari
   * dibaca tiap siklus. Batas BAWAHNYA 1, bukan 0: jendela nol hari cuma memuat
   * hari ini, sehingga satu siklus yang terlewat (worker mati semalam) berarti
   * pesanan kemarin tidak pernah terkirim, selamanya.
   */
  if (!Number.isFinite(lookback) || lookback < 1 || lookback > 30) {
    return { error: 'Jendela pindai harus antara 1 dan 30 hari.' };
  }
  if (!Number.isFinite(kuota) || kuota < 1 || kuota > 50) {
    return { error: 'Kuota per siklus harus antara 1 dan 50.' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3).
  const takDikenal = findUnknownVariables(template, PEMESANAN_TEMPLATE_VARIABLES);
  if (takDikenal.length > 0) {
    return {
      error: `Variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${PEMESANAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
    };
  }

  await setSetting('farmasi.template_pemesanan', template);
  await setSetting('farmasi.pemesanan_harga', harga ? '1' : '0');
  await setSetting('farmasi.pemesanan_lookback_hari', String(Math.floor(lookback)));
  await setSetting('farmasi.pemesanan_max_per_siklus', String(Math.floor(kuota)));
  await logAudit(
    session!.user.username,
    'pemesanan_pesan',
    'farmasi.template_pemesanan',
    `isi pesan diperbarui; harga per barang: ${harga ? 'ikut' : 'tidak'}; jendela ${Math.floor(lookback)} hari; kuota ${Math.floor(kuota)}`,
  );
  segarkan();
  return { sukses: 'Pengaturan surat pemesanan tersimpan.' };
}

/**
 * Pratinjau atas pesanan SUNGGUHAN yang terakhir masuk.
 *
 * Memakai `susunVarsPemesanan()` dan `renderTemplate()` yang SAMA dipakai worker.
 * Dibaca dari nilai TERSIMPAN, bukan dari isi kotak yang sedang diketik --
 * pilihan yang sama dengan tombol "Kirim peringatan uji" di `/pengaturan`: yang
 * perlu dibuktikan staf adalah apa yang akan DIKIRIM WORKER, dan worker membaca
 * `app_setting`.
 */
export async function pratinjauPemesananAction(
  _prev: HasilPratinjauPemesanan,
  _formData: FormData,
): Promise<HasilPratinjauPemesanan> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const [template, harga, lookback] = await Promise.all([
    getSetting('farmasi.template_pemesanan', ''),
    getSettingBool('farmasi.pemesanan_harga', true),
    getSettingNumber('farmasi.pemesanan_lookback_hari', 7),
  ]);

  if (!template?.trim()) return { error: 'Isi pesan masih kosong. Simpan isi pesannya lebih dulu.' };

  try {
    /**
     * Lantai aktivasi SENGAJA dilewati di pratinjau (`sejak` = null): yang ingin
     * dibuktikan staf adalah bentuk pesannya, dan lantai yang baru ditulis hari
     * ini akan membuat jendelanya kosong sepanjang hari pertama.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const header = await pollPemesananJendela(jendela.dari, jendela.sampai);
    let terakhir = header[header.length - 1];

    /**
     * Kalau jendelanya kosong, dicoba SELURUH riwayat -- dan hasilnya dibedakan.
     *
     * `surat_pemesanan_medis` KOSONG di database produksi mesin ini, jadi "tidak
     * ada di jendela" dan "belum pernah ada sama sekali" akan terlihat persis
     * sama tanpa pembedaan ini -- dan yang kedua berarti menyalakan sakelarnya
     * tidak akan pernah mengirim apa pun.
     *
     * Rentangnya `2000-01-01`..`2099-12-31`, dan prefiksnya dua digit tahun
     * (`SPM00...` sampai `SPM99...`) -- jadi ia benar-benar mencakup seluruh
     * nilai yang mungkin ada di kolomnya.
     */
    if (!terakhir) {
      const seluruh = await pollPemesananJendela('2000-01-01', '2099-12-31');
      if (seluruh.length === 0) return { belumPernah: true };
      terakhir = seluruh[seluruh.length - 1];
      if (!terakhir) return { belumPernah: true };
    }

    const detail = await ambilDetailPemesanan([terakhir.no_pemesanan], harga);

    /**
     * Pesanan tanpa rincian dilaporkan sebagai keadaannya sendiri, bukan
     * dirender jadi nota kosong.
     *
     * Worker MELEWATI pesanan semacam itu (lihat `pemesananRunner.ts`), jadi
     * menampilkan notanya di sini akan menunjukkan pesan yang tidak akan pernah
     * terkirim -- persis kebalikan dari alasan pratinjau ini ada.
     */
    if (detail.length === 0) {
      return { tanpaRincian: true, noPemesanan: terakhir.no_pemesanan };
    }

    const bagian = susunVarsPemesanan(
      terakhir,
      kelompokkanDetailPemesanan(detail).get(terakhir.no_pemesanan) ?? [],
      new Date(),
    );

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
      noPemesanan: terakhir.no_pemesanan,
      jumlahItem: detail.length,
      jumlahPesan: bagian.length,
    };
  } catch (err) {
    return { error: `Gagal membaca data pemesanan: ${err instanceof Error ? err.message : String(err)}` };
  }
}
