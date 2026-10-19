import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const moveSchema = z.object({
  from: z.string().min(1).max(500),
  to: z.string().min(1).max(500),
});

/**
 * Resolve path relatif yang AMAN di dalam folder project: tanpa null byte,
 * backslash, segmen kosong / '.' / '..', hasil resolve harus tetap di root
 * project (anti traversal). Return absolut, atau null kalau ditolak.
 */
function resolveInside(folder: string, relative: string): string | null {
  if (relative.includes('\0') || relative.includes('\\')) return null;
  const segments = relative.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  const absolute = path.resolve(folder, relative);
  if (!absolute.startsWith(folder + path.sep)) return null;
  return absolute;
}

/**
 * POST JSON { from, to } → pindahkan FILE di disk (folder masih 400):
 *  - `from` harus file nyata di dalam project (not folder, not symlink keluar).
 *  - `to` harus file BARU di dalam FOLDER EKSISTING (exists → 409).
 *  - Move pakai rename; kalau beda mount (EXDEV) → fallback copy biner + unlink.
 * Respons (200): { path: to }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const folderPath = rows[0].folderPath;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return NextResponse.json({ error: 'Folder project tidak ada' }, { status: 400 });
    }

    const parsed = moveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { from, to } = parsed.data;
    if (from === to) {
      return NextResponse.json({ error: 'Sumber dan target sama' }, { status: 400 });
    }

    const fromAbs = resolveInside(folderPath, from);
    const toAbs = resolveInside(folderPath, to);
    if (!fromAbs || !toAbs) {
      return NextResponse.json({ error: 'Path tidak valid' }, { status: 400 });
    }

    // Sumber harus file nyata (bukan folder) dan gak symlink-escape keluar project.
    let fromReal: string;
    try {
      const fromStat = fs.statSync(fromAbs);
      if (fromStat.isDirectory()) {
        return NextResponse.json({ error: 'Folder belum didukung' }, { status: 400 });
      }
      if (!fromStat.isFile()) {
        return NextResponse.json({ error: 'Path tidak valid' }, { status: 400 });
      }
      fromReal = fs.realpathSync(fromAbs);
    } catch {
      return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 404 });
    }
    if (!fromReal.startsWith(folderPath + path.sep)) {
      return NextResponse.json({ error: 'File di luar folder project' }, { status: 400 });
    }

    // Target harus punya FOLDER INDUK yang sudah eksis (dan masih di dalam project).
    const toParentAbs = path.dirname(toAbs);
    try {
      const parentStat = fs.statSync(toParentAbs);
      if (!parentStat.isDirectory()) {
        return NextResponse.json({ error: 'Folder tujuan tidak ada' }, { status: 400 });
      }
      const parentReal = fs.realpathSync(toParentAbs);
      if (!parentReal.startsWith(folderPath + path.sep)) {
        return NextResponse.json({ error: 'Folder tujuan tidak ada' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Folder tujuan tidak ada' }, { status: 400 });
    }

    // Target file belum ada — jangan menimpa apa pun.
    if (fs.existsSync(toAbs)) {
      return NextResponse.json({ error: 'Target sudah ada' }, { status: 409 });
    }

    try {
      fs.renameSync(fromAbs, toAbs);
    } catch (error) {
      // Beda mount/filesystem (EXDEV) → salin biner lalu hapus sumber.
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        try {
          const buffer = await fsp.readFile(fromAbs);
          await fsp.writeFile(toAbs, buffer);
          await fsp.rm(fromAbs);
        } catch (copyError) {
          console.error('[api/projects/file/move] fallback copy EXDEV gagal:', copyError);
          return NextResponse.json({ error: 'Gagal mindahin file' }, { status: 500 });
        }
      } else {
        console.error('[api/projects/file/move] POST gagal:', error);
        return NextResponse.json({ error: 'Gagal mindahin file' }, { status: 500 });
      }
    }

    return NextResponse.json({ path: to });
  } catch (error) {
    console.error('[api/projects/file/move] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal mindahin file' }, { status: 500 });
  }
}
