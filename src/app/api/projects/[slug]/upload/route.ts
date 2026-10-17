import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError, saveUploadedImage } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

/** Upload file (multipart field: "file") — fase 1: gambar untuk editor. */
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

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Field "file" wajib ada' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveUploadedImage(rows[0].folderPath, file.name, buffer);
    return NextResponse.json({ document: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceError) {
      const messages: Record<string, string> = {
        UNSUPPORTED_TYPE: 'Hanya gambar (png/jpg/webp/gif) yang didukung fase ini',
        FILE_TOO_BIG: 'Maksimal 10 MB',
        PATH_OUT_OF_PROJECT: 'Path tidak valid',
      };
      return NextResponse.json({ error: messages[error.code] ?? error.code }, { status: 400 });
    }
    console.error('[api/upload] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal upload file' }, { status: 500 });
  }
}
