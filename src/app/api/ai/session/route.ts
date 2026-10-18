import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { ensureServer } from '@/lib/opencode/service';
import { applyModelToSession } from '@/lib/opencode/model-pick';
import { ensureProjectAgentConfig } from '@/lib/opencode/agent-config';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EnsureBody = { slug?: string };

/**
 * Ensure session agent untuk project (session per project).
 * - Session dicari by directory (folder project) lewat session.list.
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

    // Session per directory — cari yang paling mutakhir (desc order) biar gak dobel.
    try {
      const listed = await client.session.list({ directory: project.folderPath, order: 'desc' });
      const data = Array.isArray(listed?.data) ? listed.data : [];
      const first = data[0];
      if (first?.id) {
        await applyModelToSession(client, first.id).catch(() => undefined);
        return NextResponse.json({ sessionId: first.id, reused: true });
      }
    } catch {
      // list gagal → dianggap belum ada; lanjut buat baru.
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
    return NextResponse.json({ sessionId: id, reused: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyiapkan session agent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
