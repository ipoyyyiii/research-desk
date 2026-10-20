import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError, createPlaceholderFile } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  /** Folder induk relatif project. '' = root project. */
  parent: z.string().max(500).default(''),
  /** Nama file lengkap dengan ekstensinya — format bebas (tersemat: .xlsx pakai template). */
  name: z.string().min(1).max(120),
});

/** File baru format bebas (file manager: menu + & klik kanan).
 * Isi: kosong (0B) kecuali .xlsx → template workbook kosong. */
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

    const file = await createPlaceholderFile(
      rows[0].folderPath,
      parsed.data.parent,
      parsed.data.name,
    );
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    console.error('[api/workspace/files] POST gagal:', error);
    return workspaceError(error, 'Gagal membuat file');
  }
}

function workspaceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof WorkspaceError) {
    const messages: Record<string, string> = {
      INVALID_PATH: 'Path tidak valid',
      PATH_OUT_OF_PROJECT: 'Path di luar folder project',
      FILE_NOT_FOUND: 'Folder tidak ditemukan',
      UNSUPPORTED_TYPE: 'Tipe file ini belum bisa dibuat',
    };
    return NextResponse.json(
      { error: messages[error.code] ?? fallback, code: error.code },
      { status: 400 },
    );
  }
  console.error('[api/workspace/files] error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
