import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { createDocument } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  title: z.string().min(1).max(120),
});

/** Buat dokumen baru di dokumen/ — nama file dari judul user (slugify, tanpa prefix bab). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const document = await createDocument(rows[0].folderPath, parsed.data.title);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    console.error('[api/workspace/documents] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal membuat dokumen' }, { status: 500 });
  }
}
