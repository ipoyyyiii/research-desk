import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import {
  MCP_ERROR_PAYLOAD,
  addMcp,
  listMcp,
  listSkills,
  readOpencodeConfig,
  removeMcp,
  toggleMcp,
  McpError,
} from '@/lib/opencode/extensions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * MCP servers & skills per project (config jalan saat sesi chat baru — tanpa
 * restart service):
 *  - GET  : daftar MCP (config di `.opencode/opencode.json`) + skills terpasang
 *           (folder `.opencode/skills/`). Nilai environment/headers gak
 *           dibalikin — bisa berisi secrets.
 *  - PUT  : aksi add / enable / disable / remove MCP (blok `mcp` di-update
 *           merge-preserve — key config lain kejaga).
 */
const putSchema = z.object({
  action: z.enum(['add', 'enable', 'disable', 'remove']),
  name: z.string().max(80).optional(),
  kind: z.enum(['local', 'remote']).optional(),
  command: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
  env: z.string().max(4000).optional(),
});

function mcpErrorResponse(error: unknown): NextResponse {
  const payload = error instanceof McpError ? MCP_ERROR_PAYLOAD[error.code] : null;
  if (!payload) return NextResponse.json({ error: 'mcp.errSave' }, { status: 500 });
  return NextResponse.json({ error: payload.error }, { status: payload.status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const folderPath = rows[0].folderPath;

    const { config, broken } = readOpencodeConfig(folderPath);
    const mcp = listMcp(config).map(({ name, entry }) => ({
      name,
      type: entry.type,
      enabled: entry.enabled,
      // Untuk tampilan: command di-join spasi balik; {env:VAR} otomatis lolos utuh.
      ...(entry.type === 'local' ? { command: entry.command.join(' ') } : { url: entry.url }),
    }));
    const skills = await listSkills(folderPath);

    return NextResponse.json({ mcp, skills, ...(broken ? { configError: true } : {}) });
  } catch (error) {
    console.error('[api/projects/extensions] GET gagal:', error);
    return NextResponse.json({ error: 'mcp.errConfig' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    if (data.action === 'add') {
      if (!data.name) {
        return NextResponse.json({ error: 'mcp.errName' }, { status: 400 });
      }
      const name = await addMcp(rows[0].folderPath, {
        name: data.name,
        kind: data.kind === 'remote' ? 'remote' : 'local',
        command: data.command ?? null,
        url: data.url ?? null,
        env: data.env ?? null,
      });
      return NextResponse.json({ ok: true, name });
    }

    if (!data.name) {
      return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    }
    if (data.action === 'remove') {
      await removeMcp(rows[0].folderPath, data.name);
      return NextResponse.json({ ok: true });
    }
    await toggleMcp(rows[0].folderPath, data.name, data.action === 'enable');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/projects/extensions] PUT gagal:', error);
    return mcpErrorResponse(error);
  }
}
