import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { readTextFile, writeTextFile } from '@/lib/workspace/files';
import { workspaceError } from '@/lib/workspace/api-error';
import { snapshotCurrent } from '@/lib/versions/store';
import { chapterNumber, extractTables } from '@/lib/insert/markdown-tables';

export const dynamic = 'force-dynamic';

async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

/**
 * GET  ?sourcePath=hasil/uji-laporan.md → daftar tabel di file itu.
 * POST { sourcePath, chapterPath, index?, caption? } → sisip tabel yang dipilih
 *      ke akhir bab, dengan nomor "Tabel 3.1" sesuai gaya penulisan skripsi.
 *
 * Ini yang bikin alur "data → analisis → bab" nyambung tanpa harus ngomong
 * sama agent: hasil analisis berupa file markdown, tabelnya bisa langsung
 * dipindah ke draft.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const sourcePath = new URL(request.url).searchParams.get('sourcePath') ?? '';
    if (!sourcePath) {
      return NextResponse.json({ error: 'sourcePath wajib diisi' }, { status: 400 });
    }
    try {
      const { content } = await readTextFile(folder, sourcePath);
      return NextResponse.json({ tables: extractTables(content) });
    } catch (error) {
      return workspaceError(error, 'Gagal membaca file hasil');
    }
  } catch (error) {
    console.error('[api/projects/insert-result] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membaca file hasil' }, { status: 500 });
  }
}

const postSchema = z.object({
  sourcePath: z.string().min(1).max(500),
  chapterPath: z.string().min(1).max(500),
  index: z.number().int().min(0).optional(),
  caption: z.string().max(300).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { sourcePath, chapterPath, index, caption } = parsed.data;

    try {
      const source = await readTextFile(folder, sourcePath);
      const tables = extractTables(source.content);
      if (tables.length === 0) {
        return NextResponse.json(
          { error: 'File ini gak punya tabel markdown buat disisipin' },
          { status: 400 },
        );
      }
      const table = tables[index ?? 0];
      if (!table) {
        return NextResponse.json({ error: 'Tabel gak ditemukan' }, { status: 404 });
      }

      const chapter = await readTextFile(folder, chapterPath);
      const babNumber = chapterNumber(chapterPath, chapter.content);
      const existing = extractTables(chapter.content).length + 1;
      const number = babNumber ? `Tabel ${babNumber}.${existing}` : `Tabel ${existing}`;

      const heading = caption?.trim() || table.caption || number;
      const block = `**${number}** ${heading}\n\n${table.markdown}\n`;

      const separator = chapter.content.endsWith('\n') ? '\n' : '\n\n';
      const next = `${chapter.content}${separator}${block}`;
      // Simpan versi bab yang SEBELUM tabel disisipin, biar bisa dibalik.
      await snapshotCurrent(folder, chapterPath, 'analysis').catch(() => undefined);
      await writeTextFile(folder, chapterPath, next);

      return NextResponse.json({ ok: true, number, heading, bytes: next.length });
    } catch (error) {
      return workspaceError(error, 'Gagal menyisipkan tabel');
    }
  } catch (error) {
    console.error('[api/projects/insert-result] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal menyisipkan tabel' }, { status: 500 });
  }
}
