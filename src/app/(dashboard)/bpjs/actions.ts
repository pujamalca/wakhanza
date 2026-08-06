'use server';

import { revalidatePath } from 'next/cache';
import { BpjsTarget, WaSession, logAudit, setSetting, getSetting } from '@/models';
import {
  findUnknownVariables,
  BPJS_BATAL_TEMPLATE_VARIABLES,
  BPJS_KONTROL_TEMPLATE_VARIABLES,
} from '@/core/template';
import { bacaHariSebelum, tulisHariSebelum, MAX_HARI_SEBELUM } from '@/core/bpjs';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { runBpjsKontrolJob } from '@/worker/bpjsRunner';
import { mintaSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

const VARS_BATAL_HINT = BPJS_BATAL_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');
const VARS_KONTROL_HINT = BPJS_KONTROL_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function segarkan(): void {
  revalidatePath('/bpjs');
}

// ---------------------------------------------------------------------------
// Sakelar
// ---------------------------------------------------------------------------

/**
 * Sakelar utama halaman, dicatat `audit_log` sebagai peristiwanya sendiri --
 * pola yang sama dengan `farmasi_toggle` dan `auto_reply_toggle`, dan karena
 * alasan yang sama: inilah momen kanal baru mulai mengirim WhatsApp atas
 * inisiatifnya sendiri. Menenggelamkannya sebagai satu nama kunci di dalam
 * `settings_update` membuat perubahan paling berkonsekuensi di halaman ini jadi
 * yang paling sulit ditelusuri.
 */
export async function toggleBpjsAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('bpjs.enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'bpjs_toggle', 'bpjs.enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

export async function toggleBatalAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('bpjs.batal_enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'bpjs_batal_toggle', 'bpjs.batal_enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

/**
 * Sakelar pengingat kontrol, dicatat TERPISAH dari sakelar pembatalan.
 *
 * Keduanya di halaman yang sama tapi menuju orang yang berbeda: pembatalan ke
 * loket, pengingat ke PASIEN. Satu baris audit yang tidak membedakannya membuat
 * "kapan rumah sakit mulai mengirim pesan ke pasien lewat kanal BPJS" tidak bisa
 * dijawab dari audit_log sama sekali.
 */
export async function toggleKontrolAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('bpjs.kontrol_enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'bpjs_kontrol_toggle', 'bpjs.kontrol_enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

// ---------------------------------------------------------------------------
// Tujuan
// ---------------------------------------------------------------------------

export async function tambahTargetAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const jenis: JenisTarget = formData.get('jenis') === 'personal' ? 'personal' : 'grup';
  const label = String(formData.get('label') ?? '').trim();
  const nilai = String(formData.get('nilai') ?? '');

  if (!label) return { error: 'Beri nama tujuan ini, mis. "Grup Pendaftaran" — supaya bisa dikenali di daftar.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  const hasil = parseTarget(jenis, nilai);
  if (!hasil.ok) return { error: hasil.error };

  if (await BpjsTarget.findOne({ where: { chatId: hasil.chatId } })) {
    return { error: 'Tujuan itu sudah ada di daftar. Menambahkannya dua kali membuat tiap kejadian terkirim dua kali.' };
  }

  const dibuat = await BpjsTarget.create({
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await logAudit(session!.user.username, 'bpjs_target_create', String(dibuat.id), `${hasil.jenis} ${hasil.chatId} (${label})`);
  segarkan();
  return {
    sukses: `Tujuan "${label}" ditambahkan. Belum menerima apa pun sampai salah satu centang di barisnya dinyalakan — kirim pesan uji dulu untuk memastikan alamatnya benar.`,
  };
}

export async function ubahTargetAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await BpjsTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const label = String(formData.get('label') ?? '').trim();
  if (!label) return { error: 'Nama tujuan wajib diisi.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  await row.update({ label, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'bpjs_target_update', String(id), label);
  segarkan();
  return { sukses: 'Nama tujuan diperbarui.' };
}

/**
 * Alamatnya sengaja TIDAK bisa disunting, hanya namanya -- alasan yang sama
 * seperti di /farmasi: mengubah alamat di tempat membuat riwayat `outbox` yang
 * sudah ada menunjuk baris tujuan yang kini berarti grup lain, sehingga "pesan
 * ini dulu dikirim ke mana" berubah jawabannya secara surut.
 */
export async function hapusTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await BpjsTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await logAudit(session!.user.username, 'bpjs_target_delete', String(id), `${row.jenis} ${row.chatId} (${row.label})`);
  await row.destroy();
  segarkan();
  return { sukses: `Tujuan "${row.label}" dihapus.` };
}

export async function toggleTargetAction(id: number, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await BpjsTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ isActive: aktif, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'bpjs_target_toggle', String(id), aktif ? 'aktif' : 'nonaktif');
  segarkan();
  return { sukses: aktif ? `"${row.label}" diaktifkan.` : `"${row.label}" dinonaktifkan.` };
}

/**
 * Kedua centang isi, dicatat sebagai peristiwa audit yang MENYEBUT centang mana.
 *
 * Bukan kerapian: `terima_batal` berarti data pasien mulai mengalir ke sebuah
 * grup, sementara `terima_kontrol` berarti salinan pesan pasien ikut ke sana.
 * Keduanya berkonsekuensi berbeda, dan satu baris audit bertuliskan
 * "bpjs_target_toggle" saja tidak bisa membedakannya belakangan.
 */
export async function toggleTerimaAction(
  id: number,
  kolom: 'terimaBatal' | 'terimaKontrol',
  nilai: boolean,
): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await BpjsTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ [kolom]: nilai, updatedBy: session!.user.username, updatedAt: new Date() });
  const namaKolom = kolom === 'terimaBatal' ? 'pembatalan' : 'salinan pengingat kontrol';
  await logAudit(
    session!.user.username,
    kolom === 'terimaBatal' ? 'bpjs_target_terima_batal' : 'bpjs_target_terima_kontrol',
    String(id),
    `${row.jenis} ${row.chatId} -> ${nilai ? 'menerima' : 'tidak menerima'} ${namaKolom}`,
  );
  segarkan();
  return {
    sukses: nilai ? `"${row.label}" sekarang menerima ${namaKolom}.` : `"${row.label}" tidak lagi menerima ${namaKolom}.`,
  };
}

export async function mintaSyncGrupAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await mintaSyncGrup(session!.user.username);
  segarkan();
  revalidatePath('/farmasi');
  revalidatePath('/pesan-masuk');
  return hasil;
}

/**
 * Tujuan yang tidak pernah dicoba sama saja dengan tidak ada -- kode grup yang
 * SALAH tetap diterima WhatsApp tanpa galat apa pun (dibuktikan langsung saat
 * notifikasi farmasi dibangun). Satu-satunya cara membuktikan sebuah alamat
 * benar adalah ada manusia yang melihat pesannya muncul.
 *
 * Memakai `FARMASI_UJI`, bukan kode pemicu BPJS-nya sendiri: baris uji dengan
 * kode sungguhan akan tercampur di Antrean/Ringkasan lalu ikut terhitung sebagai
 * pengiriman pemicu itu -- alasan yang sama persis dengan tombol uji di
 * /template. Kodenya sudah terdaftar melewati jam tenang, jadi staf yang menekan
 * tombol ini pukul 22.00 tetap melihat hasilnya saat itu juga.
 */
export async function kirimUjiAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await BpjsTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi pesan uji tidak akan terkirim. Buka halaman Koneksi dulu.' };
  }

  const body =
    'Pesan uji dari sistem notifikasi BPJS {nama_rs}.\n\n' +
    'Kalau pesan ini terbaca, berarti tujuan ini sudah benar dan siap menerima ' +
    'pemberitahuan pembatalan Mobile JKN serta salinan pengingat kontrol.';

  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);
  await enqueueMessage(
    {
      // Stempel waktu ikut supaya tombolnya bisa ditekan BERULANG -- staf yang
      // sedang membetulkan kode grup harus bisa mencoba lagi.
      idempotencyKey: buildIdempotencyKey('FARMASI_UJI', row.chatId, new Date().toISOString()),
      noRkmMedis: null,
      rawPhone: null,
      chatId: row.chatId,
      eventAt: new Date(),
      vars: {},
    },
    ctx,
  );

  await logAudit(session!.user.username, 'bpjs_kirim_uji', String(id), row.chatId);
  segarkan();
  return {
    sukses: `Pesan uji dimasukkan ke antrean untuk "${row.label}". Biasanya sampai dalam beberapa detik — periksa halaman Antrean bila tidak.`,
  };
}

// ---------------------------------------------------------------------------
// Tab: pembatalan Mobile JKN
// ---------------------------------------------------------------------------

const KUNCI_BATAL = ['bpjs.template_batal', 'bpjs.template_batal_generic', 'bpjs.template_batal_rekap'] as const;

export async function simpanBatalAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const teks: Record<string, string> = {};
  for (const kunci of KUNCI_BATAL) {
    const body = String(formData.get(kunci) ?? '').trim();
    if (!body) return { error: 'Semua isi pesan wajib diisi.' };

    const takDikenal = findUnknownVariables(body, BPJS_BATAL_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `Variabel tidak dikenal: ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${VARS_BATAL_HINT}`,
      };
    }
    teks[kunci] = body;
  }

  const maxPerCycle = Number(formData.get('bpjs.batal_max_per_cycle') ?? 20);
  if (!Number.isInteger(maxPerCycle) || maxPerCycle < 1 || maxPerCycle > 200) {
    return { error: 'Ambang rekap harus bilangan bulat 1-200.' };
  }

  for (const [kunci, body] of Object.entries(teks)) await setSetting(kunci, body);
  await setSetting('bpjs.batal_max_per_cycle', String(maxPerCycle));

  await logAudit(session!.user.username, 'bpjs_batal_update', 'app_setting', KUNCI_BATAL.join(','));
  segarkan();
  return { sukses: 'Pengaturan pembatalan disimpan.' };
}

// ---------------------------------------------------------------------------
// Tab: pengingat surat kontrol
// ---------------------------------------------------------------------------

export async function simpanKontrolAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const rawHari = String(formData.get('bpjs.kontrol_hari_sebelum') ?? '').trim();
  const hari = bacaHariSebelum(rawHari);
  /**
   * Ditolak SAAT DISIMPAN, bukan dibiarkan mati diam-diam.
   *
   * Tanpa satu pun selisih hari yang sah, pengingatnya tidak akan pernah
   * terkirim -- dan yang terlihat di layar cuma sakelar yang bercentang. Bentuk
   * kegagalan yang sama sudah pernah dibayar pada frasa darurat stok yang kosong.
   */
  if (hari.length === 0) {
    return {
      error: `Isi minimal satu angka, mis. "7,1" untuk mengingatkan sepekan sebelumnya dan sehari sebelumnya. 0 berarti hari-H. Maksimal ${MAX_HARI_SEBELUM}.`,
    };
  }
  if (hari.length > 5) {
    return { error: 'Maksimal 5 pengingat per surat. Lebih dari itu pasien menerima pesan berulang untuk satu jadwal yang sama.' };
  }

  const jam = Number(formData.get('bpjs.kontrol_jam') ?? 9);
  if (!Number.isInteger(jam) || jam < 0 || jam > 23) return { error: 'Jam kirim harus bilangan bulat 0-23.' };

  const body = String(formData.get('bpjs.template_kontrol') ?? '').trim();
  if (!body) return { error: 'Isi pesan pengingat wajib diisi.' };
  const takDikenal = findUnknownVariables(body, BPJS_KONTROL_TEMPLATE_VARIABLES);
  if (takDikenal.length > 0) {
    return {
      error: `Variabel tidak dikenal: ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${VARS_KONTROL_HINT}`,
    };
  }

  const generik = String(formData.get('bpjs.template_kontrol_generic') ?? '').trim();
  if (generik) {
    const takDikenalGenerik = findUnknownVariables(generik, BPJS_KONTROL_TEMPLATE_VARIABLES);
    if (takDikenalGenerik.length > 0) {
      return {
        error: `Variabel tidak dikenal pada pesan poli sensitif: ${takDikenalGenerik.map((v) => `{${v}}`).join(', ')}.`,
      };
    }
  }

  const kePasien = formData.get('bpjs.kontrol_ke_pasien') === 'on';
  /**
   * Mematikan "kirim ke pasien" tanpa satu pun tujuan yang menerima salinan
   * berarti pengingatnya tidak pergi ke mana pun -- dan itu TIDAK meninggalkan
   * satu baris outbox pun, jadi tidak ada yang muncul di Antrean maupun
   * Ringkasan. Pemicunya sekadar diam. Dijaga di sini dengan alasan dan bentuk
   * yang sama seperti `setTujuanModeAction` menolak mode 'tujuan' tanpa tujuan.
   */
  if (!kePasien) {
    const penerima = await BpjsTarget.count({ where: { isActive: true, terimaKontrol: true } });
    if (penerima === 0) {
      return {
        error:
          'Tidak bisa mematikan "Kirim ke pasien" selama belum ada tujuan yang mencentang "Terima salinan kontrol" — pengingatnya tidak akan pergi ke mana pun, tanpa satu pun tanda di halaman Antrean.',
      };
    }
  }

  await setSetting('bpjs.kontrol_hari_sebelum', tulisHariSebelum(hari));
  await setSetting('bpjs.kontrol_jam', String(jam));
  await setSetting('bpjs.template_kontrol', body);
  await setSetting('bpjs.template_kontrol_generic', generik);
  await setSetting('bpjs.kontrol_ke_pasien', kePasien ? '1' : '0');

  await logAudit(
    session!.user.username,
    'bpjs_kontrol_update',
    'app_setting',
    `hari=${tulisHariSebelum(hari)} jam=${jam} ke_pasien=${kePasien ? '1' : '0'}`,
  );
  segarkan();
  return { sukses: `Pengaturan pengingat disimpan. Pengingat dikirim H-${tulisHariSebelum(hari)} pada pukul ${jam}:00.` };
}

/**
 * "Jalankan sekarang" -- menjalankan `runBpjsKontrolJob()` yang SAMA dipakai
 * worker, bukan tiruannya.
 *
 * Ada karena jadwal harian punya masa tunggu yang panjang: staf yang baru
 * menyetel "H-7" tidak bisa tahu apakah setelannya benar sampai besok pukul
 * sembilan, dan sampai saat itu tidak ada satu pun tanda apakah ia bekerja.
 *
 * Aman ditekan berulang: kunci idempotennya per (surat, tanggal rencana,
 * selisih hari), jadi penekanan kedua tidak menghasilkan pesan kedua. Penanda
 * harian TIDAK disentuh -- tombol ini bukan pengganti jadwalnya, dan memajukan
 * penandanya akan membuat jadwal hari itu terlewat.
 */
export async function jalankanKontrolSekarangAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  if (!(await getSetting('bpjs.template_kontrol', ''))) {
    return { error: 'Isi pesan pengingat masih kosong.' };
  }

  let diproses: number;
  try {
    diproses = await runBpjsKontrolJob();
  } catch {
    return { error: 'Gagal membaca surat kontrol dari SIMRS. Coba lagi, atau periksa koneksi database.' };
  }

  await logAudit(session!.user.username, 'bpjs_kontrol_manual', 'bpjs.kontrol', `diproses=${diproses}`);
  segarkan();
  return diproses === 0
    ? {
        sukses:
          'Selesai — tidak ada surat kontrol yang jatuh tempo diingatkan hari ini. Itu wajar bila tidak ada pasien yang tanggal kontrolnya persis sejauh setelan di atas.',
      }
    : { sukses: `Selesai — ${diproses} surat kontrol diproses. Periksa halaman Antrean untuk melihat pesannya.` };
}
