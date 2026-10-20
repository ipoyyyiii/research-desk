import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceError, createSpreadsheet } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

/** Buat spreadsheet baru (dokumen/data.xlsx dari template kosong) — menu + panel tengah. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const document = await createSpreadsheet(rows[0].folderPath);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    const code = error instanceof WorkspaceError ? error.code : 'INTERNAL';
    console.error('[api/workspace/spreadsheets] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal membuat spreadsheet', code }, { status: 500 });
  }
}
