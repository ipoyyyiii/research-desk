import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { installStatsTemplate } from '@/lib/workspace/stats-template';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST → salin template skrip uji statistik ke `<project>/scripts/uji-statistik.py`.
 * Dipanggil dari tombol panel Data. File hanya dibuat saat user minta.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const folder = rows[0]?.folderPath;
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const file = await installStatsTemplate(folder);
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    console.error('[api/projects/stats-template] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal memasang skrip statistik' }, { status: 500 });
  }
}
