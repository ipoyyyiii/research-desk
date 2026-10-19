import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { addKnowledge, ensureKnowledgeSchema } from '@/lib/db/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST multipart (field "file") khusus Basis Pengetahuan — simpan file ke
 * `<projectFolder>/pengetahuan/` (folder baru, gaya attachments/) lalu
 * langsung daftarkan path-nya ke tabel knowledge_files.
 * Maks 25 MB (413). Response: { path, name, size, items, added }.
 */

const MAX_KNOWLEDGE_SIZE = 25 * 1024 * 1024;
const KNOWLEDGE_DIR = 'pengetahuan';
/** Nama file aman maksimal 120 char (huruf/angka/titik/dash/underscore). */
const NAME_MAX = 120;

function sanitizeName(raw: string): string {
  const base = path.basename(raw ?? '');
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '');
  if (!cleaned) return 'file';
  if (cleaned.length <= NAME_MAX) return cleaned;
  const ext = path.extname(cleaned);
  const stem = cleaned.slice(0, Math.max(NAME_MAX - ext.length, 1));
  return `${stem}${ext}`;
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

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Field "file" wajib ada' }, { status: 400 });
    }
    if (file.size > MAX_KNOWLEDGE_SIZE) {
      return NextResponse.json({ error: 'Maksimal 25 MB' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_KNOWLEDGE_SIZE) {
      return NextResponse.json({ error: 'Maksimal 25 MB' }, { status: 413 });
    }

    const targetDir = path.join(folderPath, KNOWLEDGE_DIR);
    fs.mkdirSync(targetDir, { recursive: true });
    const dirReal = fs.realpathSync(targetDir);
    if (dirReal !== folderPath && !dirReal.startsWith(folderPath + path.sep)) {
      return NextResponse.json({ error: 'Folder project tidak valid' }, { status: 400 });
    }

    const safe = sanitizeName(file.name);
    let finalName = safe;
    if (fs.existsSync(path.join(targetDir, finalName))) {
      // Collision → prefix timestamp biar unik (pola attachments/).
      finalName = `${Date.now()}-${safe}`;
    }
    await fsp.writeFile(path.join(targetDir, finalName), buffer);

    ensureKnowledgeSchema();
    const relPath = `${KNOWLEDGE_DIR}/${finalName}`;
    // Langsung daftarkan — drop OS file = nambah pengetahuan sekaligus.
    const result = addKnowledge(rows[0].id, folderPath, [relPath]);

    return NextResponse.json(
      { path: relPath, name: finalName, size: buffer.byteLength, items: result.items, added: result.added },
      { status: 201 },
    );
  } catch (error) {
    console.error('[api/projects/knowledge/upload] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal menyimpan file pengetahuan' }, { status: 500 });
  }
}
