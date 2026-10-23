import { NextResponse } from 'next/server';
import { resolveProjectFolder } from '@/lib/export/shared';
import { readFrontMatter, writeFrontMatter } from '@/lib/thesis/front-matter';
import { workspaceError } from '@/lib/workspace/api-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET identitas halaman depan (skripsi.json); file dibuat kalau belum ada. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const result = await readFrontMatter(folder);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[api/projects/front-matter] GET gagal:', error);
    return workspaceError(error, 'Gagal membaca identitas skripsi');
  }
}

/** PUT identitas halaman depan — field yang tidak dikirim tetap dipertahankan. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const body = (await request.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    }

    const current = await readFrontMatter(folder);
    const merged = { ...current.frontMatter, ...(body as Record<string, unknown>) };
    const frontMatter = await writeFrontMatter(folder, merged);
    return NextResponse.json({ ok: true, frontMatter });
  } catch (error) {
    console.error('[api/projects/front-matter] PUT gagal:', error);
    return workspaceError(error, 'Gagal menyimpan identitas skripsi');
  }
}
