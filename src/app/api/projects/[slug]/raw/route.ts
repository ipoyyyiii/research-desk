import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError, readBinaryFile } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

/** Serve file raw (gambar utk editor, PDF nanti fase 3) — guard dalam project. */
export async function GET(
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
    const { buffer, mime } = await readBinaryFile(rows[0].folderPath, relative);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError) {
      const messages: Record<string, string> = {
        FILE_NOT_FOUND: 'File tidak ditemukan',
        FILE_TOO_BIG: 'File terlalu besar',
        PATH_OUT_OF_PROJECT: 'File di luar folder project',
        UNSUPPORTED_TYPE: 'Tipe file tidak didukung',
      };
      return NextResponse.json({ error: messages[error.code] ?? error.code }, { status: 400 });
    }
    console.error('[api/raw] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membaca file' }, { status: 500 });
  }
}
