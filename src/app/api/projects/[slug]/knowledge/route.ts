import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { addKnowledge, ensureKnowledgeSchema, listKnowledge, removeKnowledge } from '@/lib/db/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Maks 64 file per operasi — panel kecil, cukup untuk drag-drop bertumpuk. */
const MAX_PATHS = 64;

/**
 * "Basis Pengetahuan" — daftar file workspace (path relatif folder project)
 * yang boleh dicari agent secara detail.
 *  - GET    : list {items:[{path, addedAt, exists}]} — exists dicek ke disk.
 *  - POST   : {paths: string[]} → insert-or-ignore → {items, added}.
 *  - DELETE : {path} → hapus baris (file di disk gak disentuh).
 */

const postSchema = z.object({
  paths: z.array(z.string().min(1).max(1024)).min(1).max(MAX_PATHS),
});

const deleteSchema = z.object({
  path: z.string().min(1).max(1024),
});

/** Normalisasi path relatif: '\\'-separator Windows → '/', buang leading './', trim. */
function normalizeRelPath(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return cleaned;
}

/** Validasi keamanan: path resolve WAJIB di dalam folder project + file-nya ada. */
function isSafeExistingFile(folderPath: string, relPath: string): boolean {
  const root = path.resolve(folderPath);
  const absolute = path.resolve(root, relPath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return false;
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    ensureKnowledgeSchema();
    return NextResponse.json({ items: listKnowledge(rows[0].id, rows[0].folderPath) });
  } catch (error) {
    console.error('[api/projects/knowledge] GET gagal:', error);
    return NextResponse.json({ error: 'gagal membaca pengetahuan' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
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

    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_PATHS} path per operasi`, details: parsed.error.issues },
        { status: 400 },
      );
    }

    // Dedup + urutan stabil sesuai input (semua tipe/file yang bebas — hanya
    // butuh menunjuk file nyata di dalam folder project).
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const raw of parsed.data.paths) {
      const rel = normalizeRelPath(raw);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      paths.push(rel);
    }
    if (paths.length === 0) {
      return NextResponse.json({ error: 'Tidak ada path yang valid' }, { status: 400 });
    }

    ensureKnowledgeSchema();
    const invalid = paths.filter((rel) => !isSafeExistingFile(folderPath, rel));
    if (invalid.length > 0) {
      return NextResponse.json({ error: 'Ada file yang bukan milik project atau tidak ada', invalid }, { status: 400 });
    }

    const result = addKnowledge(rows[0].id, folderPath, paths);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[api/projects/knowledge] POST gagal:', error);
    return NextResponse.json({ error: 'gagal menyimpan pengetahuan' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    }

    ensureKnowledgeSchema();
    removeKnowledge(rows[0].id, normalizeRelPath(parsed.data.path));
    // Folder disk tidak disentuh — file fisik tetap ada.
    return NextResponse.json({ ok: true, items: listKnowledge(rows[0].id, rows[0].folderPath) });
  } catch (error) {
    console.error('[api/projects/knowledge] DELETE gagal:', error);
    return NextResponse.json({ error: 'gagal menghapus pengetahuan' }, { status: 500 });
  }
}
