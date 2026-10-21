import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { parseBib } from '@/lib/journals/bib';
import { checkCitations } from '@/lib/citations/check';
import { listTree } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_DOCS = 200;
const MAX_DOC_BYTES = 2 * 1024 * 1024;

/**
 * GET → cek konsistensi sitasi `[@key]` di SEMUA file .md project vs
 * references.bib. Hasil: key nyangkut (dikutip tapi gak ada entri),
 * entri nganggur (ada di pustaka tapi gak pernah dikutip), per file.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const folder = rows[0]?.folderPath;
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const bibContent = await fs
      .readFile(path.join(folder, 'references.bib'), 'utf8')
      .catch(() => null);
    const bibEntries = bibContent ? parseBib(bibContent) : [];
    const bibKeys = bibEntries.map((entry) => entry.key);

    const tree = await listTree(folder).catch(() => []);
    const docs = tree
      .filter(
        (entry) =>
          entry.type === 'file' &&
          /\.(md|markdown)$/i.test(entry.path) &&
          entry.size <= MAX_DOC_BYTES,
      )
      .slice(0, MAX_DOCS);

    const files: Array<{ path: string; citations: number; missing: string[] }> = [];
    const citedAll = new Set<string>();
    const missingAll = new Set<string>();

    for (const doc of docs) {
      const markdown = await fs.readFile(path.join(folder, doc.path), 'utf8').catch(() => null);
      if (markdown === null) continue;
      const result = checkCitations(markdown, bibKeys);
      for (const key of result.cited) citedAll.add(key);
      for (const key of result.missing) missingAll.add(key);
      if (result.cited.length > 0) {
        files.push({ path: doc.path, citations: result.cited.length, missing: result.missing });
      }
    }

    const unused = bibKeys.filter((key) => !citedAll.has(key));

    return NextResponse.json({
      hasBib: bibContent !== null,
      bibTotal: bibKeys.length,
      docsScanned: docs.length,
      files: files.sort((a, b) => b.citations - a.citations),
      missing: [...missingAll].sort(),
      unused: unused.sort(),
    });
  } catch (error) {
    console.error('[api/projects/citations/check] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal cek konsistensi sitasi' }, { status: 500 });
  }
}
