import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, savedPapers } from '@/lib/db/schema';
import { bibEntry, extractBibKeys, generateBibKey } from '@/lib/journals/bib';
import type { JournalCard } from '@/lib/journals/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paperSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  doi: z.string().nullable(),
  citations: z.number(),
  abstract: z.string().nullable(),
  openAccessUrl: z.string().nullable(),
  landingUrl: z.string().nullable(),
  source: z.enum(['openalex', 'crossref', 'semantic-scholar']),
});

const postSchema = z.object({
  slug: z.string().min(1),
  paper: paperSchema,
});

const deleteSchema = z.object({
  slug: z.string().min(1),
  paperId: z.string().min(1),
});

async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

function bibFilePath(folder: string): string {
  return path.join(folder, 'references.bib');
}

async function readBibContent(folder: string): Promise<string | null> {
  try {
    return await fs.readFile(bibFilePath(folder), 'utf8');
  } catch {
    return null; // file belum ada
  }
}

/** Append blok bibtex; pisahkan dari isi lama dengan blank line. */
async function appendBibEntry(folder: string, block: string): Promise<void> {
  const existing = await readBibContent(folder);
  const base = existing ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  await fs.writeFile(bibFilePath(folder), base, 'utf8');
}

/** Hapus blok bibtex yang mengandung `{<bibKey>,` dari references.bib; file hilang → abaikan. */
async function removeBibEntry(folder: string, bibKey: string): Promise<void> {
  const content = await readBibContent(folder);
  if (content === null) return;
  const escapedKey = bibKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`@article\\s*\\{${escapedKey},[\\s\\S]*?\\n\\}`, 'i');
  const cleaned = content
    .replace(pattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  await fs.writeFile(bibFilePath(folder), cleaned !== '' ? `${cleaned}\n` : '', 'utf8');
}

async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (body === null) {
      return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 });
    }
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { slug, paper } = parsed.data;

    const folder = await resolveProjectFolder(slug);
    if (!folder) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const existingRows = await db
      .select({ id: savedPapers.id, bibKey: savedPapers.bibKey })
      .from(savedPapers)
      .where(and(eq(savedPapers.slug, slug), eq(savedPapers.paperId, paper.id)))
      .limit(1);
    if (existingRows[0]) {
      return NextResponse.json({
        ok: true,
        bibKey: existingRows[0].bibKey,
        alreadySaved: true,
      });
    }

    const bibContent = await readBibContent(folder);
    const bibKey = generateBibKey(paper, extractBibKeys(bibContent ?? ''));

    await db.insert(savedPapers).values({
      slug,
      paperId: paper.id,
      bibKey,
      data: JSON.stringify(paper),
    });
    await appendBibEntry(folder, bibEntry(paper, bibKey));

    return NextResponse.json({ ok: true, bibKey });
  } catch (error) {
    console.error('[api/journals/save] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal menyimpan paper' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const slug = (new URL(request.url).searchParams.get('slug') ?? '').trim();
    if (slug === '') {
      return NextResponse.json({ error: 'Slug wajib diisi' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(savedPapers)
      .where(eq(savedPapers.slug, slug))
      .orderBy(desc(savedPapers.createdAt));

    const results: Array<{
      id: number;
      paperId: string;
      bibKey: string;
      paper: JournalCard;
      createdAt: string;
    }> = [];
    for (const row of rows) {
      try {
        const paper = JSON.parse(row.data) as JournalCard;
        results.push({
          id: row.id,
          paperId: row.paperId,
          bibKey: row.bibKey,
          paper,
          createdAt: row.createdAt.toISOString(),
        });
      } catch {
        // row rusak / data bukan JSON valid → lewati
      }
    }
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[api/journals/save] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal memuat daftar paper' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (body === null) {
      return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 });
    }
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { slug, paperId } = parsed.data;

    const folder = await resolveProjectFolder(slug);
    if (!folder) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const rows = await db
      .select({ id: savedPapers.id, bibKey: savedPapers.bibKey })
      .from(savedPapers)
      .where(and(eq(savedPapers.slug, slug), eq(savedPapers.paperId, paperId)))
      .limit(1);
    const row = rows[0];

    await db
      .delete(savedPapers)
      .where(and(eq(savedPapers.slug, slug), eq(savedPapers.paperId, paperId)));

    if (row) {
      await removeBibEntry(folder, row.bibKey);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/journals/save] DELETE gagal:', error);
    return NextResponse.json({ error: 'Gagal menghapus paper' }, { status: 500 });
  }
}
