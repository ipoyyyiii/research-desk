import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError, createFolder, deleteFolder } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  /** Folder induk relatif project. '' = root project. */
  parent: z.string().max(500).default(''),
  name: z.string().min(1).max(120),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
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

    const folder = await createFolder(rows[0].folderPath, parsed.data.parent, parsed.data.name);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    console.error('[api/workspace/folders] POST gagal:', error);
    return workspaceError(error, 'Gagal membuat folder');
  }
}

/** DELETE ?path=… → folder + seluruh isinya kehapus (konfirmasi ada di UI). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const relative = new URL(request.url).searchParams.get('path') ?? '';
    await deleteFolder(rows[0].folderPath, relative);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/workspace/folders] DELETE gagal:', error);
    return workspaceError(error, 'Gagal menghapus folder');
  }
}

function workspaceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof WorkspaceError) {
    const messages: Record<string, string> = {
      INVALID_PATH: 'Path tidak valid',
      PATH_OUT_OF_PROJECT: 'Path di luar folder project',
      FILE_NOT_FOUND: 'Folder tidak ditemukan',
      UNSUPPORTED_TYPE: 'Yang itu bukan folder',
    };
    return NextResponse.json(
      { error: messages[error.code] ?? fallback, code: error.code },
      { status: 400 },
    );
  }
  console.error('[api/workspace/folders] error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
