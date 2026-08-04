'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, StokAlertSchedule, logAudit, setSetting, getSetting, getSettingBool } from '@/models';
import { findUnknownVariables, DARURAT_TEMPLATE_VARIABLES } from '@/core/template';
import {
  computeNextRunAt,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
  type RepeatKindPeriodik,
} from '@/core/schedule';
import { susunPesanDarurat, muatTujuanDarurat, jalankanSatuJadwal } from '@/worker/stokDaruratRunner';
import {
  deteksiPermintaanDarurat,
  parseFrasaDarurat,
  BATAS_KERAS_BARIS,
  SEMUA_BARIS,
} from '@/core/stokDarurat';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk bagian DARURAT STOK di `/farmasi`.
 *
 * Berkas tersendiri, bukan menumpang `actions.ts` yang sudah ~390 baris.
 * Batasnya bukan panjang melainkan pertanyaan yang dijawab: yang di sana
 * tentang tujuan pengiriman dan isi pesan resep, yang di sini tentang jadwal
 * peringatan persediaan. Menggabungkannya membuat satu berkas yang tidak bisa
 * dijelaskan dalam satu kalimat.
 */

export interface HasilDarurat {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjau {
  error?: string;
  teks?: string;
  total?: number;
  habis?: number;
  menipis?: number;
  /** Pesannya tidak akan dikirim sama sekali (tidak ada barang & pesan kosong dibiarkan diam). */
  diam?: boolean;
  /**
   * Berapa PESAN yang akan terkirim. >1 berarti daftarnya dipecah karena
   * panjang. Ditampilkan supaya staf tidak kaget menerima beberapa pesan
   * berturut-turut lalu mengira sistemnya mengulang.
   */
  jumlahPesan?: number;
}

export interface HasilUjiFrasa {
  error?: string;
  cocok?: boolean;
  frasa?: string;
  sisa?: string;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat sebagai peristiwa audit tersendiri.
 *
 * Alasan yang sama dengan `farmasi_toggle` dan `auto_reply_toggle`: inilah
 * momen nomor rumah sakit mulai mengirim pesan atas inisiatifnya sendiri
 * menurut jam yang disetel, bukan menjawab kejadian. Menenggelamkannya sebagai
 * satu nama kunci di dalam `settings_update` membuat perubahan paling
 * berkonsekuensi di bagian ini jadi yang paling sulit ditelusuri.
 */
export async function toggleDaruratAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('farmasi.darurat_enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'stok_darurat_toggle', 'farmasi.darurat_enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

export async function toggleTerimaDaruratAction(id: number, terima: boolean): Promise<HasilDarurat> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ terimaDaruratStok: terima, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_darurat',
    String(id),
    `${row.jenis} ${row.chatId} -> ${terima ? 'menerima darurat stok' : 'tidak menerima darurat stok'}`,
  );
  segarkan();
  return {
    sukses: terima
      ? `"${row.label}" sekarang menerima peringatan persediaan.`
      : `"${row.label}" tidak lagi menerima peringatan persediaan.`,
  };
}

// ---------------------------------------------------------------------------
// Isi pesan
// ---------------------------------------------------------------------------

export async function simpanPesanDaruratAction(_prev: HasilDarurat, formData: FormData): Promise<HasilDarurat> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const ada = String(formData.get('template_darurat') ?? '');
  const kosong = String(formData.get('template_darurat_kosong') ?? '');
  const pakaiBatch = formData.get('stok_pakai_batch') === 'on';
  const bolehTanya = formData.get('darurat_tanya') === 'on';
  const frasaRaw = String(formData.get('darurat_keywords') ?? '');

  if (!ada.trim()) {
    return { error: 'Isi pesan tidak boleh kosong — tanpa itu peringatan terkirim sebagai pesan hampa.' };
  }

  /**
   * Menyalakan tanya-jawab tanpa satu pun frasa akan mati DIAM: tidak ada yang
   * pernah cocok, dan yang terlihat di layar cuma sakelar bercentang. Ditolak
   * saat disimpan, bukan ditemukan berminggu-minggu kemudian saat seseorang
   * mengeluh nomornya tidak pernah menjawab.
   */
  if (bolehTanya && parseFrasaDarurat(frasaRaw).length === 0) {
    return { error: 'Isi minimal satu frasa pertanyaan, atau matikan "Jawab bila ditanya".' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3). Variabel salah
  // ketik yang lolos ke sini hanya ketahuan sesudah pesannya terkirim dengan
  // bagian yang hilang -- dan pesannya berulang menurut jadwal, jadi kesalahan
  // yang sama terkirim tiap hari sampai ada yang menyadarinya.
  for (const [nama, isi] of [
    ['Isi pesan', ada],
    ['Pesan saat aman', kosong],
  ] as const) {
    const takDikenal = findUnknownVariables(isi, DARURAT_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `${nama}: variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${DARURAT_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
      };
    }
  }

  await setSetting('farmasi.template_darurat', ada);
  await setSetting('farmasi.template_darurat_kosong', kosong);
  await setSetting('farmasi.stok_pakai_batch', pakaiBatch ? '1' : '0');
  await setSetting('farmasi.darurat_tanya', bolehTanya ? '1' : '0');
  await setSetting('farmasi.darurat_keywords', frasaRaw.trim());
  await logAudit(
    session!.user.username,
    'stok_darurat_pesan',
    'farmasi.template_darurat',
    `isi pesan diperbarui; jawab bila ditanya: ${bolehTanya ? 'ya' : 'tidak'}`,
  );
  segarkan();
  return { sukses: 'Isi pesan tersimpan.' };
}

/**
 * Kotak uji coba frasa -- memakai `deteksiPermintaanDarurat()` yang SAMA
 * dipanggil worker, bukan tiruannya.
 *
 * Yang paling perlu dibuktikan staf bukan "apakah frasanya cocok" melainkan
 * kebalikannya: bahwa "stok habis paracetamol" TIDAK dijawab rekap. Pembedaan
 * itu tidak terlihat dari daftar frasa saja, dan salah menebaknya berarti setiap
 * pertanyaan tentang satu obat dijawab daftar dua ratus barang.
 */
export async function ujiFrasaDaruratAction(_prev: HasilUjiFrasa, formData: FormData): Promise<HasilUjiFrasa> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const teks = String(formData.get('uji_teks') ?? '');
  if (!teks.trim()) return { error: 'Ketik contoh pesannya dulu.' };

  const frasa = parseFrasaDarurat((await getSetting('farmasi.darurat_keywords', '')) ?? '');
  if (frasa.length === 0) return { error: 'Belum ada frasa tersimpan. Simpan isi pesan lebih dulu.' };

  const hasil = deteksiPermintaanDarurat(teks, frasa);
  return { cocok: hasil.cocok, frasa: hasil.frasa, sisa: hasil.sisa };
}

// ---------------------------------------------------------------------------
// Pratinjau -- fungsi produksi yang SAMA dipakai worker
// ---------------------------------------------------------------------------

/**
 * Menampilkan daftar darurat SEKARANG, memakai `susunPesanDarurat()` yang sama
 * persis dipanggil worker saat benar-benar mengirim.
 *
 * Tidak menulis apa pun -- ini murni pembacaan `sik`. Pratinjau yang membuat
 * baris `outbox` akan membuat tombolnya berbahaya untuk ditekan berulang, dan
 * yang perlu dilihat staf adalah bentuk pesannya, bukan bukti pengiriman.
 */
export async function pratinjauDaruratAction(_prev: HasilPratinjau, formData: FormData): Promise<HasilPratinjau> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const kdJenis = String(formData.get('kd_jenis') ?? '').trim();
  // Bawaannya SEMUA, bukan 30. `|| 30` yang lama juga membuat isian 0 diam-diam
  // berubah jadi 30, sehingga "tampilkan semua" tidak pernah bisa dipratinjau.
  const maxBarisRaw = Number(formData.get('max_baris'));
  const maxBaris = Number.isFinite(maxBarisRaw) && maxBarisRaw > 0 ? maxBarisRaw : SEMUA_BARIS;

  const [bodyAda, bodyKosong, pakaiBatch] = await Promise.all([
    getSetting('farmasi.template_darurat', ''),
    getSetting('farmasi.template_darurat_kosong', ''),
    getSettingBool('farmasi.stok_pakai_batch', false),
  ]);

  try {
    const hasil = await susunPesanDarurat({
      kdJenis: kdJenis || null,
      maxBaris,
      pakaiBatch,
      bodyAda: bodyAda ?? '',
      bodyKosong: bodyKosong ?? '',
      saatIni: new Date(),
    });

    return {
      // Seluruh bagian disambung untuk pratinjau -- yang perlu diperiksa staf
      // adalah daftarnya lengkap, sementara pemecahannya dilaporkan lewat
      // `jumlahPesan`.
      teks:
        hasil.bagian
          .map((b) => b.daftar_stok ?? '')
          .filter(Boolean)
          .join('\n\n———\n\n') || '(tidak ada barang di bawah ambang minimal)',
      total: hasil.ringkasan.total,
      habis: hasil.ringkasan.habis,
      menipis: hasil.ringkasan.menipis,
      diam: hasil.body === null,
      jumlahPesan: hasil.ringkasan.total === 0 ? 0 : hasil.bagian.length,
    };
  } catch (err) {
    return { error: `Gagal membaca persediaan: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Jadwal
// ---------------------------------------------------------------------------

function bacaTiming(formData: FormData): { timing: Parameters<typeof computeNextRunAt>[0]; error?: string } {
  const repeatKind = String(formData.get('repeat_kind') ?? 'daily') as RepeatKindPeriodik;
  const timeOfDay = String(formData.get('time_of_day') ?? '').trim();

  if (!/^\d{2}:\d{2}$/.test(timeOfDay)) {
    return { timing: { repeatKind, timeOfDay: '06:00' }, error: 'Jam kirim harus berbentuk HH:MM.' };
  }

  const timing: Parameters<typeof computeNextRunAt>[0] = { repeatKind, timeOfDay };

  if (repeatKind === 'every_n_days') {
    const n = Number(formData.get('interval_days'));
    if (!Number.isFinite(n) || n < MIN_INTERVAL_DAYS || n > MAX_INTERVAL_DAYS) {
      return {
        timing,
        error: `Jarak hari harus antara ${MIN_INTERVAL_DAYS} dan ${MAX_INTERVAL_DAYS}. Untuk tiap hari, pilih "Setiap hari".`,
      };
    }
    timing.intervalDays = Math.floor(n);
  }

  if (repeatKind === 'weekly') {
    const d = Number(formData.get('day_of_week'));
    if (!Number.isFinite(d) || d < 0 || d > 6) return { timing, error: 'Pilih hari dalam minggu.' };
    timing.dayOfWeek = d;
  }

  if (repeatKind === 'monthly') {
    const d = Number(formData.get('day_of_month'));
    // 1-28, supaya selalu valid termasuk Februari tanpa logika kasus-khusus.
    if (!Number.isFinite(d) || d < 1 || d > 28) return { timing, error: 'Tanggal harus antara 1 dan 28.' };
    timing.dayOfMonth = d;
  }

  return { timing };
}

export async function simpanJadwalAction(_prev: HasilDarurat, formData: FormData): Promise<HasilDarurat> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const idRaw = String(formData.get('id') ?? '').trim();
  const nama = String(formData.get('nama') ?? '').trim();
  const kdJenis = String(formData.get('kd_jenis') ?? '').trim();
  const maxBaris = Number(formData.get('max_baris'));

  if (!nama) return { error: 'Beri nama jadwal ini, mis. "Rekap pagi grup apotek".' };
  if (nama.length > 80) return { error: 'Nama jadwal maksimal 80 karakter.' };
  /**
   * 0 = seluruhnya, dan itu nilai yang SAH -- bukan isian kosong yang lolos.
   *
   * Batas atasnya dulu 200 sementara 208 barang berada di bawah ambang minimal
   * di database ini; kapnya menggigit pada hari pertama, dan yang tergunting
   * justru barang paling tidak mendesak sehingga ketiadaannya paling sulit
   * disadari. Batas atas sekarang mengikuti batas keras pembacaan `sik`
   * (`BATAS_KERAS_BARIS`), yang memang bukan pilihan kebijakan melainkan pagar
   * memori worker.
   */
  if (!Number.isFinite(maxBaris) || maxBaris < 0 || maxBaris > BATAS_KERAS_BARIS) {
    return { error: `Batas baris harus 0 (semua) atau antara 1 dan ${BATAS_KERAS_BARIS}.` };
  }

  const { timing, error } = bacaTiming(formData);
  if (error) return { error };

  const sekarang = new Date();
  const nextRunAt = computeNextRunAt(timing, sekarang);
  if (!nextRunAt) {
    // Tidak boleh menyimpan jadwal yang tidak akan pernah jalan: gejalanya
    // tidak terlihat sama sekali -- barisnya ada di daftar, tampak aktif, dan
    // diam selamanya.
    return { error: 'Kombinasi pengulangan itu tidak menghasilkan waktu jalan berikutnya. Periksa isian jadwalnya.' };
  }

  const nilai = {
    nama,
    repeatKind: timing.repeatKind,
    intervalDays: timing.intervalDays ?? null,
    timeOfDay: timing.timeOfDay,
    dayOfWeek: timing.dayOfWeek ?? null,
    dayOfMonth: timing.dayOfMonth ?? null,
    kdJenis: kdJenis || null,
    maxBaris: Math.floor(maxBaris),
    nextRunAt,
    updatedBy: session!.user.username,
    updatedAt: sekarang,
  };

  if (idRaw) {
    const row = await StokAlertSchedule.findByPk(Number(idRaw));
    if (!row) return { error: 'Jadwal tidak ditemukan.' };
    await row.update(nilai);
    await logAudit(session!.user.username, 'stok_darurat_jadwal_ubah', idRaw, nama);
    segarkan();
    return { sukses: `Jadwal "${nama}" diperbarui. Berikutnya: ${nextRunAt.toLocaleString('id-ID')}.` };
  }

  const dibuat = await StokAlertSchedule.create({
    ...nilai,
    lastRunAt: null,
    lastJumlah: null,
    createdBy: session!.user.username,
    createdAt: sekarang,
  });
  await logAudit(session!.user.username, 'stok_darurat_jadwal_tambah', String(dibuat.id), nama);
  segarkan();
  return { sukses: `Jadwal "${nama}" dibuat. Berikutnya: ${nextRunAt.toLocaleString('id-ID')}.` };
}

export async function toggleJadwalAction(id: number, aktif: boolean): Promise<HasilDarurat> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await StokAlertSchedule.findByPk(id);
  if (!row) return { error: 'Jadwal tidak ditemukan.' };

  /**
   * Mengaktifkan kembali WAJIB menghitung ulang `next_run_at`.
   *
   * Jadwal yang dijeda seminggu menyimpan waktu jatuh tempo dari minggu lalu.
   * Menyalakannya tanpa menghitung ulang membuatnya jatuh tempo SEKETIKA --
   * peringatan yang tiba-tiba terkirim di tengah malam beberapa detik setelah
   * seseorang menekan "Aktifkan", pada jam yang tidak pernah dipilih siapa pun.
   */
  const next = aktif
    ? computeNextRunAt(
        {
          repeatKind: row.repeatKind,
          timeOfDay: row.timeOfDay,
          dayOfWeek: row.dayOfWeek,
          dayOfMonth: row.dayOfMonth,
          intervalDays: row.intervalDays,
        },
        new Date(),
      )
    : null;

  await row.update({ isActive: aktif, nextRunAt: next, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'stok_darurat_jadwal_toggle', String(id), aktif ? 'aktif' : 'dijeda');
  segarkan();
  return {
    sukses: aktif
      ? `"${row.nama}" aktif. Berikutnya: ${next ? next.toLocaleString('id-ID') : 'tidak terjadwal'}.`
      : `"${row.nama}" dijeda.`,
  };
}

export async function hapusJadwalAction(id: number): Promise<HasilDarurat> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await StokAlertSchedule.findByPk(id);
  if (!row) return { error: 'Jadwal tidak ditemukan.' };

  const nama = row.nama;
  // Baris audit ditulis SEBELUM barisnya hilang, dan memuat namanya: sesudah
  // ini `audit_log` adalah satu-satunya tempat yang masih menyebut jadwal itu
  // pernah ada. Pola yang sama dipakai `user_delete`.
  await logAudit(session!.user.username, 'stok_darurat_jadwal_hapus', String(id), nama);
  await row.destroy();
  segarkan();
  return { sukses: `Jadwal "${nama}" dihapus.` };
}

/**
 * "Kirim sekarang" -- menjalankan satu jadwal di luar waktunya.
 *
 * Memakai `jalankanSatuJadwal()`, fungsi PRODUKSI yang sama dipanggil worker,
 * bukan jalur kirim tersendiri. Tombol uji yang memakai jalurnya sendiri
 * membuktikan jalur yang tidak dipakai produksi -- pelajaran yang sudah dibayar
 * pada tombol uji webhook peringatan.
 *
 * Akibat yang disengaja: `next_run_at` ikut maju, persis seperti kalau ia
 * jatuh tempo sendiri. Kalau tidak, menekan tombol ini akan membuat peringatan
 * hari itu terkirim DUA kali -- sekali sekarang, sekali lagi saat jadwalnya
 * benar-benar tiba.
 */
export async function kirimSekarangAction(id: number): Promise<HasilDarurat> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await StokAlertSchedule.findByPk(id);
  if (!row) return { error: 'Jadwal tidak ditemukan.' };

  const tujuan = await muatTujuanDarurat();
  if (tujuan.length === 0) {
    return { error: 'Belum ada tujuan yang mencentang "Terima darurat stok" — pesannya tidak akan sampai ke mana pun.' };
  }

  try {
    const jumlah = await jalankanSatuJadwal(row, tujuan, new Date());
    await logAudit(session!.user.username, 'stok_darurat_kirim_manual', String(id), `${jumlah} barang`);
    segarkan();
    return {
      sukses:
        jumlah === 0
          ? 'Tidak ada barang di bawah ambang minimal saat ini. Pesan hanya terkirim bila "Pesan saat aman" diisi.'
          : `Antre terkirim: ${jumlah} barang ke ${tujuan.length} tujuan. Pengirimannya dikerjakan worker dalam satu siklus.`,
    };
  } catch (err) {
    return { error: `Gagal: ${err instanceof Error ? err.message : String(err)}` };
  }
}
