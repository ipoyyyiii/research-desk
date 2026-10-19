import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, settings } from '@/lib/db/schema';
import { ensureServer } from '@/lib/opencode/service';
import { applyModelToSession } from '@/lib/opencode/model-pick';
import { buildDossier } from '@/lib/opencode/agent-config';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PromptBody = {
  slug?: string;
  sessionId?: string;
  text?: string;
  /** file yang sedang terbuka di editor (konteks aktif) */
  activeFilePath?: string | null;
};

/**
 * Kirim prompt ke session agent.
 * Dossier konteks project di-build server-side (baca tree) supaya user tak perlu mengulang.
 * Balasan mengalir lewat event bus — dibaca klien via /api/ai/stream.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PromptBody;
    const slug = body.slug ?? '';
    const sessionId = body.sessionId ?? '';
    const text = (body.text ?? '').trim();
    if (!slug || !sessionId || !text) {
      return NextResponse.json({ error: 'slug, sessionId, dan text wajib ada' }, { status: 400 });
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const project = rows[0];

    const dossier = await buildDossier({
      slug,
      title: project.name,
      folderRealPath: project.folderPath,
      activeFilePath: body.activeFilePath ?? null,
    });

    const client = await ensureServer();

    // Effort tersimpan (variant model ASLI ala OpenCode) — diplom Bareng model
    // ke session sebelum prompt. null/'auto' → variant bawaan, nggak diset.
    let effortVariant: string | null = null;
    try {
      const options = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
      const raw = options[0]?.effort ?? null;
      if (raw && raw !== 'auto') effortVariant = raw;
    } catch {
      effortVariant = null; // baca settings gagal → model default aja
    }

    // Model jujur: override picker > auto-ChatGPT > default service (+ variant effort).
    try {
      await applyModelToSession(client, sessionId, effortVariant);
    } catch {
      // biarkan model yang sudah ter-set
    }

    const composed = `${dossier}\n\n[PERINTAH USER]\n${text}`;

    // Attachment file aktif (format URI biar agent tau konteks file yang terbuka).
    let files: Array<{ uri: string; name?: string }> | undefined;
    if (body.activeFilePath) {
      const abs = path.join(project.folderPath, body.activeFilePath);
      try {
        await fsp.access(abs);
        files = [{ uri: `file://${abs}`, name: path.basename(abs) }];
      } catch {
        files = undefined;
      }
    }

    await client.session.prompt({
      sessionID: sessionId,
      text: composed,
      ...(files ? { files } : {}),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengirim ke agent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
