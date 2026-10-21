import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, revisionItems } from '@/lib/db/schema';
import {
  MAX_REVISION_NOTE,
  MAX_REVISION_RAW,
  MAX_REVISION_TEXT,
  normalizeChapterPath,
  parseRevisionRaw,
  toRevisionItem,
} from '@/lib/revision/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Loop revisi dosen — komentar supervisor per project.
 * - GET    : daftar item urut position.
 * - POST   : satu item ({ text }) atau batch dari teks mentah ({ raw }).
 * - PATCH  : ubah status / bab / catatan / isi teks / posisi.
 * - DELETE : hapus satu item.
 * Status: 'todo' | 'doing' | 'done'. Item yang ditutup (done) dicatat
 * resolvedAt; item yang dibuka lagi jadi NULL.
 */

const createSchema = z.object({
  text: z.string().min(1).max(MAX_REVISION_TEXT).optional(),
  raw: z.string().max(MAX_REVISION_RAW).optional(),
  chapterPath: z.string().max(500).nullable().optional(),
  note: z.string().max(MAX_REVISION_NOTE).nullable().optional(),
  position: z.number().int().min(0).max(100000).optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1).max(MAX_REVISION_TEXT).optional(),
  status: z.enum(['todo', 'doing', 'done']).optional(),
  chapterPath: z.string().max(500).nullable().optional(),
  note: z.string().max(MAX_REVISION_NOTE).nullable().optional(),
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

/** Posisi item baru = posisi terakhir + 1 (biar urut append). */
async function nextPosition(slug: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${revisionItems.position})` })
    .from(revisionItems)
    .where(eq(revisionItems.slug, slug));
  return (rows[0]?.max ?? -1) + 1;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const rows = await db
      .select()
      .from(revisionItems)
      .where(eq(revisionItems.slug, slug))
      .orderBy(asc(revisionItems.position), asc(revisionItems.id));

    return NextResponse.json({ items: rows.map(toRevisionItem) });
  } catch (error) {
    console.error('[api/projects/revisions] GET gagal:', error);
    return fail('Gagal memuat komentar revisi', 500);
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
    const { text, raw, chapterPath, note, position } = parsed.data;

    if (text === undefined && raw === undefined) {
      return fail('Komentar wajib diisi', 400, 'revision.textMissing');
    }

    let chapter: string | null = null;
    if (chapterPath !== undefined && chapterPath !== null) {
      chapter = normalizeChapterPath(chapterPath);
      if (chapter === null) return fail('Path bab tidak valid', 400, 'revision.chapterInvalid');
    }
    const cleanNote = note === undefined || note === null ? null : note.trim() || null;

    const base = position ?? (await nextPosition(slug));

    if (raw !== undefined) {
      const texts = parseRevisionRaw(raw);
      if (texts.length === 0) return fail('Tidak ada komentar yang bisa dibaca', 400, 'revision.empty');
      const inserted = await db
        .insert(revisionItems)
        .values(
          texts.map((item, index) => ({
            slug,
            text: item,
            status: 'todo' as const,
            chapterPath: chapter,
            note: cleanNote,
            position: base + index,
          })),
        )
        .returning();
      return NextResponse.json({ items: inserted.map(toRevisionItem) }, { status: 201 });
    }

    const cleanText = (text ?? '').trim();
    if (cleanText === '') return fail('Komentar wajib diisi', 400, 'revision.textMissing');

    const [row] = await db
      .insert(revisionItems)
      .values({
        slug,
        text: cleanText,
        status: 'todo',
        chapterPath: chapter,
        note: cleanNote,
        position: base,
      })
      .returning();

    return NextResponse.json({ item: toRevisionItem(row) }, { status: 201 });
  } catch (error) {
    console.error('[api/projects/revisions] POST gagal:', error);
    return fail('Gagal menyimpan komentar revisi', 500);
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
    const { id, text, status, chapterPath, note, position } = parsed.data;

    const existing = await db
      .select()
      .from(revisionItems)
      .where(and(eq(revisionItems.id, id), eq(revisionItems.slug, slug)))
      .limit(1);
    if (!existing[0]) return fail('Komentar tidak ditemukan', 404, 'revision.notFound');

    const patch: Partial<typeof revisionItems.$inferInsert> = {};
    if (text !== undefined) {
      const cleanText = text.trim();
      if (cleanText === '') return fail('Komentar wajib diisi', 400, 'revision.textMissing');
      patch.text = cleanText;
    }
    if (status !== undefined) {
      patch.status = status;
      patch.resolvedAt = status === 'done' ? new Date() : null;
    }
    if (chapterPath !== undefined) {
      if (chapterPath === null) {
        patch.chapterPath = null;
      } else {
        const chapter = normalizeChapterPath(chapterPath);
        if (chapter === null) return fail('Path bab tidak valid', 400, 'revision.chapterInvalid');
        patch.chapterPath = chapter;
      }
    }
    if (note !== undefined) {
      patch.note = note === null ? null : note.trim() || null;
    }
    if (position !== undefined) patch.position = position;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ item: toRevisionItem(existing[0]) });
    }

    const [row] = await db
      .update(revisionItems)
      .set(patch)
      .where(eq(revisionItems.id, id))
      .returning();
    return NextResponse.json({ item: toRevisionItem(row) });
  } catch (error) {
    console.error('[api/projects/revisions] PATCH gagal:', error);
    return fail('Gagal menyimpan komentar revisi', 500);
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
      .delete(revisionItems)
      .where(and(eq(revisionItems.id, parsed.data.id), eq(revisionItems.slug, slug)))
      .returning({ id: revisionItems.id });
    if (deleted.length === 0) return fail('Komentar tidak ditemukan', 404, 'revision.notFound');

    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (error) {
    console.error('[api/projects/revisions] DELETE gagal:', error);
    return fail('Gagal menghapus komentar revisi', 500);
  }
}
