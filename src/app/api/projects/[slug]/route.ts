import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Detail project by slug + update lastOpenedAt (saat workspace dibuka). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const [project] = rows;
    void db.update(projects).set({ lastOpenedAt: new Date() }).where(eq(projects.id, project.id));
    return NextResponse.json({ project });
  } catch (error) {
    console.error('[api/projects/[slug]] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membuka project' }, { status: 500 });
  }
}
