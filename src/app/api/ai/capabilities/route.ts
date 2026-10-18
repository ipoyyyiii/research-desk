import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import {
  ensureProjectAgentConfig,
  readProjectCapabilities,
  type AgentCapabilities,
} from '@/lib/opencode/agent-config';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Panel "Kemampuan AI" (fase 2.5): toggle websearch + pencarian jurnal.
 * - GET ?slug → toggles sekarang (dibaca dari opencode.json project).
 * - POST { slug, websearch?, literature? } → tulis config + AGENTS.md → balikin state baru.
 * Penyimpanan: file config agent project (OpenCode-native), gak sentuh DB.
 */

const bodySchema = z.object({
  slug: z.string().min(1),
  websearch: z.boolean().optional(),
  literature: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get('slug') ?? '';
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0 || !fs.existsSync(rows[0].folderPath)) {
      return NextResponse.json({ websearch: false, literature: false, error: 'Project tidak ditemukan' }, { status: 200 });
    }
    return NextResponse.json(readProjectCapabilities(rows[0].folderPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca kemampuan AI';
    return NextResponse.json({ websearch: false, literature: false, error: message }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Body gak valid' }, { status: 400 });
    }
    const { slug } = parsed.data;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0 || !fs.existsSync(rows[0].folderPath)) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const current = readProjectCapabilities(rows[0].folderPath);
    const next: Partial<AgentCapabilities> = {
      websearch: parsed.data.websearch ?? current.websearch,
      literature: parsed.data.literature ?? current.literature,
    };
    const saved = ensureProjectAgentConfig(rows[0].folderPath, next);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyimpan kemampuan AI';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
