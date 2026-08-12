'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, setSetting, getSetting, getSettingNumber } from '@/models';
import { findUnknownVariables, REKAP_RESEP_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { bacaJamRekap, hariRekap, tulisJamRekap } from '@/core/rekapJadwal';
import { susunRekapResepHarian } from '@/worker/resepRekapRunner';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk bagian REKAP HARIAN RESEP di `/farmasi?tab=resep` (migrations/042).
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan `penjualanActions.ts`
 * dan `pengadaanActions.ts` dari `actions.ts`: batasnya bukan panjang melainkan
 * pertanyaan yang dijawab. `actions.ts` mengurus tujuan pengiriman, sakelar utama,
 * isi pesan per kejadian, dan balasan stok -- empat hal yang kebetulan tidak punya
 * berkasnya sendiri. Rekap harian adalah kelas pemicu yang BERBEDA (waktu, bukan
 * sisip) dengan sakelarnya sendiri, dan menaruhnya di sana akan menyembunyikannya
 * di antara hal-hal yang tidak berhubungan.
 */

export interface HasilRekapResep {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjauRekapResep {
  error?: string;
  teks?: string;
  /** Tanggal yang dibaca -- WAJIB ditampilkan, lihat pratinjaunya di bawah. */
  tanggal?: string;
  jumlahResep?: number;
  /**
   * Hari itu tidak ada resep DAN pesan kosongnya sengaja dibiarkan diam.
   * Bukan galat, tapi harus dikatakan -- kalau tidak, pratinjau yang tidak
   * menampilkan apa pun terbaca sebagai fitur yang rusak. Dan di sini keadaan
   * itu jauh dari langka: terukur, hari Minggu nol resep pada seluruh 90 hari.
   */
  diam?: boolean;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar rekap, dicatat sebagai peristiwa audit tersendiri.
 *
 * BERDIRI SENDIRI dari `toggleFarmasiAction` (`farmasi.enabled`), dan itu bukan
 * kelalaian melainkan inti fiturnya: sakelar itu menyalakan pesan yang memuat
 * NAMA PASIEN, NOMOR REKAM MEDIS, dan POLI ke sebuah grup WhatsApp. Menjadikan
 * rekap ini bertingkat di bawahnya berarti memaksa RS mengambil keputusan privasi
 * terberat di halaman ini hanya untuk mendapatkan satu pesan berisi ANGKA.
 *
 * TANPA lantai aktivasi, dengan alasan yang sama seperti rekap penjualan: lantai
 * ada untuk menahan ARSIP, dan rekap harian hanya pernah membaca SATU hari --
 * hari yang ditentukan offset saat ia jatuh tempo. Pagar yang tidak menahan apa
 * pun mengajari pembacanya bahwa pagar boleh dekoratif.
 */
export async function toggleRekapResepAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('farmasi.resep_rekap_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'resep_rekap_toggle',
    'farmasi.resep_rekap_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

export async function simpanRekapResepAction(
  _prev: HasilRekapResep,
  formData: FormData,
): Promise<HasilRekapResep> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const jamRaw = String(formData.get('resep_rekap_jam') ?? '');
  const offset = Number(formData.get('resep_rekap_offset_hari'));
  const template = String(formData.get('template_resep_rekap') ?? '');
  const templateKosong = String(formData.get('template_resep_rekap_kosong') ?? '');

  /**
   * Jam ditolak di DEPAN orang yang bisa memperbaikinya seketika.
   *
   * Worker sengaja lebih pemaaf (jatuh ke jam bawaan berikut `warn`), dan
   * pembagian itu disengaja: di sini ada manusia yang menunggu jawaban, di sana
   * tidak ada siapa-siapa pukul sepuluh malam. Pola yang sama dengan
   * `bacaHariSebelum()` pada pengingat kontrol.
   */
  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    return { error: 'Jam kirim harus berbentuk HH:MM, mis. 22:00.' };
  }

  /**
   * Offset dijepit 0-7. Batas atasnya bukan kerapian: rekap yang menoleh lebih
   * dari sepekan ke belakang bukan lagi rekap harian melainkan laporan, dan
   * angka besar yang tidak sengaja terketik menghasilkan rekap yang isinya benar
   * tapi menyebut hari yang tidak dipikirkan siapa pun.
   */
  if (!Number.isFinite(offset) || offset < 0 || offset > 7) {
    return { error: 'Hari yang direkap harus antara 0 (hari ini) dan 7.' };
  }

  if (!template.trim()) {
    return { error: 'Isi pesan rekap tidak boleh kosong — tanpa itu rekap terkirim sebagai pesan hampa.' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3).
  for (const [nama, isi] of [
    ['Isi pesan rekap', template],
    ['Isi pesan saat tidak ada resep', templateKosong],
  ] as const) {
    if (!isi.trim()) continue;
    const takDikenal = findUnknownVariables(isi, REKAP_RESEP_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `${nama}: variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${REKAP_RESEP_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
      };
    }
  }

  await setSetting('farmasi.resep_rekap_jam', tulisJamRekap(jam));
  await setSetting('farmasi.resep_rekap_offset_hari', String(Math.floor(offset)));
  await setSetting('farmasi.template_resep_rekap', template);
  await setSetting('farmasi.template_resep_rekap_kosong', templateKosong);
  await logAudit(
    session!.user.username,
    'resep_rekap_pesan',
    'farmasi.template_resep_rekap',
    `jam ${tulisJamRekap(jam)}; offset ${Math.floor(offset)} hari; pesan saat kosong: ${templateKosong.trim() ? 'diisi' : 'diam'}`,
  );
  segarkan();
  return { sukses: 'Pengaturan rekap resep tersimpan.' };
}

/**
 * Pratinjau rekap atas hari yang BENAR-BENAR akan dibaca worker.
 *
 * Memakai `susunRekapResepHarian()` yang SAMA dipakai worker, dan membaca nilai
 * TERSIMPAN -- bukan isi kotak yang sedang diketik. Pilihan yang sama dengan
 * pratinjau rekap penjualan: yang perlu dibuktikan staf adalah apa yang akan
 * dikirim WORKER, dan worker membaca `app_setting`.
 *
 * Tanggal yang dibaca WAJIB ikut ditampilkan. Tanpa itu, rekap yang isinya
 * mengejutkan (nol resep karena kebetulan hari Minggu, atau nyaris kosong pada
 * pukul sembilan pagi karena offsetnya 0) tidak bisa dibedakan dari query yang
 * salah -- dan keduanya justru keadaan yang benar.
 */
export async function pratinjauRekapResepAction(
  _prev: HasilPratinjauRekapResep,
  _formData: FormData,
): Promise<HasilPratinjauRekapResep> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const [template, offset] = await Promise.all([
    getSetting('farmasi.template_resep_rekap', ''),
    getSettingNumber('farmasi.resep_rekap_offset_hari', 0),
  ]);
  if (!template?.trim()) return { error: 'Isi pesan rekap masih kosong. Simpan isi pesannya lebih dulu.' };

  const sekarang = new Date();
  const tanggal = hariRekap(sekarang, offset);

  try {
    const hasil = await susunRekapResepHarian(tanggal, sekarang);
    if (hasil.body === null) {
      return { tanggal, jumlahResep: 0, diam: true };
    }

    /**
     * Identitas RS disisipkan sebagai DASAR, persis seperti `enqueueMessage`.
     * Tanpa ini `{nama_rs}` tampil kosong di pratinjau padahal terisi saat
     * benar-benar dikirim, dan staf yang melihatnya wajar menyimpulkan
     * variabelnya tidak jalan lalu membuangnya dari template.
     */
    const identitas = await getHospitalIdentity();
    const teks = renderTemplate(hasil.body, {
      nama_rs: identitas.namaRs,
      alamat_rs: identitas.alamatRs,
      kontak_rs: identitas.kontakRs,
      ...hasil.vars,
    });

    return { teks, tanggal, jumlahResep: hasil.ringkas.jmlResep };
  } catch (err) {
    return { error: `Gagal membaca rekap resep: ${err instanceof Error ? err.message : String(err)}` };
  }
}
