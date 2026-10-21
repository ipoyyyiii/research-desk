import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { parseBib } from '@/lib/journals/bib';
import { checkCitations } from '@/lib/citations/check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const exec = promisify(execFile);

/**
 * Ekspor .md → .docx/pdf dengan SITASI dikerjakan pandoc:
 * - `[@key]` di teks + references.bib → --citeproc → sitasi berformat (APA/IEEE)
 *   + daftar pustaka otomatis di akhir dokumen.
 * - `out:'pdf'`: pandoc → html5 + assets/pdf.css → tool PDF lokal (weasyprint).
 * - Path sumber dikunci di dalam folder project (blokir `..`).
 * - Output ditulis DISEBELAH file sumber (bisa dibuka/unduh via /raw).
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

/** Tool PDF lokal: weasyprint dulu, fallback wkhtmltopdf. Null kalau tidak ada. */
async function findPdfTool(): Promise<'weasyprint' | 'wkhtmltopdf' | null> {
  for (const tool of ['weasyprint', 'wkhtmltopdf'] as const) {
    const ok = await exec('sh', ['-c', `command -v ${tool}`]).then(() => true).catch(() => false);
    if (ok) return tool;
  }
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await request.json().catch(() => null)) as
      | { path?: string; style?: string; out?: 'docx' | 'pdf'; bibliographyTitle?: string }
      | null;
    const rel = (body?.path ?? '').trim();
    const style = body?.style ?? 'apa';
    const outFmt = body?.out === 'pdf' ? 'pdf' : 'docx';
    const bibliographyTitle =
      (body?.bibliographyTitle ?? '').trim().slice(0, 120) || 'Daftar Pustaka';

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

    // Cek sitasi SEBELUM ekspor: key `[@x]` tanpa entri bikin pandoc menulis
    // "(x?)" diam-diam (exit 0), jadi peringatannya kita hitung sendiri.
    const markdown = await fs.readFile(src, 'utf8').catch(() => '');
    const bibKeys = bib
      ? parseBib(await fs.readFile(bibAbs, 'utf8').catch(() => '')).map((entry) => entry.key)
      : [];
    const citationCheck = checkCitations(markdown, bibKeys);
    const warnings = {
      missingCitations: citationCheck.missing,
      unusedEntries: citationCheck.unused.length,
    };

    const base = path.basename(src, path.extname(src));
    const outDir = path.dirname(rel.replace(/^\/+/, ''));

    if (outFmt === 'pdf') {
      const tool = await findPdfTool();
      if (!tool) {
        return NextResponse.json({ error: 'Gagal: tool PDF belum terpasang' }, { status: 500 });
      }

      // HTML perantara HARUS di dalam folder project — gambar relative resolve via cwd.
      const tmpHtml = path.join(folder, `.tmp-export-${Date.now()}.html`);
      try {
        const args = [
          src,
          '-f', 'markdown',
          '-t', 'html5',
          '--standalone',
          '--metadata', `title=${base}`,
          '--resource-path', folder,
          '--css', path.join(process.cwd(), 'assets', 'pdf.css'),
          '-o', tmpHtml,
        ];
        if (bib) {
          args.push(
            '--citeproc',
            '--bibliography',
            bibAbs,
            '--csl',
            cslAbs,
            '--metadata',
            `reference-section-title=${bibliographyTitle}`,
          );
        }

        await exec('pandoc', args, { timeout: 90_000, maxBuffer: 24 * 1024 * 1024 });

        const outRel = path.join(outDir, `${base}-export.pdf`);
        const outAbs = path.join(folder, outRel);

        // cwd=folder biar path gambar relatif di HTML kena.
        await exec(tool, [path.basename(tmpHtml), outAbs], {
          cwd: folder,
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        });

        return NextResponse.json({ ok: true, out: outRel, citeproc: bib, warnings });
      } finally {
        await fs.rm(tmpHtml, { force: true }).catch(() => undefined);
      }
    }

    const args = [src, '-f', 'markdown', '-t', 'docx', '--resource-path', folder];
    if (bib) {
      args.push(
        '--citeproc',
        '--bibliography',
        bibAbs,
        '--csl',
        cslAbs,
        '--metadata',
        `reference-section-title=${bibliographyTitle}`,
      );
    }

    const outRel = path.join(outDir, `${base}-export.docx`);
    const outAbs = path.join(folder, outRel);

    await exec('pandoc', [...args, '-o', outAbs], { timeout: 90_000, maxBuffer: 24 * 1024 * 1024 });

    return NextResponse.json({ ok: true, out: outRel, citeproc: bib, warnings });
  } catch (error) {
    console.error('[api/projects/export] POST gagal:', error);
    return NextResponse.json({ error: 'Ekspor gagal' }, { status: 500 });
  }
}
