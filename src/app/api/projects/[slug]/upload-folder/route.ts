import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Folder tujuan yang sah + allowlist ekstensi per folder (snapshot tree). */
const FOLDER_RULES: Record<string, readonly string[]> = {
  dokumen: ['png', 'jpg', 'jpeg', 'webp', 'gif'], // gambar ilustrasi/plat draf
  referensi: ['pdf'], // paper jurnal (dipakai tab Jurnal/Perpustakaan)
  data: ['csv', 'xlsx', 'xls', 'json'], // tabel dataset analisis
};
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/** Format folder bebas: huruf/angka/_/- di dalam, '/' sebagai pemisah. */
const SUBFOLDER_PATTERN = /^[\w\-/]+$/;

/**
 * Folder root yang dipakai fitur lain (upload pengetahuan agent, dll) —
 * drop manual tidak boleh menimpa isian di sana.
 */
const RESERVED_ROOTS = new Set(['pengetahuan', 'node_modules', 'gambar']);

/**
 * Folder bebas (bukan dokumen/referensi/data): sub-path maksimal 3 segmen.
 * Tiap segmen non-kosong, tanpa '.' / '..' (traversal ditolak — dot gak lolos
 * regex), bukan RESERVED_ROOTS. Return string yang sah, null kalau ditolak.
 */
function normalizeSubfolder(raw: string): string | null {
  if (!SUBFOLDER_PATTERN.test(raw)) return null;
  const segments = raw.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  if (segments.length > 3) return null;
  if (RESERVED_ROOTS.has(segments[0])) return null;
  return raw;
}

/**
 * Sanitize nama: buang komponen path, karakter liar → '_', strip titik/underscore
 * di depan (anti dotfile/traversal), kosong → 'file'.
 */
function sanitizeName(raw: string): string {
  const base = path
    .basename(raw ?? '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/^[. _]+/, '')
    .trim();
  return base || 'file';
}

/** Collision di disk → suffix `-2`, `-3` sebelum ekstensi. */
function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let index = 2; fs.existsSync(path.join(dir, candidate)); index += 1) {
    candidate = `${stem}-${index}${ext}`;
  }
  return candidate;
}

const extOf = (name: string): string => path.extname(name).toLowerCase().replace('.', '');

/**
 * POST FormData:
 *  - `files` (beda field nama, bisa banyak) → simpan ke `<folderProject>/<folder>/`.
 *  - `folder` WAJIB:
 *      · `dokumen | referensi | data` → ekstensi di-limit allowlist per folder (l XIII);
 *      · folder bebas `[\w\-/]+` maks. 3 segmen (tanpa traversal, bukan folder reserved)
 *        → TANPA allowlist ekstensi — file apa pun boleh.
 * File > 25 MB → 413; allowlist dilanggar → 415; folder ilegal → 400.
 * Respons (201): { saved: ['dokumen/a.png', …], skipped: ['b.png', …] } —
 * path relatif dari root project, pemisah selalu '/'.
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
    const folderField = formData.get('folder');
    const folder =
      typeof folderField === 'string' && folderField.length > 0 ? folderField : null;
    const isSpecialFolder = folder !== null && Object.hasOwn(FOLDER_RULES, folder);
    const freeFolder = folder !== null && !isSpecialFolder ? normalizeSubfolder(folder) : null;
    if (!folder || (!isSpecialFolder && !freeFolder)) {
      return NextResponse.json({ error: 'Folder tidak valid' }, { status: 400 });
    }
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'Field "files" wajib ada' }, { status: 400 });
    }

    // Allowlist ekstensi HANYA untuk folder khusus — folder bebas menerima file apa pun.
    const allowed = isSpecialFolder ? FOLDER_RULES[folder] : null;
    for (const file of files) {
      if (allowed && !allowed.includes(extOf(sanitizeName(file.name)))) {
        return NextResponse.json({ error: 'Tipe file tidak didukung' }, { status: 415 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'Maksimal 25 MB per file' }, { status: 413 });
      }
    }

    const dir = path.join(folderPath, folder);
    fs.mkdirSync(dir, { recursive: true });

    const saved: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      try {
        const name = uniqueName(dir, sanitizeName(file.name));
        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(path.join(dir, name), buffer);
        saved.push(`${folder}/${name}`);
      } catch (error) {
        console.error('[api/upload-folder] gagal simpan file:', error);
        skipped.push(sanitizeName(file.name));
      }
    }

    return NextResponse.json({ saved, skipped }, { status: 201 });
  } catch (error) {
    console.error('[api/upload-folder] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal unggah file' }, { status: 500 });
  }
}
