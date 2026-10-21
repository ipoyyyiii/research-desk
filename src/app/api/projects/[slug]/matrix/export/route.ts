import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matrixRows, projects, settings } from '@/lib/db/schema';
import { buildMatrixMarkdown } from '@/lib/matrix/markdown';
import { toMatrixRow } from '@/lib/matrix/types';
import { dictFor } from '@/lib/i18n/dict';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Export matriks literatur jadi tabel Markdown (GFM) buat nyempel di Bab 2.
 * Label kolom & judul heading ikut locale app (baris settings id=1).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const projectRows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (!projectRows[0]) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(matrixRows)
      .where(eq(matrixRows.slug, slug))
      .orderBy(asc(matrixRows.position), asc(matrixRows.id));

    const settingsRows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    const dict = dictFor(settingsRows[0]?.locale ?? 'id');

    const markdown = buildMatrixMarkdown(rows.map(toMatrixRow), {
      heading: dict['matrix.exportHeading'] ?? '## Matriks Literatur',
      paper: dict['matrix.paper'] ?? 'Paper',
      tema: dict['matrix.tema'] ?? 'Tema',
      metode: dict['matrix.metode'] ?? 'Metode',
      temuan: dict['matrix.temuan'] ?? 'Temuan',
      kutipan: dict['matrix.kutipan'] ?? 'Kutipan',
    });

    return NextResponse.json({ markdown, rowCount: rows.length });
  } catch (error) {
    console.error('[api/projects/matrix/export] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal mengekspor matriks' }, { status: 500 });
  }
}
