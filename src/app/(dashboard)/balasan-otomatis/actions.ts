'use server';

import { revalidatePath } from 'next/cache';
import { AutoReplyRule, WaCommandAdmin, serializeKeywords, logAudit, setSetting } from '@/models';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { mintaSyncGrup } from '@/lib/waGroups';
import { findUnknownVariables, AUTOREPLY_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { matchRule, normalizeKeyword } from '@/core/autoReply';
import { appendUniqueCode } from '@/core/uniqueCode';
import { loadActiveRules, buildReplyVars } from '@/worker/autoReply';
import { loadUniqueCodeTemplate } from '@/worker/pipeline';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

const VARS_HINT = AUTOREPLY_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

/**
 * Kata kunci diketik staf dipisah koma atau baris baru. Dinormalisasi SEKARANG
 * (saat simpan) memakai fungsi yang sama dengan pencocokan, supaya yang
 * tersimpan persis bentuk yang nanti dibandingkan -- bukan bentuk yang
 * kebetulan mirip.
 */
function parseKeywordInput(raw: string): string[] {
  const seen = new Set<string>();
  for (const potongan of raw.split(/[,\n]/)) {
    const k = normalizeKeyword(potongan);
    if (k) seen.add(k);
  }
  return [...seen];
}

interface RuleInput {
  label: string;
  keywords: string[];
  matchMode: 'contains' | 'exact';
  body: string;
  priority: number;
}

function readForm(formData: FormData): { input?: RuleInput; error?: string } {
  const label = String(formData.get('label') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const keywords = parseKeywordInput(String(formData.get('keywords') ?? ''));
  const matchMode = formData.get('matchMode') === 'exact' ? 'exact' : 'contains';
  const priority = Number(formData.get('priority') ?? 100);

  if (!label) return { error: 'Nama aturan wajib diisi.' };
  if (keywords.length === 0) return { error: 'Isi minimal satu kata kunci.' };

  // Kata kunci satu huruf akan cocok pada hampir setiap kalimat. Ditolak di
  // sini, bukan dibiarkan jadi aturan yang membalas semua pesan masuk lalu
  // membingungkan staf kenapa aturan lain tidak pernah kebagian.
  const terlaluPendek = keywords.filter((k) => k.length < 2);
  if (terlaluPendek.length > 0) {
    return { error: `Kata kunci terlalu pendek: ${terlaluPendek.join(', ')}. Minimal dua huruf.` };
  }

  if (!body) return { error: 'Isi balasan wajib diisi.' };
  if (!Number.isInteger(priority) || priority < 1 || priority > 999) {
    return { error: 'Urutan harus bilangan bulat 1-999.' };
  }

  // Sama seperti dua jenis template lain: variabel tak dikenal ditolak SAAT
  // DISIMPAN, bukan diam-diam jadi string kosong saat pasien menerimanya.
  const unknown = findUnknownVariables(body, AUTOREPLY_TEMPLATE_VARIABLES);
  if (unknown.length > 0) {
    return {
      error: `Variabel tidak dikenal: ${unknown.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${VARS_HINT}`,
    };
  }

  return { input: { label, keywords, matchMode, body, priority } };
}

export async function createRuleAction(
  _prev: { error?: string; ok?: boolean },
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const { input, error } = readForm(formData);
  if (error || !input) return { error };

  if (await AutoReplyRule.findOne({ where: { label: input.label } })) {
    return { error: `Sudah ada aturan bernama "${input.label}".` };
  }

  const created = await AutoReplyRule.create({
    label: input.label,
    keywords: serializeKeywords(input.keywords),
    matchMode: input.matchMode,
    body: input.body,
    priority: input.priority,
    createdBy: session!.user.username,
    updatedBy: null,
  });
  await logAudit(session!.user.username, 'auto_reply_rule_create', String(created.id), input.label);
  revalidatePath('/balasan-otomatis');
  return { ok: true };
}

export async function updateRuleAction(id: number, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const { input, error } = readForm(formData);
  if (error || !input) return { error };

  const row = await AutoReplyRule.findByPk(id);
  if (!row) return { error: 'Aturan tidak ditemukan.' };

  await row.update({
    label: input.label,
    keywords: serializeKeywords(input.keywords),
    matchMode: input.matchMode,
    body: input.body,
    priority: input.priority,
    isActive: formData.get('isActive') === 'on',
    updatedBy: session!.user.username,
    updatedAt: new Date(),
  });
  await logAudit(session!.user.username, 'auto_reply_rule_update', String(id), input.label);
  revalidatePath('/balasan-otomatis');
  return {};
}

export async function deleteRuleAction(id: number): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const row = await AutoReplyRule.findByPk(id);
  if (!row) return;

  await row.destroy();
  await logAudit(session!.user.username, 'auto_reply_rule_delete', String(id), row.label);
  revalidatePath('/balasan-otomatis');
}

/**
 * Sakelar utama. Dicatat ke audit_log karena inilah momen wakhanza berubah
 * dari pengirim satu arah menjadi sistem yang menjawab pasien -- perubahan
 * yang harus bisa ditelusuri siapa yang melakukannya dan kapan.
 */
export async function toggleAutoReplyAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('autoreply.enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'auto_reply_toggle', 'autoreply.enabled', enabled ? 'nyala' : 'mati');
  revalidatePath('/balasan-otomatis');
}

// ---------------------------------------------------------------------------
// PERINTAH LEWAT WHATSAPP (migrations/045)
// ---------------------------------------------------------------------------

export interface HasilPerintahForm {
  error?: string;
  sukses?: string;
}

/**
 * Sakelar fiturnya. Dicatat `audit_log` sebagai peristiwanya sendiri, dengan
 * alasan yang sama yang membuat `toggleAutoReplyAction` begitu: inilah momen
 * `auto_reply_rule` berhenti hanya bisa disunting lewat dashboard yang
 * berautentikasi, dan mulai bisa disunting dari sebuah nomor WhatsApp.
 */
export async function togglePerintahWaAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('autoreply.wa_perintah_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'wa_perintah_toggle',
    'autoreply.wa_perintah_enabled',
    enabled ? 'nyala' : 'mati',
  );
  revalidatePath('/balasan-otomatis');
}

/**
 * Aturan baru dari WhatsApp langsung menyala atau tidak.
 *
 * Sakelar TERSENDIRI dan dicatat terpisah, bukan digabung ke atas: yang satu
 * memutuskan siapa boleh menulis aturan, yang satu memutuskan apakah tulisan
 * itu langsung dibaca pasien tanpa seorang pun meninjau. Yang kedua adalah
 * jawaban atas pertanyaan yang CLAUDE.md catat masih terbuka ("siapa yang
 * meninjau bahwa isi tiap aturan benar secara klinis"), jadi ia harus bisa
 * ditelusuri sendiri.
 */
export async function toggleAktifLangsungAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('autoreply.wa_tambah_aktif_langsung', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'wa_perintah_aktif_langsung',
    'autoreply.wa_tambah_aktif_langsung',
    enabled ? 'langsung aktif' : 'perlu ditinjau',
  );
  revalidatePath('/balasan-otomatis');
}

export async function tambahAdminPerintahAction(
  _prev: HasilPerintahForm,
  formData: FormData,
): Promise<HasilPerintahForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const jenis: JenisTarget = formData.get('jenis') === 'personal' ? 'personal' : 'grup';
  const label = String(formData.get('label') ?? '').trim();
  const nilai = String(formData.get('nilai') ?? '');

  if (!label) return { error: 'Beri nama alamat ini, mis. "HP Kepala Rekam Medis" — supaya bisa dikenali di daftar.' };
  if (label.length > 80) return { error: 'Nama maksimal 80 karakter.' };

  // Validasi alamat DIPAKAI BERSAMA dengan tujuan farmasi/BPJS/ERM, termasuk
  // penolakan tautan undangan grup yang menyebut jalan keluarnya. Menyalinnya
  // ke sini berarti satu tempat lagi yang harus ikut diperbarui saat bentuk JID
  // grup berubah, dan yang tertinggal menolak alamat yang sah tanpa sebab.
  const hasil = parseTarget(jenis, nilai);
  if (!hasil.ok) return { error: hasil.error };

  if (await WaCommandAdmin.findOne({ where: { chatId: hasil.chatId } })) {
    return { error: 'Alamat itu sudah ada di daftar.' };
  }

  const dibuat = await WaCommandAdmin.create({
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
  });
  await logAudit(
    session!.user.username,
    'wa_command_admin_create',
    String(dibuat.id),
    `${hasil.jenis} ${hasil.chatId} (${label})`,
  );
  revalidatePath('/balasan-otomatis');
  return {
    sukses:
      hasil.jenis === 'grup'
        ? `"${label}" ditambahkan. SETIAP anggota grup itu sekarang bisa menulis aturan balasan — tinjau dulu siapa saja yang ada di dalamnya.`
        : `"${label}" ditambahkan. Coba ketik /bantuan dari nomor itu untuk memastikan.`,
  };
}

export async function hapusAdminPerintahAction(id: number): Promise<HasilPerintahForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaCommandAdmin.findByPk(id);
  if (!row) return { error: 'Alamat tidak ditemukan.' };

  await row.destroy();
  await logAudit(session!.user.username, 'wa_command_admin_delete', String(id), `${row.chatId} (${row.label})`);
  revalidatePath('/balasan-otomatis');
  return { sukses: `"${row.label}" dikeluarkan dari daftar.` };
}

export async function toggleAdminPerintahAction(id: number, aktif: boolean): Promise<HasilPerintahForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await WaCommandAdmin.findByPk(id);
  if (!row) return { error: 'Alamat tidak ditemukan.' };

  await row.update({ isActive: aktif });
  await logAudit(
    session!.user.username,
    'wa_command_admin_toggle',
    String(id),
    `${row.label}: ${aktif ? 'aktif' : 'nonaktif'}`,
  );
  revalidatePath('/balasan-otomatis');
  return { sukses: `"${row.label}" ${aktif ? 'diaktifkan' : 'dinonaktifkan'}.` };
}

/**
 * Meminta worker membaca ulang daftar grup. Lewat `lib/waGroups.ts` yang SAMA
 * dipakai `/farmasi` dan `/pesan-masuk` -- dua server action yang sama-sama
 * menulis `wa_session.command` adalah duplikasi yang cepat atau lambat berbeda.
 */
export async function syncGrupPerintahAction(): Promise<HasilPerintahForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const hasil = await mintaSyncGrup(session!.user.username);
  revalidatePath('/balasan-otomatis');
  return hasil;
}

export interface PreviewResult {
  matched: boolean;
  ruleId?: number;
  ruleLabel?: string;
  keyword?: string;
  body?: string;
}

/**
 * Kotak uji coba: "kalau pasien mengetik INI, apa yang dia terima?"
 *
 * Memakai matchRule() dan buildReplyVars() yang SAMA PERSIS dengan worker,
 * lalu menempelkan baris kode unik lewat buildUniqueCodeFooter -- jadi yang
 * tampil di layar adalah pesan utuh yang benar-benar akan terkirim, bukan
 * perkiraannya. Satu-satunya yang tidak terjadi adalah pengirimannya.
 *
 * Tidak menulis apa pun: bukan baris outbox, bukan auto_reply_log, dan tidak
 * memakan kuota nomor mana pun.
 */
export async function previewAutoReplyAction(text: string): Promise<PreviewResult> {
  const { response } = await requireRole('admin');
  if (response) return { matched: false };

  const hit = matchRule(text, await loadActiveRules());
  if (!hit) return { matched: false };

  const identity = await getHospitalIdentity();
  const vars = await buildReplyVars(hit.rule.body, text, identity);
  // appendUniqueCode, bukan merangkai footer sendiri: pemisah antara isi pesan
  // dan baris kode ditentukan di satu tempat saja, jadi pratinjau tidak bisa
  // menyimpang dari pesan sungguhan hanya karena bentuknya berubah kelak.
  // Balasan otomatis melewati jam tenang, jadi waktu kirimnya memang "sekarang".
  const body = appendUniqueCode(
    renderTemplate(hit.rule.body, vars),
    'pratinjau|' + hit.rule.id,
    await loadUniqueCodeTemplate(),
    new Date(),
  );

  return { matched: true, ruleId: hit.rule.id, ruleLabel: hit.rule.label, keyword: hit.keyword, body };
}
