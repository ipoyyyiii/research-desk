import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { ensureServer, getAuthState } from '@/lib/opencode/service';
import { ensureProjectAgentConfig } from '@/lib/opencode/agent-config';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EnsureBody = { slug?: string };

/**
 * Ensure session agent untuk project (session per project).
 * - Session dicari by directory (folder project) lewat session.list.
 * - Config persona/izin ditulis idempotent ke <project>/.opencode + AGENTS.md.
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
        return NextResponse.json({ sessionId: first.id, reused: true });
      }
    } catch {
      // list gagal → dianggap belum ada; lanjut buat baru.
    }

    // Model ChatGPT kalau user sudah ter-hubung — fallback model service default.
    const pickModel = async () => {
      try {
        const auth = await getAuthState();
        if (!auth) return undefined;
        const models = (await client.model.list())?.data ?? [];
        const openai = models.find((m) => m.providerID === 'openai');
        if (openai?.id) return { providerID: 'openai' as const, id: openai.id };
      } catch {
        return undefined;
      }
      return undefined;
    };
    const model = await pickModel();

    const created = await client.session.create({
      title: `Skripsi — ${project.name}`,
      agent: 'thesis',
      location: { directory: project.folderPath },
      ...(model ? { model } : {}),
    });
    const id = created.id;
    if (!id) {
      return NextResponse.json({ error: 'Server gak balikin id session' }, { status: 500 });
    }
    return NextResponse.json({ sessionId: id, reused: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyiapkan session agent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
