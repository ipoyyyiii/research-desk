import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { db } from '@/lib/db';
import { matrixRows, paperNotes, projects, revisionItems, savedPapers } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Backup satu project jadi file .zip berisi:
 * - seluruh isi folder project (naskah, gambar, referensi, data, hasil, riwayat versi)
 * - `_vibe-research/project.json` = baris database milik project ini
 *
 * Folder mesin (.venv, node_modules, .git, __pycache__) dilewati karena bisa
 * dibangun ulang. Backup sengaja dibuat mandiri: tanpa file json itu, riwayat
 * versi & data library tetap ada di folder, tapi binding project di app hilang.
 */

const SKIP_DIRS = new Set(['.venv', 'venv', 'node_modules', '.git', '__pycache__', 'site-packages', '.next']);
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

async function collectFiles(root: string): Promise<{ files: Array<{ abs: string; rel: string }>; total: number }> {
  const files: Array<{ abs: string; rel: string }> = [];
  let total = 0;
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(abs);
      total += stat.size;
      files.push({ abs, rel: path.relative(root, abs).split(path.sep).join('/') });
    }
  }

  return { files, total };
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const project = rows[0];
    if (!project) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const { files, total } = await collectFiles(project.folderPath);
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Folder project ${Math.round(total / 1024 / 1024)} MB, di atas batas backup 250 MB` },
        { status: 413 },
      );
    }

    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.rel, await fs.readFile(file.abs));
    }

    const [papers, matrix, notes, revisions] = await Promise.all([
      db.select().from(savedPapers).where(eq(savedPapers.slug, slug)),
      db.select().from(matrixRows).where(eq(matrixRows.slug, slug)),
      db.select().from(paperNotes).where(eq(paperNotes.slug, slug)),
      db.select().from(revisionItems).where(eq(revisionItems.slug, slug)),
    ]);

    const manifest = {
      format: 'vibe-research-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      project: {
        slug: project.slug,
        name: project.name,
        folderPath: project.folderPath,
        createdAt: project.createdAt,
        opencodeSessionId: project.opencodeSessionId,
      },
      savedPapers: papers,
      matrixRows: matrix,
      paperNotes: notes,
      revisionItems: revisions,
      fileCount: files.length,
      totalBytes: total,
    };
    zip.file('_vibe-research/project.json', JSON.stringify(manifest, null, 2));
    zip.file(
      '_vibe-research/README.txt',
      [
        'Backup project Vibe Research',
        '',
        'Isi zip ini:',
        '- seluruh folder project (naskah, gambar, referensi, data, hasil, .riwayat)',
        '- _vibe-research/project.json: data aplikasi (project, pustaka tersimpan,',
        '  matriks literatur, catatan paper, item revisi)',
        '',
        'Cara pakai: ekstrak isi zip ini ke folder pilihan, lalu jalankan',
        'POST /api/projects/:slug/backup (impor) atau pasang folder lewat halaman awal.',
        '',
        `Dibuat: ${new Date().toISOString()}`,
        `Jumlah berkas: ${files.length}`,
      ].join('\n'),
    );

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${project.slug}-backup-${stamp}.zip`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('[api/projects/backup] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membuat backup' }, { status: 500 });
  }
}
