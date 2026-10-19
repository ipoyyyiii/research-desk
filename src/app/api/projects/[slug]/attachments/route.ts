import { NextResponse } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Batas ukuran lampiran komposer AI (beda dari upload gambar di editor = 10 MB). */
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

const ATTACHMENTS_DIR = 'attachments';
/** Nama file aman maksimal 120 char (huruf/angka/titik/dash/underscore). */
const NAME_MAX = 120;

/** Sanitize nama file: buang karakter liar, jaga ekstensi, max 120 char. */
function sanitizeName(raw: string): string {
  const base = path.basename(raw ?? '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+/, '');
  if (!cleaned) return 'file';
  if (cleaned.length <= NAME_MAX) return cleaned;
  const ext = path.extname(cleaned);
  const stem = cleaned.slice(0, Math.max(NAME_MAX - ext.length, 1));
  return `${stem}${ext}`;
}

/**
 * POST formData (field "file") → simpan lampiran ke `<projectFolder>/attachments/`.
 * Folder project milik user (folderPath dari DB) — JANGAN pernah menyentuh data/.
 * Ukuran max 25 MB (413), nama di-sanitize + unique prefix timestamp bila collision.
 * Response: { path: 'attachments/<nama>', name, size }.
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

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Field "file" wajib ada' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json({ error: 'Maksimal 25 MB' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json({ error: 'Maksimal 25 MB' }, { status: 413 });
    }

    const targetDir = path.join(folderPath, ATTACHMENTS_DIR);
    fs.mkdirSync(targetDir, { recursive: true });
    const dirReal = fs.realpathSync(targetDir);
    if (dirReal !== folderPath && !dirReal.startsWith(folderPath + path.sep)) {
      return NextResponse.json({ error: 'Folder project tidak valid' }, { status: 400 });
    }

    const safe = sanitizeName(file.name);
    let finalName = safe;
    if (fs.existsSync(path.join(targetDir, finalName))) {
      // Collision → prefix timestamp biar unik (nama asli utuh bila masih bebas).
      finalName = `${Date.now()}-${safe}`;
    }
    await fsp.writeFile(path.join(targetDir, finalName), buffer);

    return NextResponse.json(
      { path: `${ATTACHMENTS_DIR}/${finalName}`, name: finalName, size: buffer.byteLength },
      { status: 201 },
    );
  } catch (error) {
    console.error('[api/projects/attachments] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal menyimpan lampiran' }, { status: 500 });
  }
}
