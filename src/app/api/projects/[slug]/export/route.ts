import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const exec = promisify(execFile);

/**
 * Ekspor .md → .docx dengan SITASI dikerjakan pandoc:
 * - `[@key]` di teks + references.bib → --citeproc → sitasi berformat (APA/IEEE)
 *   + daftar pustaka otomatis di akhir dokumen.
 * - Path sumber dikunci di dalam folder project (blokir `..`).
 * - Output .docx ditulis DISEBELAH file sumber (bisa dibuka/unduh via /raw).
 */
const STYLE_CSL: Record<string, string> = {
  apa: 'apa.csl',
  ieee: 'ieee.csl',
};

/** Path absolut EMAN untuk file di dalam folder project (mirip file route). */
function resolveInside(root: string, relative: string): string | null {
  const cleaned = relative.replace(/^\/+/, '');
  const abs = path.resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await request.json().catch(() => null)) as { path?: string; style?: string } | null;
    const rel = (body?.path ?? '').trim();
    const style = body?.style ?? 'apa';

    if (rel.length === 0) {
      return NextResponse.json({ error: 'Path file wajib diisi' }, { status: 400 });
    }
    const cslName = STYLE_CSL[style];
    if (!cslName) {
      return NextResponse.json({ error: 'Gaya csl gak dikenal' }, { status: 400 });
    }

    const folder = await resolveProjectFolder(slug);
    if (!folder) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const src = resolveInside(folder, rel);
    if (!src) return NextResponse.json({ error: 'Path ilegal' }, { status: 400 });

    const stat = await fs.stat(src).catch(() => null);
    if (!stat?.isFile()) return NextResponse.json({ error: 'File sumber gak ada' }, { status: 404 });
    if (!/\.(md|markdown)$/i.test(src)) {
      return NextResponse.json({ error: 'Hanya file .md yang bisa diekspor' }, { status: 400 });
    }

    const cslAbs = path.join(process.cwd(), 'csl', cslName);
    const bibAbs = path.join(folder, 'references.bib');
    const bib = await fs.stat(bibAbs).then(() => true).catch(() => false);

    const args = [src, '-f', 'markdown', '-t', 'docx', '--resource-path', folder];
    if (bib) {
      args.push('--citeproc', '--bibliography', bibAbs, '--csl', cslAbs);
    }

    const base = path.basename(src, path.extname(src));
    const outRel = path.join(path.dirname(rel.replace(/^\/+/, '')), `${base}-export.docx`);
    const outAbs = path.join(folder, outRel);

    await exec('pandoc', [...args, '-o', outAbs], { timeout: 90_000, maxBuffer: 24 * 1024 * 1024 });

    return NextResponse.json({ ok: true, out: outRel, citeproc: bib });
  } catch (error) {
    console.error('[api/projects/export] POST gagal:', error);
    return NextResponse.json({ error: 'Ekspor DOCX gagal' }, { status: 500 });
  }
}
