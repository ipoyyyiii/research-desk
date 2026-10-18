import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { ensureServer } from '@/lib/opencode/service';
import { buildHistory } from '@/lib/opencode/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Riwayat chat project (session per project):
 * GET /api/ai/messages?slug=<slug>
 * Cuma baca — session existing TERAKHIR (order desc), gak bikin session baru.
 * Selalu 200 dgn session/messages walau gagal, biar UI gak megangang.
 */
export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get('slug') ?? '';
    if (!slug) {
      return NextResponse.json({ sessionId: null, messages: [], error: 'slug wajib ada' }, { status: 200 });
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ sessionId: null, messages: [], error: 'Project tidak ditemukan' }, { status: 200 });
    }
    const project = rows[0];

    const client = await ensureServer();

    // Pola sama dgn route session: list by directory, ambil yang paling mutakhir.
    const listed = await client.session.list({ directory: project.folderPath, order: 'desc' });
    const data = Array.isArray(listed?.data) ? listed.data : [];
    const sessionId = data[0]?.id ?? null;
    if (!sessionId) {
      // Belum ada session → riwayat kosong, bukan error.
      return NextResponse.json({ sessionId: null, messages: [] });
    }

    const history = await buildHistory(client, sessionId);
    return NextResponse.json({ sessionId, messages: history.messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca riwayat chat';
    return NextResponse.json({ sessionId: null, messages: [], error: message }, { status: 200 });
  }
}
