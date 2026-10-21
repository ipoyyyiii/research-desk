import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matrixRows, paperNotes, projects, savedPapers } from '@/lib/db/schema';
import { stringifyAuthors, toMatrixRow } from '@/lib/matrix/types';
import type { JournalCard } from '@/lib/journals/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Matriks literatur (Bab 2) — CRUD baris per project.
 * - GET    : daftar baris urut position.
 * - POST   : baris baru — dari paperId library (judul/penulis/tahun diambil
 *            dari saved_papers) atau manual (judul diketik user).
 * - PATCH  : ubah kolom yang boleh diedit (tema/metode/temuan/kutipan + judul).
 * - DELETE : hapus satu baris.
 * Kolom paperId unik per slug; duplikasi dicek di aplikasi karena SQLite
 * gak bisa unikkan nilai NULL.
 */

const createSchema = z.object({
  paperId: z.string().min(1).max(300).optional(),
  title: z.string().min(1).max(400).optional(),
  authors: z.array(z.string().max(300)).max(50).optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  position: z.number().int().min(0).max(100000).optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(400).optional(),
  authors: z.array(z.string().max(300)).max(50).optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  tema: z.string().max(4000).optional(),
  metode: z.string().max(4000).optional(),
  temuan: z.string().max(4000).optional(),
  kutipan: z.string().max(8000).optional(),
  position: z.number().int().min(0).max(100000).optional(),
});

const deleteSchema = z.object({
  id: z.number().int().positive(),
});

const fail = (error: string, status = 400, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status });

async function projectFromSlug(slug: string) {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0] ?? null;
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Paper tersimpan di Perpustakaan — sumber judul/penulis/tahun baris matriks. */
async function findSavedPaper(slug: string, paperId: string): Promise<JournalCard | null> {
  const rows = await db
    .select({ data: savedPapers.data })
    .from(savedPapers)
    .where(and(eq(savedPapers.slug, slug), eq(savedPapers.paperId, paperId)))
    .limit(1);
  const raw = rows[0]?.data;
  if (!raw) return null;
  try {
    const card = JSON.parse(raw) as Partial<JournalCard>;
    if (typeof card.title !== 'string') return null;
    return {
      id: typeof card.id === 'string' ? card.id : paperId,
      title: card.title,
      authors: Array.isArray(card.authors) ? card.authors : [],
      year: typeof card.year === 'number' ? card.year : null,
      venue: typeof card.venue === 'string' ? card.venue : null,
      doi: typeof card.doi === 'string' ? card.doi : null,
      citations: typeof card.citations === 'number' ? card.citations : 0,
      abstract: typeof card.abstract === 'string' ? card.abstract : null,
      openAccessUrl: typeof card.openAccessUrl === 'string' ? card.openAccessUrl : null,
      landingUrl: typeof card.landingUrl === 'string' ? card.landingUrl : null,
      source:
        card.source === 'crossref' || card.source === 'semantic-scholar' ? card.source : 'openalex',
    };
  } catch {
    return null;
  }
}

/** Posisi baris baru = posisi terakhir + 1 (biar urut append). */
async function nextPosition(slug: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${matrixRows.position})` })
    .from(matrixRows)
    .where(eq(matrixRows.slug, slug));
  return (rows[0]?.max ?? -1) + 1;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const rows = await db
      .select()
      .from(matrixRows)
      .where(eq(matrixRows.slug, slug))
      .orderBy(asc(matrixRows.position), asc(matrixRows.id));

    return NextResponse.json({ rows: rows.map(toMatrixRow) });
  } catch (error) {
    console.error('[api/projects/matrix] GET gagal:', error);
    return fail('Gagal memuat matriks literatur', 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const body = await readJson(request);
    if (body === null) return fail('Body bukan JSON valid');
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { paperId, title, authors, year, position } = parsed.data;

    let card: JournalCard | null = null;
    if (paperId) {
      const dup = await db
        .select({ id: matrixRows.id })
        .from(matrixRows)
        .where(and(eq(matrixRows.slug, slug), eq(matrixRows.paperId, paperId)))
        .limit(1);
      if (dup[0]) {
        return fail('Paper ini sudah ada di matriks', 409, 'matrix.duplicate');
      }
      card = await findSavedPaper(slug, paperId);
      if (!card) return fail('Paper tidak ada di Perpustakaan', 404, 'matrix.paperMissing');
    }

    const finalTitle = (title ?? card?.title ?? '').trim();
    if (finalTitle === '') return fail('Judul wajib diisi', 400, 'matrix.titleMissing');
    const finalAuthors = authors ?? card?.authors ?? [];
    const finalYear = year !== undefined ? year : card?.year ?? null;

    const [row] = await db
      .insert(matrixRows)
      .values({
        slug,
        paperId: paperId ?? null,
        title: finalTitle,
        authors: stringifyAuthors(finalAuthors),
        year: finalYear,
        position: position ?? (await nextPosition(slug)),
      })
      .returning();

    return NextResponse.json({ row: toMatrixRow(row) }, { status: 201 });
  } catch (error) {
    console.error('[api/projects/matrix] POST gagal:', error);
    return fail('Gagal membuat baris matriks', 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const body = await readJson(request);
    if (body === null) return fail('Body bukan JSON valid');
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { id, title, authors, year, tema, metode, temuan, kutipan, position } = parsed.data;

    const existing = await db
      .select()
      .from(matrixRows)
      .where(and(eq(matrixRows.id, id), eq(matrixRows.slug, slug)))
      .limit(1);
    if (!existing[0]) return fail('Baris matriks tidak ditemukan', 404);

    const patch: Partial<typeof matrixRows.$inferInsert> = {};
    if (title !== undefined) patch.title = title;
    if (authors !== undefined) patch.authors = stringifyAuthors(authors);
    if (year !== undefined) patch.year = year;
    if (tema !== undefined) patch.tema = tema;
    if (metode !== undefined) patch.metode = metode;
    if (temuan !== undefined) patch.temuan = temuan;
    if (kutipan !== undefined) patch.kutipan = kutipan;
    if (position !== undefined) patch.position = position;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ row: toMatrixRow(existing[0]) });
    }

    const [row] = await db
      .update(matrixRows)
      .set(patch)
      .where(eq(matrixRows.id, id))
      .returning();
    return NextResponse.json({ row: toMatrixRow(row) });
  } catch (error) {
    console.error('[api/projects/matrix] PATCH gagal:', error);
    return fail('Gagal menyimpan baris matriks', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const body = await readJson(request);
    if (body === null) return fail('Body bukan JSON valid');
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const deleted = await db
      .delete(matrixRows)
      .where(and(eq(matrixRows.id, parsed.data.id), eq(matrixRows.slug, slug)))
      .returning({ id: matrixRows.id });
    if (deleted.length === 0) return fail('Baris matriks tidak ditemukan', 404);

    // Catatan baris ini dilepas dari matriks (tetap nempel ke paper).
    await db
      .update(paperNotes)
      .set({ matrixRowId: null })
      .where(and(eq(paperNotes.matrixRowId, parsed.data.id), eq(paperNotes.slug, slug)));

    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (error) {
    console.error('[api/projects/matrix] DELETE gagal:', error);
    return fail('Gagal menghapus baris matriks', 500);
  }
}
