import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError } from '@/lib/workspace/files';
import { restoreSnapshot } from '@/lib/versions/store';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  path: z.string().min(1).max(500),
  file: z.string().min(1).max(200),
});

async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

/**
 * Pulihkan isi satu snapshot ke babnya. Isi bab saat ini disimpan dulu sebagai
 * versi baru (reason 'restore') supaya restore-nya sendiri bisa dibatalkan.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }

    try {
      const { restored, safety } = await restoreSnapshot(
        folder,
        parsed.data.path,
        parsed.data.file,
      );
      return NextResponse.json({ restored, safety });
    } catch (error) {
      return workspaceError(error, 'Gagal memulihkan versi');
    }
  } catch (error) {
    console.error('[api/versions/restore] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal memulihkan versi' }, { status: 500 });
  }
}

function workspaceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof WorkspaceError) {
    const messages: Record<string, string> = {
      INVALID_PATH: 'Path tidak valid',
      PATH_OUT_OF_PROJECT: 'File di luar folder project',
      FILE_NOT_FOUND: 'Versi tidak ditemukan',
      UNSUPPORTED_TYPE: 'Hanya bab .md yang punya riwayat versi',
    };
    return NextResponse.json(
      { error: messages[error.code] ?? fallback, code: error.code },
      { status: 400 },
    );
  }
  console.error('[api/versions/restore] error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
