import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { parseBib } from '@/lib/journals/bib';
import { buildWordSourcesXml } from '@/lib/citations/word-sources';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET → unduh sources.xml yang bisa diimpor Word:
 * References > Manage Sources > Browse → pilih file ini.
 * Berisi semua entri references.bib project (Tag = citation key).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const folder = rows[0]?.folderPath;
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const content = await fs
      .readFile(path.join(folder, 'references.bib'), 'utf8')
      .catch(() => null);
    if (content === null) {
      return NextResponse.json({ error: 'references.bib belum ada' }, { status: 404 });
    }

    const entries = parseBib(content);
    if (entries.length === 0) {
      return NextResponse.json({ error: 'references.bib kosong' }, { status: 404 });
    }

    const xml = buildWordSourcesXml(entries);
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sources.xml"',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[api/projects/bib/sources] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membuat sources.xml' }, { status: 500 });
  }
}
