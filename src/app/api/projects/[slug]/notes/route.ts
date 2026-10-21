import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matrixRows, paperNotes, projects } from '@/lib/db/schema';
import { toPaperNote } from '@/lib/notes/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Catatan ringan dari paper (anotasi PDF versi teks) per project.
 * - GET    : daftar catatan; bisa disaring ?paperId= / ?matrixRowId=.
 * - POST   : catatan baru — nempel ke paper library, baris matriks, atau dua-duanya.
 * - PATCH  : ubah isi catatan / kutipan.
 * - DELETE : hapus satu catatan.
 * Catatan yang baris matriksnya dihapus tetap disimpan (matrixRowId dilepas)
 * supaya kutipan yang sudah dikumpulkan gak ikut hilang.
 */

const createSchema = z.object({
  paperId: z.string().min(1).max(300).nullable().optional(),
  matrixRowId: z.number().int().positive().nullable().optional(),
  note: z.string().min(1).max(4000),
  quote: z.string().max(8000).nullable().optional(),
  source: z.enum(['manual', 'matrix']).optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  note: z.string().min(1).max(4000).optional(),
  quote: z.string().max(8000).nullable().optional(),
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

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const search = new URL(request.url).searchParams;
    const paperId = (search.get('paperId') ?? '').trim();
    const rawRowId = (search.get('matrixRowId') ?? '').trim();

    const conditions = [eq(paperNotes.slug, slug)];
    if (paperId !== '') conditions.push(eq(paperNotes.paperId, paperId));
    if (rawRowId !== '') {
      const matrixRowId = Number.parseInt(rawRowId, 10);
      if (!Number.isFinite(matrixRowId) || matrixRowId <= 0) {
        return fail('matrixRowId harus angka');
      }
      conditions.push(eq(paperNotes.matrixRowId, matrixRowId));
    }

    const rows = await db
      .select()
      .from(paperNotes)
      .where(and(...conditions))
      .orderBy(asc(paperNotes.createdAt), asc(paperNotes.id));

    return NextResponse.json({ notes: rows.map(toPaperNote) });
  } catch (error) {
    console.error('[api/projects/notes] GET gagal:', error);
    return fail('Gagal memuat catatan', 500);
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
    const { paperId, matrixRowId, note, quote, source } = parsed.data;

    const cleanNote = note.trim();
    if (cleanNote === '') return fail('Catatan wajib diisi', 400, 'notes.noteMissing');

    if (matrixRowId !== undefined && matrixRowId !== null) {
      const rows = await db
        .select({ id: matrixRows.id })
        .from(matrixRows)
        .where(and(eq(matrixRows.id, matrixRowId), eq(matrixRows.slug, slug)))
        .limit(1);
      if (!rows[0]) return fail('Baris matriks tidak ditemukan', 404, 'notes.rowMissing');
    }

    const cleanQuote = quote?.trim() ?? '';
    const [row] = await db
      .insert(paperNotes)
      .values({
        slug,
        paperId: paperId ?? null,
        matrixRowId: matrixRowId ?? null,
        note: cleanNote,
        quote: cleanQuote === '' ? null : cleanQuote,
        source: source ?? 'manual',
      })
      .returning();

    return NextResponse.json({ note: toPaperNote(row) }, { status: 201 });
  } catch (error) {
    console.error('[api/projects/notes] POST gagal:', error);
    return fail('Gagal membuat catatan', 500);
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
    const { id, note, quote } = parsed.data;

    const existing = await db
      .select()
      .from(paperNotes)
      .where(and(eq(paperNotes.id, id), eq(paperNotes.slug, slug)))
      .limit(1);
    if (!existing[0]) return fail('Catatan tidak ditemukan', 404, 'notes.notFound');

    const patch: Partial<typeof paperNotes.$inferInsert> = {};
    if (note !== undefined) {
      const cleanNote = note.trim();
      if (cleanNote === '') return fail('Catatan wajib diisi', 400, 'notes.noteMissing');
      patch.note = cleanNote;
    }
    if (quote !== undefined) {
      const cleanQuote = quote === null ? '' : quote.trim();
      patch.quote = cleanQuote === '' ? null : cleanQuote;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ note: toPaperNote(existing[0]) });
    }

    const [row] = await db
      .update(paperNotes)
      .set(patch)
      .where(eq(paperNotes.id, id))
      .returning();
    return NextResponse.json({ note: toPaperNote(row) });
  } catch (error) {
    console.error('[api/projects/notes] PATCH gagal:', error);
    return fail('Gagal menyimpan catatan', 500);
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
      .delete(paperNotes)
      .where(and(eq(paperNotes.id, parsed.data.id), eq(paperNotes.slug, slug)))
      .returning({ id: paperNotes.id });
    if (deleted.length === 0) return fail('Catatan tidak ditemukan', 404, 'notes.notFound');

    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (error) {
    console.error('[api/projects/notes] DELETE gagal:', error);
    return fail('Gagal menghapus catatan', 500);
  }
}
