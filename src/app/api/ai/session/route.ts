import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { ensureServer } from '@/lib/opencode/service';
import { applyModelToSession } from '@/lib/opencode/model-pick';
import { ensureProjectAgentConfig } from '@/lib/opencode/agent-config';
import { listSessions, pickActiveSessionId } from '@/lib/opencode/session-list';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EnsureBody = { slug?: string; createNew?: boolean };

function bindSession(projectId: number, sessionId: string) {
  try {
    void db.update(projects).set({ opencodeSessionId: sessionId }).where(eq(projects.id, projectId));
  } catch {
    // binding gagal tulis tidak blokir ensure — sesi tetap ada di server.
  }
}

/**
 * Ensure session agent untuk project (multi-sesi per project):
 * - Binding tersimpan (projects.opencode_session_id) dipakai duluan kalau masih
 *   ada di server → user balik ke sesi yang sama, bukan "paling baru" lawas.
 * - createNew: true (picker "Sesi baru") → selalu bikin session fresh + bind.
 * - Config persona/izin ditulis idempotent ke <project>/.opencode + AGENTS.md.
 * - Model di-apply sesuai aturan model-pick (override > auto ChatGPT > default).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EnsureBody;
    const slug = body.slug ?? '';
    if (!slug) {
      return NextResponse.json({ error: 'slug wajib ada' }, { status: 400 });
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const project = rows[0];
    if (!fs.existsSync(project.folderPath)) {
      return NextResponse.json({ error: 'Folder project tidak ada di disk' }, { status: 400 });
    }

    const client = await ensureServer();
    ensureProjectAgentConfig(project.folderPath);

    // Pakai sesi existing (binding dulu, lalu terbaru) — kecuali minta sesi baru.
    if (body.createNew !== true) {
      try {
        const sessions = await listSessions(client, project.folderPath);
        const id = pickActiveSessionId(sessions, project.opencodeSessionId ?? null);
        if (id) {
          await applyModelToSession(client, id).catch(() => undefined);
          bindSession(project.id, id);
          return NextResponse.json({ sessionId: id, reused: true });
        }
      } catch {
        // list gagal → dianggap belum ada; lanjut buat baru.
      }
    }

    const created = await client.session.create({
      title: `Skripsi — ${project.name}`,
      agent: 'thesis',
      location: { directory: project.folderPath },
    });
    const id = created.id;
    if (!id) {
      return NextResponse.json({ error: 'Server gak balikin id session' }, { status: 500 });
    }
    await applyModelToSession(client, id).catch(() => undefined);
    bindSession(project.id, id);
    return NextResponse.json({ sessionId: id, reused: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyiapkan session agent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
