'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/authz';
import { fetchPatientSegment } from '@/khanza/pasienSegment';
import { scheduleFiltersToSegment, isFollowupSchedule } from '@/khanza/broadcastSchedule';
import { findUnknownVariables, BROADCAST_TEMPLATE_VARIABLES } from '@/core/template';
import { computeNextRunAt, type RepeatKind } from '@/core/schedule';
import { BroadcastSchedule, logAudit } from '@/models';
import { parseScheduleFilters, type RawFilterInput } from './filters';

const REPEAT_KINDS: RepeatKind[] = ['once', 'daily', 'weekly', 'monthly'];

/**
 * Pola sama seperti sendBroadcastAction (broadcast/actions.ts): admin-only,
 * filter DIURAI ULANG dari FormData lewat parseScheduleFilters yang SAMA
 * dipakai halaman GET untuk pratinjau -- bukan dipercaya dari klien. Bedanya
 * di sini TIDAK langsung mengirim, cuma menyimpan definisi jadwal --
 * pengiriman sungguhan tugas worker/broadcastScheduleRunner.ts saat
 * next_run_at jatuh tempo.
 */
export async function createScheduleAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Nama jadwal wajib diisi.' };

  const messageBody = String(formData.get('messageBody') ?? '').trim();
  if (!messageBody) return { error: 'Isi pesan wajib diisi.' };

  const unknown = findUnknownVariables(messageBody, BROADCAST_TEMPLATE_VARIABLES);
  if (unknown.length > 0) {
    return { error: `Variabel tidak dikenal untuk broadcast: ${unknown.map((v) => `{${v}}`).join(', ')}` };
  }

  const repeatKind = String(formData.get('repeatKind') ?? '') as RepeatKind;
  if (!REPEAT_KINDS.includes(repeatKind)) return { error: 'Pola pengulangan tidak valid.' };

  const timeOfDay = String(formData.get('timeOfDay') ?? '09:00');
  let dayOfWeek: number | null = null;
  let dayOfMonth: number | null = null;
  let runOnceAt: Date | null = null;

  if (repeatKind === 'weekly') {
    dayOfWeek = Number(formData.get('dayOfWeek'));
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { error: 'Pilih hari untuk pola mingguan.' };
    }
  } else if (repeatKind === 'monthly') {
    dayOfMonth = Number(formData.get('dayOfMonth'));
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      return { error: 'Tanggal bulanan harus antara 1-28 (dibatasi supaya selalu valid di semua bulan, termasuk Februari).' };
    }
  } else if (repeatKind === 'once') {
    const raw = String(formData.get('runOnceAt') ?? '');
    const parsed = new Date(raw);
    if (!raw || Number.isNaN(parsed.getTime())) {
      return { error: 'Tanggal dan jam kirim wajib diisi untuk pola sekali.' };
    }
    runOnceAt = parsed;
  }

  const stopAfterDateRaw = String(formData.get('stopAfterDate') ?? '');
  // T00:00:00 tanpa akhiran zona waktu SENGAJA (bukan berlebihan) -- string
  // tanggal telanjang ("2026-08-15") diuraikan sebagai UTC tengah malam oleh
  // spesifikasi ECMAScript, bukan tengah malam lokal, dan bisa meleset
  // beberapa jam dari yang dipilih staf. Pola sama seperti broadcast/filters.ts's parseDate.
  const stopAfterDate = stopAfterDateRaw ? new Date(`${stopAfterDateRaw}T00:00:00`) : null;

  const nextRunAt = computeNextRunAt({ repeatKind, timeOfDay, dayOfWeek, dayOfMonth, runOnceAt }, new Date());
  if (!nextRunAt) {
    return { error: 'Waktu jalan berikutnya tidak valid atau sudah lewat -- periksa kembali tanggal/jam.' };
  }

  // Field baru di filter WAJIB ditambahkan di sini juga: objek ini dibangun
  // satu per satu dari FormData, bukan diteruskan apa adanya -- filter yang
  // lupa didaftarkan akan benar di pratinjau tapi diam-diam hilang saat
  // jadwalnya disimpan.
  const raw: RawFilterInput = {
    windowMode: String(formData.get('windowMode') ?? ''),
    offset: String(formData.get('offset') ?? ''),
    lookback: String(formData.get('lookback') ?? ''),
    kab: formData.getAll('kab').map(String),
    kec: formData.getAll('kec').map(String),
    pj: formData.getAll('pj').map(String),
    cari: String(formData.get('cari') ?? ''),
  };
  const filterConfig = parseScheduleFilters(raw);

  // Pemeriksaan kewarasan SEKALI di awal (bukan jaminan tiap kali jalan --
  // segmen dihitung ulang saat itu juga oleh worker, bisa berubah seiring
  // waktu) supaya staf tidak menyimpan jadwal yang filternya jelas 0 hasil.
  //
  // TIDAK berlaku untuk mode tindak lanjut: jendelanya cuma SATU hari
  // kalender, jadi nol hasil hari ini sering wajar belaka (hari libur, atau
  // H+N kebetulan jatuh di hari sepi) dan sama sekali bukan tanda filternya
  // keliru. Menolak simpan di situ akan membuat jadwal yang benar mustahil
  // dibuat pada hari yang salah.
  const preview = await fetchPatientSegment(scheduleFiltersToSegment(filterConfig));
  if (preview.length === 0 && !isFollowupSchedule(filterConfig)) {
    return { error: 'Tidak ada pasien yang cocok dengan filter ini saat ini -- periksa kembali filter sebelum menyimpan jadwal.' };
  }

  const schedule = await BroadcastSchedule.create({
    name,
    createdBy: session!.user.username,
    filterJson: JSON.stringify(filterConfig),
    messageBody,
    repeatKind,
    timeOfDay,
    dayOfWeek,
    dayOfMonth,
    runOnceAt,
    stopAfterDate,
    isActive: true,
    nextRunAt,
  });

  await logAudit(session!.user.username, 'broadcast_schedule_create', String(schedule.id), name);
  revalidatePath('/broadcast-terjadwal');
  redirect('/broadcast-terjadwal?created=1');
}

export async function toggleScheduleAction(id: number, isActive: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const schedule = await BroadcastSchedule.findByPk(id);
  if (!schedule) return;

  const now = new Date();
  // Mengaktifkan kembali jadwal yang next_run_at-nya sudah lewat/kosong (mis.
  // 'once' yang sudah selesai, atau nonaktif lama) perlu menghitung ulang
  // dari SEKARANG -- bukan memakai next_run_at lama yang mungkin sudah lewat
  // jauh (yang akan membuatnya langsung dianggap jatuh tempo saat diaktifkan).
  const nextRunAt = isActive
    ? schedule.nextRunAt && schedule.nextRunAt > now
      ? schedule.nextRunAt
      : computeNextRunAt(
          {
            repeatKind: schedule.repeatKind,
            timeOfDay: schedule.timeOfDay,
            dayOfWeek: schedule.dayOfWeek,
            dayOfMonth: schedule.dayOfMonth,
            runOnceAt: schedule.runOnceAt,
          },
          now,
        )
    : schedule.nextRunAt;

  await schedule.update({ isActive, nextRunAt });
  await logAudit(
    session!.user.username,
    isActive ? 'broadcast_schedule_activate' : 'broadcast_schedule_pause',
    String(id),
    schedule.name,
  );
  revalidatePath('/broadcast-terjadwal');
}

export async function deleteScheduleAction(id: number): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const schedule = await BroadcastSchedule.findByPk(id);
  if (!schedule) return;

  await schedule.destroy();
  await logAudit(session!.user.username, 'broadcast_schedule_delete', String(id), schedule.name);
  revalidatePath('/broadcast-terjadwal');
}
