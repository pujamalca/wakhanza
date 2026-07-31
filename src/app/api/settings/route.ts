import { NextRequest, NextResponse } from 'next/server';
import { AppSetting, logAudit } from '@/models';
import { requireRole, requireSession } from '@/lib/authz';

const EDITABLE_KEYS = [
  'polling.interval_ms',
  'polling.scan_interval_ms',
  'polling.lookback_days',
  'polling.query_timeout_sec',
  'dispatch.quiet_hours_start',
  'dispatch.quiet_hours_end',
  'dispatch.send_min_delay_ms',
  'dispatch.send_max_delay_ms',
  'dispatch.max_per_hour',
  'dispatch.stale_threshold_hours_default',
  'dispatch.unique_code_enabled',
  'dispatch.unique_code_template',
  'privacy.sensitive_poli_codes',
  'privacy.sensitive_exam_codes',
  'privacy.generic_template',
  'auth.login_max_attempts',
  'auth.login_lockout_minutes',
  'schedule.book_remind_hour',
] as const;

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  const rows = await AppSetting.findAll({ where: { k: EDITABLE_KEYS as unknown as string[] } });
  const map = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  return NextResponse.json({ settings: map, keys: EDITABLE_KEYS });
}

/**
 * IMPLEMENTATION_PLAN Fase 3 DoD (baris literal dari dokumen): "Panggil
 * endpoint pengaturan langsung dengan cookie operator -> 403, bukan 200."
 * requireRole('admin') di sini adalah baris yang diuji itu.
 */
export async function PUT(req: NextRequest) {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body tidak valid' }, { status: 400 });
  }

  const changed: string[] = [];
  for (const key of EDITABLE_KEYS) {
    if (key in body) {
      await AppSetting.upsert({ k: key, v: String(body[key]) });
      changed.push(key);
    }
  }

  await logAudit(session!.user.username, 'settings_update', undefined, changed.join(', '));
  return NextResponse.json({ ok: true, changed });
}
