'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, logAudit, setSetting, getSetting, getSettingBool, getSettingNumber } from '@/models';
import {
  findUnknownVariables,
  PENJUALAN_TEMPLATE_VARIABLES,
  REKAP_PENJUALAN_TEMPLATE_VARIABLES,
  renderTemplate,
} from '@/core/template';
import { hitungJendelaPindai } from '@/core/jendelaPindai';
import { kelompokkanDetailJual } from '@/core/penjualan';
import { bacaJamRekap, hariRekap, tulisJamRekap } from '@/core/penjualanRekap';
import { susunRekapHarian } from '@/worker/penjualanRekapRunner';
import {
  pollPenjualanJendela,
  ambilRingkasPenjualan,
  ambilPenjualanTerpilih,
  ambilDetailPenjualan,
} from '@/khanza/penjualan';
import { susunVarsPenjualan, susunVarsPenjualanHapus } from '@/worker/penjualanRunner';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk bagian PENJUALAN di `/farmasi`.
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan `pengadaanActions.ts`
 * dari `actions.ts`: batasnya bukan panjang melainkan pertanyaan yang dijawab.
 */

export interface HasilPenjualan {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjauPenjualan {
  error?: string;
  teks?: string;
  /** Pesan pembatalan atas nota yang sama -- dirender bersamaan, lihat di bawah. */
  teksHapus?: string;
  noNota?: string;
  jumlahItem?: number;
  /** >1 berarti daftarnya dipecah karena panjang. */
  jumlahPesan?: number;
  /** Tidak ada nota sama sekali di jendela -- bukan galat, tapi harus dikatakan. */
  kosong?: boolean;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat sebagai peristiwa audit tersendiri.
 *
 * LANTAI aktivasi ditulis di sini, dan hanya saat MENYALAKAN. Di fitur ini
 * lantainya menahan DUA hal sekaligus, dan yang kedua tidak dipunyai pemicu
 * farmasi lain: nota lama tidak dikabarkan, DAN penghapusan nota lama juga
 * tidak -- karena nota yang tidak pernah masuk buku pantau tidak pernah bisa
 * dilaporkan hilang. Tanpa itu, menyalakan sakelar pada apotek yang baru saja
 * membatalkan beberapa nota akan mengirim rentetan pembatalan atas transaksi
 * yang tidak pernah diberitakan.
 *
 * Saat MEMATIKAN, lantainya sengaja dibiarkan apa adanya: menghapusnya berarti
 * mematikan lalu menyalakan kembali membongkar arsip, dan itu justru urutan
 * tindakan yang paling wajar dilakukan orang yang sedang mencoba-coba.
 */
export async function togglePenjualanAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  if (enabled) {
    const hariIni = new Date();
    const iso = `${hariIni.getFullYear()}-${String(hariIni.getMonth() + 1).padStart(2, '0')}-${String(hariIni.getDate()).padStart(2, '0')}`;
    await setSetting('farmasi.penjualan_sejak', iso);
  }
  await setSetting('farmasi.penjualan_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'penjualan_toggle',
    'farmasi.penjualan_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

export async function toggleTerimaPenjualanAction(id: number, terima: boolean): Promise<HasilPenjualan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ terimaPenjualan: terima, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_penjualan',
    String(id),
    `${row.jenis} ${row.chatId} -> ${terima ? 'menerima nota penjualan' : 'tidak menerima nota penjualan'}`,
  );
  segarkan();
  return {
    sukses: terima
      ? `"${row.label}" sekarang menerima nota penjualan.`
      : `"${row.label}" tidak lagi menerima nota penjualan.`,
  };
}

export async function simpanPenjualanAction(
  _prev: HasilPenjualan,
  formData: FormData,
): Promise<HasilPenjualan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const template = String(formData.get('template_penjualan') ?? '');
  const templateHapus = String(formData.get('template_penjualan_hapus') ?? '');
  const harga = formData.get('penjualan_harga') === 'on';
  const kabarHapus = formData.get('penjualan_hapus_kabar') === 'on';
  const lookback = Number(formData.get('penjualan_lookback_hari'));
  const kuota = Number(formData.get('penjualan_max_per_siklus'));

  if (!template.trim()) {
    return { error: 'Isi pesan tidak boleh kosong — tanpa itu nota terkirim sebagai pesan hampa.' };
  }

  /**
   * Isi pesan pembatalan wajib terisi SELAMA kabarnya menyala.
   *
   * Dikosongkan sementara sakelarnya menyala, pembatalannya tetap dienqueue
   * sebagai pesan hampa -- dan lebih buruk lagi, notanya sudah ditandai
   * `hapus_at` sehingga ia tidak akan pernah dicoba lagi. Itu satu-satunya
   * bentuk kegagalan di halaman ini yang menghanguskan kabarnya secara permanen.
   */
  if (kabarHapus && !templateHapus.trim()) {
    return {
      error:
        'Isi pesan pembatalan tidak boleh kosong selama kabar penghapusan menyala — matikan kabarnya, atau isi pesannya.',
    };
  }

  /**
   * Jendela dijepit 1-30 hari.
   *
   * Batas ATASNYA bukan kerapian: jendela adalah jumlah hari yang dibaca ULANG
   * tiap lima menit dan ia merentang ke DUA arah, jadi 30 berarti 61 hari nota
   * dibaca tiap siklus -- pada laju apotek ini (16-46 nota sehari) itu sekitar
   * dua ribu baris, sudah mendekati batas jendelanya sendiri. Batas BAWAHNYA 1,
   * bukan 0: jendela nol hari cuma memuat hari ini, sehingga satu siklus yang
   * terlewat (worker mati semalam) berarti nota kemarin tidak pernah terkirim.
   *
   * Jendela ini SEKALIGUS menentukan berapa lama sebuah nota masih dipantau
   * untuk penghapusan -- itu dikatakan di layar, karena tidak bisa ditebak dari
   * namanya.
   */
  if (!Number.isFinite(lookback) || lookback < 1 || lookback > 30) {
    return { error: 'Jendela pindai harus antara 1 dan 30 hari.' };
  }
  if (!Number.isFinite(kuota) || kuota < 1 || kuota > 50) {
    return { error: 'Kuota per siklus harus antara 1 dan 50.' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3).
  for (const [nama, isi] of [
    ['Isi pesan', template],
    ['Isi pesan pembatalan', templateHapus],
  ] as const) {
    if (!isi.trim()) continue;
    const takDikenal = findUnknownVariables(isi, PENJUALAN_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `${nama}: variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${PENJUALAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
      };
    }
  }

  await setSetting('farmasi.template_penjualan', template);
  await setSetting('farmasi.template_penjualan_hapus', templateHapus);
  await setSetting('farmasi.penjualan_harga', harga ? '1' : '0');
  await setSetting('farmasi.penjualan_hapus_kabar', kabarHapus ? '1' : '0');
  await setSetting('farmasi.penjualan_lookback_hari', String(Math.floor(lookback)));
  await setSetting('farmasi.penjualan_max_per_siklus', String(Math.floor(kuota)));
  await logAudit(
    session!.user.username,
    'penjualan_pesan',
    'farmasi.template_penjualan',
    `isi pesan diperbarui; harga: ${harga ? 'ikut' : 'tidak'}; kabar hapus: ${kabarHapus ? 'ya' : 'tidak'}; jendela ${Math.floor(lookback)} hari; kuota ${Math.floor(kuota)}`,
  );
  segarkan();
  return { sukses: 'Pengaturan penjualan tersimpan.' };
}

/**
 * Pratinjau atas nota SUNGGUHAN yang terakhir masuk.
 *
 * Memakai `susunVarsPenjualan()` dan `renderTemplate()` yang SAMA dipakai worker.
 * Dibaca dari nilai TERSIMPAN, bukan dari isi kotak yang sedang diketik --
 * pilihan yang sama dengan tombol "Kirim peringatan uji" di `/pengaturan`: yang
 * perlu dibuktikan staf adalah apa yang akan DIKIRIM WORKER, dan worker membaca
 * `app_setting`.
 *
 * KEDUA pesan dirender sekaligus, dan itu bukan kelengkapan yang berlebihan:
 * pesan pembatalan tidak punya cara lain untuk dilihat sebelum dipakai. Ia baru
 * muncul saat sebuah nota benar-benar dihapus -- kejadian yang terukur 22 kali
 * dalam dua setengah tahun -- jadi menunggu kejadian aslinya berarti bentuk
 * pesannya pertama kali terlihat justru di grup, saat sudah terlambat.
 */
export async function pratinjauPenjualanAction(
  _prev: HasilPratinjauPenjualan,
  _formData: FormData,
): Promise<HasilPratinjauPenjualan> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const [template, templateHapus, harga, lookback] = await Promise.all([
    getSetting('farmasi.template_penjualan', ''),
    getSetting('farmasi.template_penjualan_hapus', ''),
    getSettingBool('farmasi.penjualan_harga', true),
    getSettingNumber('farmasi.penjualan_lookback_hari', 7),
  ]);

  if (!template?.trim()) return { error: 'Isi pesan masih kosong. Simpan isi pesannya lebih dulu.' };

  try {
    /**
     * Lantai aktivasi SENGAJA dilewati di pratinjau (`sejak` = null). Yang ingin
     * dibuktikan staf adalah bentuk pesannya, dan lantai yang baru ditulis hari
     * ini membuat jendelanya kosong sepanjang hari pertama -- sehingga pratinjau
     * menjawab "belum ada nota" pada apotek yang jelas berjualan hari itu, dan
     * staf menyimpulkan query-nya rusak.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const header = await pollPenjualanJendela(jendela.dari, jendela.sampai);
    const terakhir = header[header.length - 1];
    if (!terakhir) return { kosong: true };

    const nomor = [terakhir.nota_jual];
    const [ringkas, terpilih, detail] = await Promise.all([
      ambilRingkasPenjualan(nomor),
      ambilPenjualanTerpilih(nomor),
      ambilDetailPenjualan(nomor, harga),
    ]);

    const sekarang = new Date();
    const bagian = susunVarsPenjualan(
      terakhir,
      kelompokkanDetailJual(detail).get(terakhir.nota_jual) ?? [],
      {
        jmlItem: ringkas[0]?.jml_item ?? null,
        subtotal: ringkas[0]?.subtotal ?? null,
        ppn: terpilih[0]?.ppn ?? null,
        ongkir: terpilih[0]?.ongkir ?? null,
        keterangan: terpilih[0]?.keterangan ?? null,
      },
      sekarang,
    );

    /**
     * Identitas RS disisipkan sebagai DASAR, persis seperti `enqueueMessage`.
     * Tanpa ini `{nama_rs}` tampil kosong di pratinjau padahal terisi saat
     * benar-benar dikirim, dan staf yang melihatnya wajar menyimpulkan
     * variabelnya tidak jalan lalu membuangnya dari template.
     */
    const identitas = await getHospitalIdentity();
    const dasar = {
      nama_rs: identitas.namaRs,
      alamat_rs: identitas.alamatRs,
      kontak_rs: identitas.kontakRs,
    };
    const teks = bagian
      .map((v) => renderTemplate(template, { ...dasar, ...v }))
      .join('\n\n──────────\n\n');

    return {
      teks,
      teksHapus: templateHapus?.trim()
        ? renderTemplate(templateHapus, { ...dasar, ...susunVarsPenjualanHapus(terakhir.nota_jual, sekarang) })
        : undefined,
      noNota: terakhir.nota_jual,
      jumlahItem: ringkas[0]?.jml_item ?? detail.length,
      jumlahPesan: bagian.length,
    };
  } catch (err) {
    return { error: `Gagal membaca data penjualan: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ==========================================================================
 * REKAP HARIAN (migrations/041)
 *
 * Aksinya di berkas yang SAMA dengan nota per-nota: keduanya dikelola di tab
 * yang sama, memakai daftar tujuan yang sama (`terima_penjualan`), dan menyentuh
 * tabel Khanza yang sama. Yang berbeda cuma kelas pemicunya, dan itu tinggal di
 * runner.
 * ========================================================================== */

export interface HasilPratinjauRekap {
  error?: string;
  teks?: string;
  /** Tanggal yang dibaca -- WAJIB ditampilkan, lihat pratinjaunya di bawah. */
  tanggal?: string;
  jumlahNota?: number;
  /**
   * Hari itu tidak ada penjualan DAN pesan kosongnya sengaja dibiarkan diam.
   * Bukan galat, tapi harus dikatakan -- kalau tidak, pratinjau yang tidak
   * menampilkan apa pun terbaca sebagai fitur yang rusak.
   */
  diam?: boolean;
}

/**
 * Sakelar rekap, dicatat sebagai peristiwa audit tersendiri.
 *
 * TANPA lantai aktivasi, dan itu bukan kelalaian: lantai ada untuk menahan
 * ARSIP: pemicu kelas pindai membaca jendela berhari-hari ke belakang, jadi
 * menyalakannya tanpa lantai membongkar seluruh isi jendela sekaligus. Rekap
 * harian hanya pernah membaca SATU hari -- hari yang ditentukan offset saat ia
 * jatuh tempo -- sehingga tidak ada arsip yang bisa terbongkar. Menambahkan
 * lantai di sini cuma akan jadi pagar yang tidak menahan apa pun, dan pagar
 * seperti itu mengajari pembacanya bahwa pagar boleh dekoratif.
 */
export async function toggleRekapPenjualanAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('farmasi.penjualan_rekap_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'penjualan_rekap_toggle',
    'farmasi.penjualan_rekap_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

export async function simpanRekapPenjualanAction(
  _prev: HasilPenjualan,
  formData: FormData,
): Promise<HasilPenjualan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const jamRaw = String(formData.get('penjualan_rekap_jam') ?? '');
  const offset = Number(formData.get('penjualan_rekap_offset_hari'));
  const template = String(formData.get('template_penjualan_rekap') ?? '');
  const templateKosong = String(formData.get('template_penjualan_rekap_kosong') ?? '');

  /**
   * Jam ditolak di DEPAN orang yang bisa memperbaikinya seketika.
   *
   * Worker sengaja lebih pemaaf (jatuh ke jam bawaan berikut `warn`), dan
   * pembagian itu disengaja: di sini ada manusia yang menunggu jawaban, di sana
   * tidak ada siapa-siapa pukul sembilan malam. Pola yang sama dengan
   * `bacaHariSebelum()` pada pengingat kontrol.
   */
  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    return { error: 'Jam kirim harus berbentuk HH:MM, mis. 21:00.' };
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
    ['Isi pesan saat tidak ada penjualan', templateKosong],
  ] as const) {
    if (!isi.trim()) continue;
    const takDikenal = findUnknownVariables(isi, REKAP_PENJUALAN_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `${nama}: variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${REKAP_PENJUALAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
      };
    }
  }

  await setSetting('farmasi.penjualan_rekap_jam', tulisJamRekap(jam));
  await setSetting('farmasi.penjualan_rekap_offset_hari', String(Math.floor(offset)));
  await setSetting('farmasi.template_penjualan_rekap', template);
  await setSetting('farmasi.template_penjualan_rekap_kosong', templateKosong);
  await logAudit(
    session!.user.username,
    'penjualan_rekap_pesan',
    'farmasi.template_penjualan_rekap',
    `jam ${tulisJamRekap(jam)}; offset ${Math.floor(offset)} hari; pesan saat kosong: ${templateKosong.trim() ? 'diisi' : 'diam'}`,
  );
  segarkan();
  return { sukses: 'Pengaturan rekap penjualan tersimpan.' };
}

/**
 * Pratinjau rekap atas hari yang BENAR-BENAR akan dibaca worker.
 *
 * Memakai `susunRekapHarian()` yang SAMA dipakai worker, dan membaca nilai
 * TERSIMPAN -- bukan isi kotak yang sedang diketik. Pilihan yang sama dengan
 * pratinjau nota di atasnya: yang perlu dibuktikan staf adalah apa yang akan
 * dikirim WORKER, dan worker membaca `app_setting`.
 *
 * Tanggal yang dibaca WAJIB ikut ditampilkan. Tanpa itu, rekap yang isinya
 * mengejutkan (nyaris kosong pada pukul sembilan pagi karena offsetnya 0) tidak
 * bisa dibedakan dari query yang salah -- dan yang pertama justru keadaan yang
 * benar, cuma setelan offsetnya yang belum cocok dengan jam kirimnya.
 */
export async function pratinjauRekapPenjualanAction(
  _prev: HasilPratinjauRekap,
  _formData: FormData,
): Promise<HasilPratinjauRekap> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const [template, offset] = await Promise.all([
    getSetting('farmasi.template_penjualan_rekap', ''),
    getSettingNumber('farmasi.penjualan_rekap_offset_hari', 0),
  ]);
  if (!template?.trim()) return { error: 'Isi pesan rekap masih kosong. Simpan isi pesannya lebih dulu.' };

  const sekarang = new Date();
  const tanggal = hariRekap(sekarang, offset);

  try {
    const hasil = await susunRekapHarian(tanggal, sekarang);
    if (hasil.body === null) {
      return { tanggal, jumlahNota: 0, diam: true };
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

    return { teks, tanggal, jumlahNota: hasil.ringkas.jmlNota };
  } catch (err) {
    return { error: `Gagal membaca rekap penjualan: ${err instanceof Error ? err.message : String(err)}` };
  }
}
