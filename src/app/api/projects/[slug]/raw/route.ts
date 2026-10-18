import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Route BINARY (fase 3.5): serve PDF/gambar/data-mentah dari folder project
 * supaya panel-tujuan (Gambar/Data/Jurnal) bisa membukanya langsung di tab browser.
 * Keamanan: path selalu dinormalisasi & dijaga di dalam folderPath (anti-traversal).
 */

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const folder = await resolveProjectFolder(slug);
    if (!folder) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const relative = new URL(request.url).searchParams.get('path') ?? '';
    const resolved = path.resolve(folder, relative);
    if (!resolved.startsWith(path.resolve(folder) + path.sep)) {
      return NextResponse.json({ error: 'Path di luar folder project' }, { status: 400 });
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return NextResponse.json({ error: 'Berkas tidak ditemukan' }, { status: 404 });
    }

    const ext = path.extname(resolved).slice(1).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    const buffer = fs.readFileSync(resolved);
    const name = path.basename(resolved);

    // inline = tampil di viewer browser (PDF/gambar); octet-stream ikut ter-unduh.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `inline; filename="${name}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('[api/workspace/raw] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membaca berkas' }, { status: 500 });
  }
}
