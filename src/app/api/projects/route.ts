import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { settings as settingsTable } from '@/lib/db/schema';
import {
  ensureProjectDirectory,
  normalizeAndGuardFolder,
  slugify,
} from '@/lib/workspace/paths';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(projects).orderBy(projects.id);
    // Slug project terakhir (settings.last_project_id) — dipakai /workspace buat auto-redirect.
    let lastSlug: string | null = null;
    const settings = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
    const lastId = settings[0]?.lastProjectId ?? null;
    if (lastId != null) {
      const last = await db.select().from(projects).where(eq(projects.id, lastId)).limit(1);
      lastSlug = last[0]?.slug ?? null;
    }
    return NextResponse.json({ projects: rows, lastSlug });
  } catch (error) {
    console.error('[api/projects] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membuka daftar project' }, { status: 500 });
  }
}

/** PATCH { slug } → catat project ini sebagai yang terakhir dibuka. */
export async function PATCH(request: Request) {
  try {
    const parsed = selectSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    const rows = await db.select().from(projects).where(eq(projects.slug, parsed.data.slug)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    await db.update(settingsTable).set({ lastProjectId: rows[0].id }).where(eq(settingsTable.id, 1));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/projects] PATCH gagal:', error);
    return NextResponse.json({ error: 'Gagal mencatat project terakhir' }, { status: 500 });
  }
}

/** DELETE { slug } → lepas project dari app (folder di disk GAK disentuh). */
export async function DELETE(request: Request) {
  try {
    const parsed = selectSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    const rows = await db.select().from(projects).where(eq(projects.slug, parsed.data.slug)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    await db.delete(projects).where(eq(projects.slug, parsed.data.slug));
    const settings = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
    if (settings[0]?.lastProjectId === rows[0].id) {
      await db.update(settingsTable).set({ lastProjectId: null }).where(eq(settingsTable.id, 1));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/projects] DELETE gagal:', error);
    return NextResponse.json({ error: 'Gagal melepas project' }, { status: 500 });
  }
}

const attachSchema = z.object({
  name: z.string().min(1).max(120),
  folder: z.string().min(1).max(500),
});

const selectSchema = z.object({
  slug: z.string().min(1).max(120),
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

    // Clean start: TANPA folder standar (dokumen/gambar/referensi/export).
    // Tiap fitur bikin foldernya sendiri saat butuh (lazy mkdir) — folder yang
    // user lihat di tree = folder yang user/fitur beneran bikin.

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
