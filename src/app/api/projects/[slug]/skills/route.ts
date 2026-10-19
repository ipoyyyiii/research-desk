import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { MCP_ERROR_PAYLOAD, McpError, installSkillFromGithub } from '@/lib/opencode/extensions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Pasang skill agent dari repo GitHub ke `<project>/.opencode/skills/`.
 * Clone --depth 1 ke tmp (timeout 60s, tanpa prompt), skill WAJIB punya
 * SKILL.md di root repo, salin isi tanpa `.git/`, tmp dihapus apa pun hasilnya.
 */
const postSchema = z.object({
  url: z.string().min(1).max(1000),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await installSkillFromGithub(rows[0].folderPath, parsed.data.url);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof McpError) {
      const payload = MCP_ERROR_PAYLOAD[error.code];
      return NextResponse.json({ error: payload.error }, { status: payload.status });
    }
    console.error('[api/projects/skills] POST gagal:', error);
    return NextResponse.json({ error: 'mcp.errInstall' }, { status: 500 });
  }
}
