import { NextResponse } from 'next/server';
import { ensureServer, getAuthState } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Status mesin AI: server hidup? auth tersambung? provider apa aja. */
export async function GET() {
  try {
    await ensureServer();
    const auth = await getAuthState();
    return NextResponse.json({
      service: 'ok',
      connected: auth.connected,
      providers: auth.providers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menghubungi OpenCode';
    return NextResponse.json({ service: 'down', connected: false, providers: [], error: message }, { status: 200 });
  }
}
