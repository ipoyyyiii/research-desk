import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { listTree } from '@/lib/workspace/files';

export const dynamic = 'force-dynamic';

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
    const tree = await listTree(rows[0].folderPath);
    return NextResponse.json({ tree });
  } catch (error) {
    console.error('[api/workspace/tree] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membaca pohon berkas' }, { status: 500 });
  }
}
