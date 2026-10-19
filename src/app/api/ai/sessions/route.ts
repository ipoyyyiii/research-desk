import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { ensureServer } from '@/lib/opencode/service';
import { listSessions, pickActiveSessionId, type SessionSummary } from '@/lib/opencode/session-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Multi-sesi agent (picker Sessions di strip + slash menu composer):
 * GET  /api/ai/sessions?slug=<slug> → { sessionId, sessions } utk dropdown.
 * POST /api/ai/sessions             → { slug, sessionId } ganti sesi aktif
 *                                     (bind baru, history client yang rebuild).
 * Sesi aktif dipegang kolom projects.opencode_session_id — bukan cuma "paling
 * baru" — biar binding bertahan lintas reload dan ganti sesi lama.
 */

/** Daftar sesi directory project untuk picker. Selalu 200, gagal → label kosong. */
export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get('slug') ?? '';
    if (!slug) {
      return NextResponse.json(
        { sessionId: null, sessions: [], error: 'slug wajib ada' },
        { status: 200 },
      );
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { sessionId: null, sessions: [], error: 'Project tidak ditemukan' },
        { status: 200 },
      );
    }
    const project = rows[0];
    const client = await ensureServer();

    let sessions: SessionSummary[] = [];
    try {
      sessions = await listSessions(client, project.folderPath);
    } catch {
      // list gagal → picker kosong; GET tetap 200 biar UI gak ganggu.
    }
    const sessionId = pickActiveSessionId(sessions, project.opencodeSessionId ?? null);
    return NextResponse.json({ sessionId, sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca daftar sesi';
    return NextResponse.json({ sessionId: null, sessions: [], error: message }, { status: 200 });
  }
}

type SwitchBody = { slug?: string; sessionId?: string };

/** Ganti sesi aktif project → persist binding; sesi asing dibolak-balik. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SwitchBody;
    const slug = body.slug ?? '';
    const sessionId = body.sessionId ?? '';
    if (!slug || !sessionId) {
      return NextResponse.json({ error: 'slug dan sessionId wajib ada' }, { status: 400 });
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const project = rows[0];
    const client = await ensureServer();

    // Validasi pakai daftar server — sessionId dari directory lain gak boleh dibind.
    const sessions = await listSessions(client, project.folderPath);
    const target = sessions.find((item) => item.id === sessionId);
    if (!target) {
      return NextResponse.json({ error: 'Sesi gak ada di project ini' }, { status: 404 });
    }

    try {
      await db.update(projects).set({ opencodeSessionId: sessionId }).where(eq(projects.id, project.id));
    } catch {
      // binding gagal tulis → switch tetap berlaku via sesi server, tapi reload
      // bisa balik ke lama; kirim ok supaya UI jalan — DBnya next kali nempel.
    }
    return NextResponse.json({ ok: true, sessionId, title: target.title });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengganti sesi';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
