import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError, deleteFile, readTextFile, writeTextFile } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const relative = new URL(request.url).searchParams.get('path') ?? '';
    try {
      const { content, mtime } = await readTextFile(folder, relative);
      return NextResponse.json({ content, mtime });
    } catch (error) {
      return workspaceError(error, 'Gagal membaca file');
    }
  } catch (error) {
    console.error('[api/workspace/file] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membaca file' }, { status: 500 });
  }
}

const putSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(2 * 1024 * 1024),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }

    try {
      const { mtime } = await writeTextFile(folder, parsed.data.path, parsed.data.content);
      return NextResponse.json({ mtime });
    } catch (error) {
      return workspaceError(error, 'Gagal menulis file');
    }
  } catch (error) {
    console.error('[api/workspace/file] PUT gagal:', error);
    return NextResponse.json({ error: 'Gagal menulis file' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const relative = new URL(request.url).searchParams.get('path') ?? '';
    await deleteFile(folder, relative);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workspaceError(error, 'Gagal menghapus file');
  }
}

function workspaceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof WorkspaceError) {
    const messages: Record<string, string> = {
      INVALID_PATH: 'Path tidak valid',
      PATH_OUT_OF_PROJECT: 'File di luar folder project',
      FILE_NOT_FOUND: 'File tidak ditemukan',
      FILE_TOO_BIG: 'File terlalu besar',
      UNSUPPORTED_TYPE: 'Tipe file ini belum bisa dibuka',
    };
    return NextResponse.json(
      { error: messages[error.code] ?? fallback, code: error.code },
      { status: 400 },
    );
  }
  console.error('[api/workspace/file] error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
