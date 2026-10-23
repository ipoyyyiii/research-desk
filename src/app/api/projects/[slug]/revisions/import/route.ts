import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, revisionItems } from '@/lib/db/schema';
import { MAX_REVISION_ITEMS, MAX_REVISION_NOTE, MAX_REVISION_TEXT, normalizeChapterPath, toRevisionItem } from '@/lib/revision/types';
import { extractDocxAnnotations } from '@/lib/revision/docx-comments';
import { readBinaryFile, WorkspaceError } from '@/lib/workspace/files';
import { workspaceError } from '@/lib/workspace/api-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Import anotasi dari file .docx pembimbing → item revisi.
 *
 * - Komentar Word (`word/comments.xml`) jadi item revisi, lengkap dengan
 *   kutipan teks yang dikomentari (rentang commentRangeStart/End).
 * - Track changes (opsional) jadi item "Penambahan/Penghapusan oleh X".
 *
 * Sumber file: `path` relatif di dalam project ATAU `base64` hasil upload.
 */

const IMPORT_LIMIT = 20 * 1024 * 1024; // 20 MB

const bodySchema = z.object({
  path: z.string().min(1).max(500).optional(),
  base64: z.string().min(1).optional(),
  chapterPath: z.string().max(500).nullable().optional(),
  includeTrackChanges: z.boolean().optional(),
});

const fail = (error: string, status = 400, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status });

async function nextPosition(slug: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${revisionItems.position})` })
    .from(revisionItems)
    .where(eq(revisionItems.slug, slug));
  return (rows[0]?.max ?? -1) + 1;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const project = rows[0];
    if (!project) return fail('Project tidak ditemukan', 404, 'revision.projectMissing');

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail('Data tidak valid', 400, 'revision.invalidBody');
    const { path: sourcePath, base64, includeTrackChanges } = parsed.data;

    let bytes: Buffer;
    if (base64) {
      bytes = Buffer.from(base64, 'base64');
    } else if (sourcePath) {
      try {
        bytes = (await readBinaryFile(project.folderPath, sourcePath)).buffer;
      } catch (error) {
        return workspaceError(error, 'Gagal membaca file .docx');
      }
    } else {
      return fail('path atau base64 wajib diisi', 400, 'revision.sourceMissing');
    }
    if (bytes.length === 0) return fail('File kosong', 400, 'revision.empty');
    if (bytes.length > IMPORT_LIMIT) return fail('File terlalu besar', 413, 'revision.tooBig');

    const annotations = await extractDocxAnnotations(bytes).catch(() => null);
    if (!annotations) return fail('Bukan file .docx yang valid', 400, 'revision.notDocx');

    const chapter = normalizeChapterPath(parsed.data.chapterPath ?? '');

    const values: Array<{ text: string; note: string | null }> = [];
    for (const comment of annotations.comments) {
      const note = [
        `Dari ${comment.author}`,
        comment.quote ? `kutipan: “${comment.quote}”` : null,
        comment.date ? `(${comment.date.slice(0, 10)})` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      values.push({
        text: comment.text.slice(0, MAX_REVISION_TEXT),
        note: note.slice(0, MAX_REVISION_NOTE) || null,
      });
    }

    if (includeTrackChanges) {
      for (const change of annotations.trackChanges) {
        const label = change.kind === 'insert' ? 'Penambahan' : 'Penghapusan';
        values.push({
          text: `[${label} oleh ${change.author}] ${change.text}`.slice(0, MAX_REVISION_TEXT),
          note: change.date ? `track changes · ${change.date.slice(0, 10)}` : 'track changes',
        });
      }
    }

    if (values.length === 0) {
      return NextResponse.json(
        { items: [], comments: annotations.comments.length, trackChanges: annotations.trackChanges.length },
        { status: 200 },
      );
    }

    const limited = values.slice(0, MAX_REVISION_ITEMS);
    const base = await nextPosition(slug);
    const inserted = await db
      .insert(revisionItems)
      .values(
        limited.map((item, index) => ({
          slug,
          text: item.text,
          status: 'todo' as const,
          chapterPath: chapter,
          note: item.note,
          position: base + index,
        })),
      )
      .returning();

    return NextResponse.json(
      {
        items: inserted.map(toRevisionItem),
        comments: annotations.comments.length,
        trackChanges: annotations.trackChanges.length,
        skipped: values.length - limited.length,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof WorkspaceError) return workspaceError(error, 'Gagal mengimpor revisi');
    console.error('[api/projects/revisions/import] POST gagal:', error);
    return fail('Gagal mengimpor revisi', 500);
  }
}
