import { NextResponse } from 'next/server';
import { ensureServer } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PermissionBody = {
  sessionId?: string;
  requestId?: string;
  /** "once" = izin sekali, "always" = ingat utk aksi sama, "reject" = tolak */
  decision?: 'once' | 'always' | 'reject';
};

/** Reply permission-request dari agent (klik user di kartu di chat). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PermissionBody;
    if (!body.sessionId || !body.requestId || !body.decision) {
      return NextResponse.json({ error: 'sessionId, requestId, decision wajib ada' }, { status: 400 });
    }
    const client = await ensureServer();
    await client.permission.reply({
      sessionID: body.sessionId,
      requestID: body.requestId,
      decision: body.decision,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memproses izin';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
