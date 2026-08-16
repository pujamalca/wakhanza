'use server';

import { revalidatePath } from 'next/cache';
import { Op } from 'sequelize';
import {
  AutoReplyRule,
  WaForm,
  WaFormField,
  WaFormEntry,
  parseKeywords,
  serializeKeywords,
  getSetting,
  setSetting,
  logAudit,
} from '@/models';
import { matchRule, normalizeKeyword, type MatchableRule } from '@/core/autoReply';
import { parseStokKeywords } from '@/core/stokObat';
import { isTipeField, MAKS_PERTANYAAN, type TipeField } from '@/core/waFormulir';
import { requireRole } from '@/lib/authz';

type Hasil = { error?: string; ok?: boolean };

const MAKS_NAMA = 80;
const MAKS_LABEL_FIELD = 200;
const MIN_PANJANG_KATA_KUNCI = 2;

/**
 * Kata kunci diketik staf dipisah koma atau baris baru. Dinormalisasi SEKARANG
 * memakai fungsi yang sama dipakai pencocokan, supaya yang tersimpan persis
 * bentuk yang nanti dibandingkan -- bukan bentuk yang kebetulan mirip. Sama
 * persis dengan `parseKeywordInput` di `/balasan-otomatis`.
 */
function uraikanKataKunci(mentah: string): string[] {
  const terlihat = new Set<string>();
  for (const potongan of mentah.split(/[,\n]/)) {
    const k = normalizeKeyword(potongan);
    if (k) terlihat.add(k);
  }
  return [...terlihat];
}

interface FieldInput {
  label: string;
  tipe: TipeField;
  wajib: boolean;
  pilihan: string[];
  maksPanjang: number;
}

interface FormInput {
  nama: string;
  kataKunci: string[];
  matchMode: 'contains' | 'exact';
  priority: number;
  pesanPembuka: string;
  pesanPenutup: string;
  bolehGrup: boolean;
  fields: FieldInput[];
}

/**
 * Membaca daftar pertanyaan dari larik-larik sejajar (`formData.getAll`).
 *
 * `wajib` sengaja `<select>` berisi ya/tidak, BUKAN checkbox, dan itu bukan
 * selera: checkbox yang tidak dicentang sama sekali tidak ikut terkirim, jadi
 * larik `f_wajib` akan lebih pendek daripada `f_label` dan seluruh nilai
 * sesudah pertanyaan pertama yang tidak dicentang BERGESER satu -- pertanyaan
 * ketiga mewarisi kewajiban pertanyaan keempat, tanpa satu pun galat. Dengan
 * `<select>` panjang keempat lariknya dijamin sama.
 */
function bacaFields(formData: FormData): FieldInput[] | { error: string } {
  const labels = formData.getAll('f_label').map((v) => String(v).trim());
  const tipes = formData.getAll('f_tipe').map((v) => String(v));
  const wajibs = formData.getAll('f_wajib').map((v) => String(v));
  const pilihans = formData.getAll('f_pilihan').map((v) => String(v));
  const makss = formData.getAll('f_maks').map((v) => String(v));

  if (
    tipes.length !== labels.length ||
    wajibs.length !== labels.length ||
    pilihans.length !== labels.length ||
    makss.length !== labels.length
  ) {
    // Hanya lahir dari HTML yang dirusak atau dari kiriman yang tidak lewat
    // halaman ini. Ditolak apa adanya alih-alih diselaraskan dengan menebak --
    // menebak di sini berarti pertanyaan dipasangkan dengan tipe yang salah.
    return { error: 'Data pertanyaan tidak lengkap. Muat ulang halaman lalu coba lagi.' };
  }

  const hasil: FieldInput[] = [];
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    // Baris kosong dibuang, bukan ditolak: staf menambah baris lalu berubah
    // pikiran, dan memaksanya menekan tombol hapus untuk baris yang memang
    // kosong cuma menambah satu langkah tanpa menjaga apa pun.
    if (!label) continue;

    if (label.length > MAKS_LABEL_FIELD) {
      return { error: `Pertanyaan ${i + 1} kepanjangan (${label.length} huruf, maksimal ${MAKS_LABEL_FIELD}).` };
    }

    const tipeMentah = tipes[i]!;
    const tipe: TipeField = isTipeField(tipeMentah) ? tipeMentah : 'teks';
    const pilihan = pilihans[i]!
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (tipe === 'pilihan' && pilihan.length < 2) {
      return { error: `Pertanyaan ${i + 1} bertipe pilihan, jadi isi minimal dua pilihan.` };
    }

    const maksPanjang = Number(makss[i] || 0);
    if (!Number.isInteger(maksPanjang) || maksPanjang < 0 || maksPanjang > 4000) {
      return { error: `Batas panjang pertanyaan ${i + 1} harus 0-4000 (0 = pakai bawaan).` };
    }

    hasil.push({ label, tipe, wajib: wajibs[i] !== 'tidak', pilihan, maksPanjang });
  }
  return hasil;
}

function bacaForm(formData: FormData): { input?: FormInput; error?: string } {
  const nama = String(formData.get('nama') ?? '').trim();
  const kataKunci = uraikanKataKunci(String(formData.get('kataKunci') ?? ''));
  const matchMode = formData.get('matchMode') === 'exact' ? 'exact' : 'contains';
  const priority = Number(formData.get('priority') ?? 100);
  const pesanPembuka = String(formData.get('pesanPembuka') ?? '').trim();
  const pesanPenutup = String(formData.get('pesanPenutup') ?? '').trim();
  const bolehGrup = formData.get('bolehGrup') === 'on';

  if (!nama) return { error: 'Nama formulir wajib diisi.' };
  if (nama.length > MAKS_NAMA) {
    return { error: `Nama formulir kepanjangan (${nama.length} huruf, maksimal ${MAKS_NAMA}).` };
  }
  if (kataKunci.length === 0) return { error: 'Isi minimal satu kata kunci.' };

  const pendek = kataKunci.filter((k) => k.length < MIN_PANJANG_KATA_KUNCI);
  if (pendek.length > 0) {
    return { error: `Kata kunci terlalu pendek: ${pendek.join(', ')}. Minimal ${MIN_PANJANG_KATA_KUNCI} huruf.` };
  }

  if (!Number.isInteger(priority) || priority < 1 || priority > 999) {
    return { error: 'Urutan harus bilangan bulat 1-999.' };
  }

  /**
   * Kalimat penutup WAJIB, dan ini satu-satunya kotak teks di halaman ini yang
   * begitu.
   *
   * Ia satu-satunya tempat yang mengatakan APA YANG TERJADI BERIKUTNYA. Tanpa
   * itu pasien menyerahkan permintaannya lalu menerima daftar isian kembali dan
   * tidak ada kalimat apa pun -- ia tidak tahu apakah ada yang membacanya, kapan,
   * dan apa yang harus dilakukannya kalau tidak ada kabar. Formulir seperti itu
   * bukan layanan melainkan penampung, dan yang menanggung akibatnya loket yang
   * ditelepon menanyakannya.
   */
  if (!pesanPenutup) {
    return { error: 'Kalimat penutup wajib diisi — di sanalah pasien diberi tahu apa yang terjadi berikutnya.' };
  }

  const fields = bacaFields(formData);
  if ('error' in fields) return { error: fields.error };
  if (fields.length === 0) return { error: 'Isi minimal satu pertanyaan.' };
  if (fields.length > MAKS_PERTANYAAN) {
    return { error: `Terlalu banyak pertanyaan (${fields.length}, maksimal ${MAKS_PERTANYAAN}).` };
  }

  return { input: { nama, kataKunci, matchMode, priority, pesanPembuka, pesanPenutup, bolehGrup, fields } };
}

/**
 * Kata kunci yang akan MENGAMBIL ALIH dari sesuatu yang sudah menjawab.
 *
 * Arahnya penting dan gampang terbalik: formulir diperiksa SEBELUM cabang
 * persediaan dan sebelum aturan `/balasan-otomatis`, jadi yang kalah bukan
 * formulirnya melainkan yang sudah ada. Kata kunci "jadwal" di sini akan
 * mendiamkan aturan "jadwal dokter" yang sedang berjalan -- dan yang terlihat
 * bukan galat melainkan pasien yang bertanya jadwal lalu tiba-tiba ditanyai
 * pertanyaan formulir.
 *
 * Karena itu DITOLAK, bukan sekadar diperingatkan seperti tabrakan antar aturan
 * di `/balasan-otomatis`. Di sana kedua sisi punya `priority` yang bisa diatur
 * staf di satu halaman; di sini urutannya dipaku di kode dan tidak ada satu pun
 * setelan yang bisa membalikkannya sesudah tersimpan.
 */
async function tabrakanKataKunci(
  kataKunci: readonly string[],
  kecualiFormId: number | null,
): Promise<string | null> {
  // --- aturan balasan otomatis yang AKTIF ---------------------------------
  const rules = await AutoReplyRule.findAll({ where: { isActive: true } });
  const aturan: (MatchableRule & { label: string })[] = rules.map((r) => ({
    id: r.id,
    label: r.label,
    keywords: parseKeywords(r.keywords),
    matchMode: r.matchMode,
    priority: r.priority,
  }));
  for (const k of kataKunci) {
    const cocok = matchRule(k, aturan);
    if (cocok) {
      return `Kata kunci "${k}" sudah dijawab aturan balasan otomatis "${cocok.rule.label}". Formulir diperiksa lebih dulu, jadi menyimpannya akan membuat aturan itu berhenti menjawab. Ganti kata kuncinya, atau ubah aturan tersebut.`;
    }
  }

  // --- kata kunci persediaan ----------------------------------------------
  const [ketat, longgar, frasa] = await Promise.all([
    getSetting('farmasi.stok_keywords', 'stok,harga'),
    getSetting('farmasi.stok_keywords_ketersediaan', ''),
    getSetting('farmasi.darurat_keywords', ''),
  ]);
  const persediaan = new Set([
    ...parseStokKeywords(ketat ?? ''),
    ...parseStokKeywords(longgar ?? ''),
    ...parseStokKeywords(frasa ?? ''),
  ]);
  for (const k of kataKunci) {
    if (persediaan.has(k)) {
      return `Kata kunci "${k}" dipakai balasan stok/persediaan di halaman Farmasi. Formulir diperiksa lebih dulu, jadi pertanyaan stok dengan kata itu akan berhenti dijawab.`;
    }
  }

  // --- formulir lain yang AKTIF -------------------------------------------
  const lain = await WaForm.findAll({
    where: { isActive: true, ...(kecualiFormId ? { id: { [Op.ne]: kecualiFormId } } : {}) },
  });
  const daftarLain: (MatchableRule & { nama: string })[] = lain.map((f) => ({
    id: f.id,
    nama: f.nama,
    keywords: parseKeywords(f.kataKunci),
    matchMode: f.matchMode === 'exact' ? 'exact' : 'contains',
    priority: f.priority,
  }));
  for (const k of kataKunci) {
    const cocok = matchRule(k, daftarLain);
    if (cocok) {
      return `Kata kunci "${k}" sudah dipakai formulir "${cocok.rule.nama}". Hanya satu yang akan pernah berjalan.`;
    }
  }

  return null;
}

/** Menulis ulang seluruh pertanyaan satu formulir. */
async function tulisFields(formId: number, fields: readonly FieldInput[]): Promise<void> {
  await WaFormField.destroy({ where: { formId } });
  await WaFormField.bulkCreate(
    fields.map((f, i) => ({
      formId,
      urutan: i + 1,
      label: f.label,
      tipe: f.tipe,
      pilihanJson: f.tipe === 'pilihan' ? JSON.stringify(f.pilihan) : null,
      wajib: f.wajib,
      maksPanjang: f.maksPanjang,
    })),
  );
}

export async function createFormAction(_prev: Hasil, formData: FormData): Promise<Hasil> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const { input, error } = bacaForm(formData);
  if (error || !input) return { error };

  if (await WaForm.findOne({ where: { nama: input.nama } })) {
    return { error: `Sudah ada formulir bernama "${input.nama}".` };
  }
  const bentrok = await tabrakanKataKunci(input.kataKunci, null);
  if (bentrok) return { error: bentrok };

  const dibuat = await WaForm.create({
    nama: input.nama,
    kataKunci: serializeKeywords(input.kataKunci),
    matchMode: input.matchMode,
    priority: input.priority,
    pesanPembuka: input.pesanPembuka,
    pesanPenutup: input.pesanPenutup,
    // Formulir baru lahir NONAKTIF, dengan alasan yang sama yang membuat aturan
    // dari WhatsApp lahir nonaktif (045): yang mengetiknya harus sempat membaca
    // ulang apa yang akan ditanyakan kepada pasien sungguhan.
    isActive: false,
    bolehGrup: input.bolehGrup,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await tulisFields(dibuat.id, input.fields);
  await logAudit(session!.user.username, 'wa_form_create', String(dibuat.id), input.nama);

  revalidatePath('/formulir');
  return { ok: true };
}

export async function updateFormAction(_prev: Hasil, formData: FormData): Promise<Hasil> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const id = Number(formData.get('id'));
  const row = await WaForm.findByPk(id);
  if (!row) return { error: 'Formulir itu sudah tidak ada.' };

  const { input, error } = bacaForm(formData);
  if (error || !input) return { error };

  const kembar = await WaForm.findOne({ where: { nama: input.nama, id: { [Op.ne]: id } } });
  if (kembar) return { error: `Sudah ada formulir bernama "${input.nama}".` };

  // Hanya diperiksa bila formulirnya sedang AKTIF: yang nonaktif tidak menjawab
  // apa pun, jadi tabrakannya belum berlaku dan menolak suntingannya cuma
  // menghalangi orang menyiapkan formulir yang belum dinyalakan.
  if (row.isActive) {
    const bentrok = await tabrakanKataKunci(input.kataKunci, id);
    if (bentrok) return { error: bentrok };
  }

  await row.update({
    nama: input.nama,
    kataKunci: serializeKeywords(input.kataKunci),
    matchMode: input.matchMode,
    priority: input.priority,
    pesanPembuka: input.pesanPembuka,
    pesanPenutup: input.pesanPenutup,
    bolehGrup: input.bolehGrup,
    updatedBy: session!.user.username,
    updatedAt: new Date(),
  });
  await tulisFields(id, input.fields);
  await logAudit(session!.user.username, 'wa_form_update', String(id), input.nama);

  revalidatePath('/formulir');
  return { ok: true };
}

export async function toggleFormAction(id: number, aktif: boolean): Promise<Hasil> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaForm.findByPk(id);
  if (!row) return { error: 'Formulir itu sudah tidak ada.' };

  if (aktif) {
    /**
     * Formulir tanpa pertanyaan tidak pernah dicocokkan (`cocokFormulir()`
     * menyaringnya), jadi menyalakannya menghasilkan sakelar bercentang yang
     * tidak pernah menjawab apa pun -- gagal DIAM, dan persis kelas kegagalan
     * yang paling mahal di proyek ini. Ditolak di sini, di depan orang yang
     * bisa membetulkannya.
     */
    const jumlah = await WaFormField.count({ where: { formId: id } });
    if (jumlah === 0) {
      return { error: 'Formulir ini belum punya pertanyaan, jadi tidak akan pernah menjawab. Tambahkan dulu.' };
    }
    const bentrok = await tabrakanKataKunci(parseKeywords(row.kataKunci), id);
    if (bentrok) return { error: bentrok };
  }

  await row.update({ isActive: aktif, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(session!.user.username, aktif ? 'wa_form_enable' : 'wa_form_disable', String(id), row.nama);

  revalidatePath('/formulir');
  return { ok: true };
}

export async function deleteFormAction(id: number): Promise<Hasil> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaForm.findByPk(id);
  if (!row) return { error: 'Formulir itu sudah tidak ada.' };

  /**
   * Jawaban yang sudah masuk SENGAJA tidak ikut terhapus, dan tidak ada foreign
   * key yang membuatnya begitu.
   *
   * Keduanya menjawab pertanyaan yang berbeda: formulir adalah konfigurasi yang
   * boleh usang, jawaban adalah catatan tentang apa yang diminta seseorang.
   * Menghapus yang pertama sampai ikut membuang yang kedua berarti satu tindakan
   * konfigurasi menghapus permintaan pasien yang mungkin belum ditindaklanjuti.
   * Barisnya tetap terbaca utuh karena nama formulir dan seluruh pertanyaannya
   * sudah DIBEKUKAN ke dalamnya.
   */
  await WaFormField.destroy({ where: { formId: id } });
  await row.destroy();
  await logAudit(session!.user.username, 'wa_form_delete', String(id), row.nama);

  revalidatePath('/formulir');
  return { ok: true };
}

export async function updateEntryAction(
  id: number,
  status: 'baru' | 'diproses' | 'selesai' | 'batal',
  catatan: string,
): Promise<Hasil> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaFormEntry.findByPk(id);
  if (!row) return { error: 'Jawaban itu sudah tidak ada — mungkin sudah lewat masa simpannya.' };

  /**
   * SIAPA dan KAPAN dicatat di barisnya sendiri, bukan di `audit_log`.
   *
   * Menandai satu permintaan sudah diproses adalah pekerjaan rutin yang terjadi
   * berkali-kali sehari; menuliskannya ke `audit_log` akan menenggelamkan
   * perubahan KONFIGURASI yang justru jadi alasan tabel itu ada. Kolom di sini
   * menjawab pertanyaan yang sama dengan lebih tepat, dan ia terlihat tepat di
   * sebelah permintaannya.
   */
  await row.update({
    status,
    catatan: catatan.trim() || null,
    ditanganiOleh: session!.user.username,
    ditanganiAt: new Date(),
  });

  revalidatePath('/formulir');
  return { ok: true };
}

export async function toggleFormulirAction(aktif: boolean): Promise<Hasil> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  /**
   * Lewat aksi tersendiri, SENGAJA bukan `/api/settings`, supaya ia tercatat di
   * `audit_log` sebagai peristiwanya sendiri alih-alih tenggelam sebagai satu
   * nama kunci di dalam `settings_update`. Pola yang sama dengan
   * `toggleAutoReplyAction`.
   */
  await setSetting('formulir.enabled', aktif ? '1' : '0');
  await logAudit(session!.user.username, 'formulir_toggle', 'formulir.enabled', aktif ? 'menyala' : 'mati');

  revalidatePath('/formulir');
  return { ok: true };
}
