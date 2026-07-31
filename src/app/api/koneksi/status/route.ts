import { NextResponse } from 'next/server';
import { WaSession } from '@/models';
import { requireSession } from '@/lib/authz';

export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  const row = await WaSession.findByPk(1);
  return NextResponse.json({
    status: row?.status ?? 'disconnected',
    qrData: row?.qrData ?? null,
    qrIssuedAt: row?.qrIssuedAt ?? null,
    phoneNumber: row?.phoneNumber ?? null,
    heartbeatAt: row?.heartbeatAt ?? null,
    lastError: row?.lastError ?? null,
  });
}
