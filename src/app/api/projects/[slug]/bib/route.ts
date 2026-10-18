import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { parseBib } from '@/lib/journals/bib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * List referensi siap-sitasi untuk popover editor:
 * - Sumber utama: references.bib di folder project (sumber kebenaran pandoc).
 * - Ditambah keys yang tersimpan DB (kalau .bib hilang, intro gap tetap tampil).
 * Query `?q=` → filter contains (key/judul/penulis), limit 400.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const folder = rows[0]?.folderPath;
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    let content: string | null = null;
    try {
      content = await fs.readFile(path.join(folder, 'references.bib'), 'utf8');
    } catch {
      content = null; // belum ada references.bib — daftar kosong, bukan error.
    }

    const entries = content ? parseBib(content) : [];
    const filtered = q
      ? entries.filter((entry) =>
          `${entry.key} ${entry.title} ${entry.authors.join(' ')} ${entry.venue ?? ''}`
            .toLowerCase()
            .includes(q),
        )
      : entries;

    return NextResponse.json({
      entries: filtered.slice(0, 400),
      total: entries.length,
      hasBib: content !== null,
    });
  } catch (error) {
    console.error('[api/projects/bib] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal baca references.bib' }, { status: 500 });
  }
}
