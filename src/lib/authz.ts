import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { AppUserRole } from '@/models';
import type { Session } from 'next-auth';

/**
 * IMPLEMENTATION_PLAN Fase 3 DoD: otorisasi harus ditegakkan di API, bukan
 * cuma disembunyikan di UI -- "panggil endpoint pengaturan langsung dengan
 * cookie operator -> 403, bukan 200". Dipakai di setiap route handler yang
 * mengubah data, terlepas dari apa yang middleware.ts sudah lakukan.
 */
export async function requireSession(): Promise<{ session: Session | null; response: NextResponse | null }> {
  const session = await auth();
  if (!session?.user) {
    return { session: null, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { session, response: null };
}

export async function requireRole(role: AppUserRole): Promise<{ session: Session | null; response: NextResponse | null }> {
  const { session, response } = await requireSession();
  if (response) return { session: null, response };
  if (session!.user.role !== role) {
    return { session: null, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session, response: null };
}
