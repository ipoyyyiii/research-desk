import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { ensureServer } from '@/lib/opencode/service';
import { buildHistory } from '@/lib/opencode/history';
import { listSessions, pickActiveSessionId } from '@/lib/opencode/session-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Token meter project (session per project):
 * GET /api/ai/usage?slug=<slug>
 * Sumber data sama dgn /messages (buildHistory), cuma ringkasan angka.
 * Selalu 200 dgn tokens null kalau gagal — UI jujur " belum ada data", gak fake.
 */
export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get('slug') ?? '';
    if (!slug) {
      return NextResponse.json(
        { sessionId: null, tokens: null, messageCount: 0, error: 'slug wajib ada' },
        { status: 200 },
      );
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { sessionId: null, tokens: null, messageCount: 0, error: 'Project tidak ditemukan' },
        { status: 200 },
      );
    }
    const project = rows[0];

    const client = await ensureServer();

    // Sesi aktif = binding project dulu, fallback sesi terbaru — ikut route session/messages.
    const sessions = await listSessions(client, project.folderPath);
    const sessionId = pickActiveSessionId(sessions, project.opencodeSessionId ?? null);
    if (!sessionId) {
      return NextResponse.json({ sessionId: null, tokens: null, messageCount: 0 });
    }

    const history = await buildHistory(client, sessionId);
    return NextResponse.json({ sessionId, tokens: history.tokens, messageCount: history.messages.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca penggunaan token';
    return NextResponse.json({ sessionId: null, tokens: null, messageCount: 0, error: message }, { status: 200 });
  }
}
