import { NextRequest, NextResponse } from 'next/server';
import { WaSession, logAudit } from '@/models';
import { requireRole } from '@/lib/authz';

/**
 * ARCHITECTURE §1: dashboard tidak pernah memanggil worker lewat HTTP --
 * perintah dititip lewat wa_session.command, worker membacanya lalu
 * mengosongkannya. Admin-only: mengganggu sesi WA memutus notifikasi
 * seluruh RS, di luar wewenang "operator" (§9.1).
 */
export async function POST(req: NextRequest) {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const command = body?.command;
  if (command !== 'reconnect' && command !== 'logout') {
    return NextResponse.json({ error: 'command harus reconnect atau logout' }, { status: 400 });
  }

  await WaSession.update({ command }, { where: { id: 1 } });
  await logAudit(session!.user.username, `wa_session_${command}`);

  return NextResponse.json({ ok: true });
}
