import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import {
  createProjectSubfolders,
  ensureProjectDirectory,
  normalizeAndGuardFolder,
  slugify,
} from '@/lib/workspace/paths';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(projects).orderBy(projects.id);
    return NextResponse.json({ projects: rows });
  } catch (error) {
    console.error('[api/projects] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membuka daftar project' }, { status: 500 });
  }
}

const attachSchema = z.object({
  name: z.string().min(1).max(120),
  folder: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const parsed = attachSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const guard = normalizeAndGuardFolder(parsed.data.folder);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }

    try {
      ensureProjectDirectory(guard.folderPath);
    } catch (error) {
      console.error('[api/projects] buat folder gagal:', error);
      return NextResponse.json({ error: 'Folder tidak bisa dibuat' }, { status: 400 });
    }

    createProjectSubfolders(guard.folderPath);

    // Slug unik: research-desk, research-desk-2, ...
    const baseSlug = slugify(parsed.data.name);
    let slug = baseSlug;
    let suffix = 2;
    while (await db.select().from(projects).where(eq(projects.slug, slug)).limit(1).then((r) => r.length > 0)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const [project] = await db
      .insert(projects)
      .values({ slug, name: parsed.data.name, folderPath: guard.folderPath })
      .returning();

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error('[api/projects] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal membuat project' }, { status: 500 });
  }
}
