'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, WaSession, logAudit, setSetting, getSetting } from '@/models';
import { findUnknownVariables, FARMASI_TEMPLATE_VARIABLES, STOK_TEMPLATE_VARIABLES } from '@/core/template';
import { parseStokKeywords } from '@/core/stokObat';
import { susunJawabanStok, type JawabanStok, type SebabLanjut } from '@/worker/stokReply';
import { loadActiveRules } from '@/worker/autoReply';
import { matchRule } from '@/core/autoReply';
import { getHospitalIdentity } from '@/khanza/common';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { buildIdempotencyKey } from '@/core/idempotency';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { mintaSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

const VARS_HINT = FARMASI_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

export interface HasilForm {
  error?: string;
  sukses?: string;
}

export interface HasilUji {
  error?: string;
  /** Terisi HANYA saat pesannya tidak dijawab di jalur stok -- berikut sebabnya. */
  hasil?: string;
  cabang?: 'ketemu' | 'kosong' | 'tanpa_nama';
  /**
   * Dua jawaban dari satu pertanyaan, ditampilkan berdampingan.
   *
   * Sejak jawaban untuk nomor umum bisa berbeda bentuk dari jawaban untuk
   * petugas (migrations/039), menampilkan salah satunya saja berarti staf
   * menyetel yang satu sambil melihat yang lain. Yang paling mungkin salah
   * dibaca justru yang umum: modenya masih `petugas`, jadi tanpa kotak ini
   * satu-satunya cara melihatnya adalah menyalakan mode `semua` lebih dulu --
   * yaitu mengujinya di hadapan orang sungguhan.
   */
  petugas?: string;
  umum?: string;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar utama, dicatat ke `audit_log` sebagai peristiwanya sendiri -- pola
 * yang sama dengan `auto_reply_toggle` dan karena alasan yang sama: inilah
 * momen data pasien mulai mengalir ke sebuah GRUP WhatsApp. Menenggelamkannya
 * sebagai satu nama kunci di dalam `settings_update` akan membuat perubahan
 * paling berkonsekuensi di halaman ini jadi yang paling sulit ditelusuri.
 */
export async function toggleFarmasiAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('farmasi.enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'farmasi_toggle', 'farmasi.enabled', enabled ? 'nyala' : 'mati');
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

  if (!label) return { error: 'Beri nama tujuan ini, mis. "Grup Apotek" — supaya bisa dikenali di daftar.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  const hasil = parseTarget(jenis, nilai);
  if (!hasil.ok) return { error: hasil.error };

  if (await FarmasiTarget.findOne({ where: { chatId: hasil.chatId } })) {
    return { error: 'Tujuan itu sudah ada di daftar. Menambahkannya dua kali membuat tiap resep terkirim dua kali.' };
  }

  const dibuat = await FarmasiTarget.create({
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await logAudit(session!.user.username, 'farmasi_target_create', String(dibuat.id), `${hasil.jenis} ${hasil.chatId} (${label})`);
  segarkan();
  return { sukses: `Tujuan "${label}" ditambahkan. Kirim pesan uji untuk memastikan pesannya benar-benar sampai.` };
}

export async function ubahTargetAction(id: number, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const label = String(formData.get('label') ?? '').trim();
  if (!label) return { error: 'Nama tujuan wajib diisi.' };
  if (label.length > 80) return { error: 'Nama tujuan maksimal 80 karakter.' };

  await row.update({ label, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'farmasi_target_update', String(id), label);
  segarkan();
  return { sukses: 'Nama tujuan diperbarui.' };
}

/**
 * Alamatnya sendiri sengaja TIDAK bisa disunting -- hanya namanya.
 *
 * Mengubah alamat di tempat berarti riwayat pengiriman yang sudah ada di
 * `outbox` menunjuk baris tujuan yang kini berarti grup lain, sehingga "pesan
 * ini dulu dikirim ke mana" berubah jawabannya secara surut. Menghapus lalu
 * menambah baru meninggalkan dua baris `audit_log` yang jujur.
 */
export async function hapusTargetAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await logAudit(session!.user.username, 'farmasi_target_delete', String(id), `${row.jenis} ${row.chatId} (${row.label})`);
  await row.destroy();
  segarkan();
  return { sukses: `Tujuan "${row.label}" dihapus.` };
}

export async function toggleTargetAction(id: number, aktif: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ isActive: aktif, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, 'farmasi_target_toggle', String(id), aktif ? 'aktif' : 'nonaktif');
  segarkan();
  return { sukses: aktif ? `"${row.label}" diaktifkan.` : `"${row.label}" dinonaktifkan.` };
}

/**
 * Izin BERTANYA, terpisah dari aktif/nonaktif (migrations/020).
 *
 * Dicatat sebagai peristiwa audit tersendiri, bukan ikut `farmasi_target_toggle`:
 * yang berubah di sini bukan ke mana pesan dikirim melainkan siapa yang boleh
 * membuat nomor rumah sakit MENJAWAB -- dan untuk sebuah grup, itu berarti
 * nomor RS mulai ikut berbicara di dalam percakapan yang anggotanya diatur di
 * luar sistem ini.
 */
export async function toggleBolehTanyaAction(id: number, boleh: boolean): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ bolehTanya: boleh, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_boleh_tanya',
    String(id),
    `${row.jenis} ${row.chatId} -> ${boleh ? 'boleh bertanya' : 'tidak boleh bertanya'}`,
  );
  segarkan();
  return {
    sukses: boleh
      ? `"${row.label}" sekarang boleh menanyakan stok & harga${row.jenis === 'grup' ? ' — jawabannya muncul di dalam grup itu' : ''}.`
      : `"${row.label}" tidak lagi bisa menanyakan stok & harga.`,
  };
}

// ---------------------------------------------------------------------------
// Daftar grup
// ---------------------------------------------------------------------------

/**
 * Menitipkan perintah ke worker lewat `wa_session.command` -- proses web tidak
 * memegang sesi WhatsApp dan kedua proses tidak pernah bicara lewat HTTP
 * (ARCHITECTURE §1). Konsekuensinya sama seperti tombol sambung ulang: hasilnya
 * baru muncul setelah worker mengambil perintahnya (paling lama 5 detik), jadi
 * halaman perlu dimuat ulang -- dan tombolnya mengatakan itu.
 */
export async function mintaSyncGrupAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await mintaSyncGrup(session!.user.username);
  segarkan();
  revalidatePath('/pesan-masuk'); // daftar grup dipakai di kedua halaman
  return hasil;
}

// ---------------------------------------------------------------------------
// Pesan
// ---------------------------------------------------------------------------

const KUNCI_PESAN = [
  'farmasi.template_validasi',
  'farmasi.template_penyerahan',
  'farmasi.template_generic',
  'farmasi.template_rekap',
] as const;

export async function simpanPesanAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const nilai: Record<string, string> = {};
  for (const kunci of KUNCI_PESAN) {
    const body = String(formData.get(kunci) ?? '').trim();
    if (!body) return { error: 'Semua isi pesan wajib diisi.' };

    // Sama seperti tiga jenis template lain: variabel tak dikenal ditolak SAAT
    // DISIMPAN, bukan diam-diam jadi string kosong di pesan yang sudah terkirim.
    const takDikenal = findUnknownVariables(body, FARMASI_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `Variabel tidak dikenal: ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${VARS_HINT}`,
      };
    }
    nilai[kunci] = body;
  }

  const maxPerCycle = Number(formData.get('farmasi.max_per_cycle') ?? 20);
  if (!Number.isInteger(maxPerCycle) || maxPerCycle < 1 || maxPerCycle > 200) {
    return { error: 'Ambang rekap harus bilangan bulat 1-200.' };
  }

  for (const [kunci, body] of Object.entries(nilai)) await setSetting(kunci, body);
  await setSetting('farmasi.max_per_cycle', String(maxPerCycle));
  await setSetting('farmasi.validasi_enabled', formData.get('farmasi.validasi_enabled') === 'on' ? '1' : '0');
  await setSetting('farmasi.penyerahan_enabled', formData.get('farmasi.penyerahan_enabled') === 'on' ? '1' : '0');

  await logAudit(session!.user.username, 'farmasi_pesan_update', 'app_setting', KUNCI_PESAN.join(','));
  segarkan();
  return { sukses: 'Pengaturan pesan disimpan.' };
}

// ---------------------------------------------------------------------------
// Balasan stok & harga obat
// ---------------------------------------------------------------------------

const KUNCI_STOK = [
  'farmasi.stok_template',
  'farmasi.stok_template_umum',
  'farmasi.stok_template_kosong',
  'farmasi.stok_template_tanpa_nama',
] as const;

/**
 * Keduanya wajib memuat `{stok_obat}`: tanpa itu jawabannya tidak menyebut satu
 * pun obat -- pesan sopan yang tidak menjawab apa pun.
 */
const KUNCI_KETEMU = ['farmasi.stok_template', 'farmasi.stok_template_umum'] as const;

const VARS_STOK_HINT = STOK_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

/**
 * Modenya dicatat ke `audit_log` sebagai peristiwanya SENDIRI, terpisah dari
 * penyimpanan teks -- alasan yang sama seperti `farmasi_toggle`: inilah momen
 * persediaan dan harga apotek mulai dijawab otomatis, dan pada 'semua' mulai
 * dijawab kepada siapa pun yang mengirim pesan. Menenggelamkannya sebagai satu
 * nama kunci di dalam penyimpanan pengaturan membuat perubahan paling
 * berkonsekuensi di bagian ini jadi yang paling sulit ditelusuri.
 */
export async function simpanStokAction(_prev: HasilForm, formData: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const modeBaru = String(formData.get('farmasi.stok_mode') ?? 'mati');
  if (!['mati', 'petugas', 'semua'].includes(modeBaru)) return { error: 'Mode tidak dikenal.' };

  const keywords = String(formData.get('farmasi.stok_keywords') ?? '').trim();
  if (modeBaru !== 'mati' && parseStokKeywords(keywords).length === 0) {
    return { error: 'Isi minimal satu kata kunci, mis. "stok, harga" — tanpa itu tidak ada pertanyaan yang dikenali.' };
  }

  // Boleh kosong: rumah sakit yang cuma mau menjawab "stok"/"harga" tinggal
  // mengosongkannya, dan bentuknya kembali persis seperti sebelum
  // migrations/039.
  const keywordsAda = String(formData.get('farmasi.stok_keywords_ketersediaan') ?? '').trim();

  /**
   * Kata yang ditulis di KEDUA kotak ditolak, bukan dibiarkan menang di salah
   * satunya. Keduanya sama-sama membuat pesan cocok, tapi perlakuannya saat
   * obatnya tidak ketemu berlawanan -- yang satu menjawab "tidak ditemukan",
   * yang satu melepas pesannya. Yang ketat menang, jadi entri kembarnya
   * menjadi no-op yang tidak terlihat: staf mengira sudah menyetel perilaku
   * yang longgar padahal tidak berubah sama sekali.
   */
  const ketatSet = new Set(parseStokKeywords(keywords));
  const kembar = parseStokKeywords(keywordsAda).filter((k) => ketatSet.has(k));
  if (kembar.length > 0) {
    return {
      error: `Kata ${kembar.map((k) => `"${k}"`).join(', ')} ada di kedua kotak kata kunci. Pilih salah satu — yang di kotak atas selalu dijawab, yang di kotak bawah hanya dijawab kalau obatnya benar-benar ketemu.`,
    };
  }

  const rincianUmum = String(formData.get('farmasi.stok_rincian_umum') ?? 'ringkas');
  if (!['ringkas', 'harga'].includes(rincianUmum)) return { error: 'Pilihan rincian untuk nomor umum tidak dikenal.' };

  const maks = Number(formData.get('farmasi.stok_max_hasil') ?? 5);
  if (!Number.isInteger(maks) || maks < 1 || maks > 20) {
    return { error: 'Jumlah hasil harus bilangan bulat 1-20. Lebih dari itu, pesannya jadi terlalu panjang untuk dibaca.' };
  }

  const harga = String(formData.get('farmasi.stok_harga') ?? 'jualbebas');
  if (!['ralan', 'jualbebas'].includes(harga)) return { error: 'Pilihan harga tidak dikenal.' };

  const teks: Record<string, string> = {};
  for (const kunci of KUNCI_STOK) {
    const body = String(formData.get(kunci) ?? '').trim();
    // Kosong DIIZINKAN dan berarti "diam untuk cabang ini" -- sama seperti
    // `autoreply.fallback_body`. Yang tidak boleh adalah variabel salah ketik,
    // yang diam-diam jadi string kosong di pesan yang sudah terkirim.
    const takDikenal = findUnknownVariables(body, STOK_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `Variabel tidak dikenal: ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${VARS_STOK_HINT}`,
      };
    }
    teks[kunci] = body;
  }

  // Template tanpa {stok_obat} berarti jawabannya tidak memuat satu pun obat --
  // pesan sopan yang tidak menjawab apa pun. Ditolak saat menyimpan, bukan
  // ditemukan lewat pasien yang kebingungan. Berlaku untuk KEDUA jawaban
  // "ketemu"; yang umum dulu tidak diperiksa karena memang belum ada.
  for (const kunci of KUNCI_KETEMU) {
    if (modeBaru !== 'mati' && teks[kunci] && !teks[kunci].includes('{stok_obat}')) {
      return {
        error: `Isi jawaban ${
          kunci === 'farmasi.stok_template' ? 'untuk petugas apotek' : 'untuk nomor umum'
        } harus memuat {stok_obat} — itulah bagian yang berisi daftar obatnya.`,
      };
    }
  }

  const modeLama = (await getSetting('farmasi.stok_mode', 'mati')) ?? 'mati';

  for (const [kunci, body] of Object.entries(teks)) await setSetting(kunci, body);
  await setSetting('farmasi.stok_keywords', keywords);
  await setSetting('farmasi.stok_keywords_ketersediaan', keywordsAda);
  await setSetting('farmasi.stok_rincian_umum', rincianUmum);
  await setSetting('farmasi.stok_max_hasil', String(maks));
  await setSetting('farmasi.stok_harga', harga);
  await setSetting('farmasi.stok_mode', modeBaru);

  if (modeLama !== modeBaru) {
    await logAudit(session!.user.username, 'farmasi_stok_mode', 'farmasi.stok_mode', `${modeLama} -> ${modeBaru}`);
  }
  await logAudit(session!.user.username, 'farmasi_stok_update', 'app_setting', KUNCI_STOK.join(','));
  segarkan();
  return { sukses: 'Pengaturan balasan stok disimpan.' };
}

/**
 * Kotak uji coba. Memakai `susunJawabanStok()` yang SAMA dipanggil worker --
 * pratinjau yang berbeda dari yang benar-benar terkirim lebih buruk daripada
 * tanpa pratinjau. Tidak mengirim apa pun, dan sengaja MENGABAIKAN mode akses:
 * yang sedang diuji admin adalah kata kunci dan isi jawabannya, bukan apakah
 * nomornya sendiri berhak bertanya.
 */
export async function ujiStokAction(_prev: HasilUji, formData: FormData): Promise<HasilUji> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const teks = String(formData.get('teks') ?? '').trim();
  if (!teks) return { error: 'Ketik dulu contoh pertanyaannya.' };

  const identity = await getHospitalIdentity();
  // DUA kali, sekali per jenis penanya. Cabangnya pasti sama (kata kunci dan
  // katalognya sama); yang berbeda hanya rincian daftar dan teks pembungkusnya.
  // Pemeriksa aturan ikut diserahkan supaya pratinjaunya melaporkan hal yang
  // SAMA dengan worker -- termasuk saat sebuah aturan /balasan-otomatis yang
  // cocok mengalahkan kata tanya ketersediaan.
  const aturanCocok = async () => matchRule(teks, await loadActiveRules()) !== null;
  const [petugas, umum] = await Promise.all([
    susunJawabanStok(teks, identity, 'petugas', aturanCocok),
    susunJawabanStok(teks, identity, 'umum', aturanCocok),
  ]);

  if (petugas.aksi === 'lanjut') return { hasil: alasanLanjut(petugas.sebab, petugas.cari) };

  const isi = (j: JawabanStok): string =>
    j.aksi === 'jawab' && j.body.trim() ? j.body : '(teks untuk keadaan ini dikosongkan — tidak ada yang dikirim)';

  return { cabang: petugas.cabang, petugas: isi(petugas), umum: isi(umum) };
}

/**
 * Ketiga sebabnya dijelaskan lewat AKIBATNYA, bukan nama enumnya -- dan
 * dibedakan karena tindakan staf atasnya berbeda: yang pertama menuntut kata
 * kunci ditambah, dua sisanya justru menandakan kata kuncinya sudah bekerja.
 */
function alasanLanjut(sebab: SebabLanjut, cari: string): string {
  if (sebab === 'aturan_menang') {
    return `Ada obat bernama "${cari}" di katalog, TAPI pesan ini juga cocok dengan sebuah aturan aktif di /balasan-otomatis — dan aturan yang ditulis staf selalu menang atas kata tanya ketersediaan. Aturan itulah yang menjawab.`;
  }
  if (sebab === 'ketersediaan_tak_ketemu') {
    return `Kata tanya ketersediaan cocok, tapi "${cari}" tidak ada di katalog obat — pesannya diteruskan ke aturan di /balasan-otomatis, BUKAN dijawab "tidak ditemukan". Itulah yang membuat pertanyaan seperti "ada dokter jaga?" tidak dibajak ke jalur obat.`;
  }
  if (sebab === 'ketersediaan_tanpa_nama') {
    return 'Kata tanya ketersediaan cocok, tapi tidak ada nama obat yang bisa dicari — pesannya diteruskan ke aturan di /balasan-otomatis.';
  }
  return 'Tidak ada kata kunci stok yang cocok — pesan seperti ini akan diteruskan ke aturan di /balasan-otomatis.';
}

// ---------------------------------------------------------------------------
// Kirim uji
// ---------------------------------------------------------------------------

/**
 * Tujuan yang tidak pernah dicoba sama saja dengan tidak ada.
 *
 * Kode grup yang salah GAGAL DIAM-DIAM: barisnya masuk antrean, dikirim,
 * ditolak WhatsApp, lalu tampil di halaman Antrean seperti gangguan jaringan
 * biasa. Pelajaran yang sama sudah pernah dibayar di tombol uji webhook
 * peringatan -- URL salah ketik, bot yang belum diundang ke grup, dan token
 * kedaluwarsa semuanya diam sampai saat paling buruk untuk menemukannya.
 *
 * Lewat `enqueueMessage()` yang SAMA dipakai worker, bukan `client.sendMessage`
 * langsung: yang perlu dibuktikan bukan cuma "grupnya ada", melainkan seluruh
 * lintasan sampai grup itu menerima -- termasuk dispatcher, jeda acak, kuota,
 * dan baris kode pengiriman.
 */
export async function kirimUjiAction(id: number): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  const sesi = await WaSession.findByPk(1);
  if (sesi?.status !== 'ready') {
    return { error: 'WhatsApp belum tersambung, jadi pesan uji tidak akan terkirim. Buka halaman Koneksi dulu.' };
  }

  // {nama_rs} tidak perlu diisi di sini -- enqueueMessage() menyisipkan
  // identitas RS sendiri sebagai dasar untuk semua pemicu.
  const body =
    'Pesan uji dari sistem notifikasi farmasi {nama_rs}.\n\n' +
    'Kalau pesan ini terbaca, berarti tujuan ini sudah benar dan siap menerima ' +
    'pemberitahuan resep divalidasi serta obat diserahkan.';

  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);
  await enqueueMessage(
    {
      // Stempel waktu ikut ke dalam kunci supaya tombolnya bisa ditekan
      // BERULANG. Staf yang sedang membetulkan kode grup harus bisa mencoba
      // lagi dan lagi -- alasan yang sama seperti `kind: 'test'` dikecualikan
      // dari jeda peringatan gangguan.
      idempotencyKey: buildIdempotencyKey('FARMASI_UJI', row.chatId, new Date().toISOString()),
      noRkmMedis: null,
      rawPhone: null,
      chatId: row.chatId,
      eventAt: new Date(),
      vars: {},
    },
    ctx,
  );

  await logAudit(session!.user.username, 'farmasi_kirim_uji', String(id), row.chatId);
  segarkan();
  return {
    sukses: `Pesan uji dimasukkan ke antrean untuk "${row.label}". Biasanya sampai dalam beberapa detik — periksa halaman Antrean bila tidak.`,
  };
}
