import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const exec = promisify(execFile);

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Terima hasil simpan dari WordCraft, kembalikan TEKS markdown yang bisa ditulis
 * balik ke file bab.
 *
 * WordCraft menyimpan dokumennya sebagai .docx (format aslinya), bahkan kalau
 * file sumbernya markdown. Jadi tombol "Save" di Word menghasilkan ZIP docx —
 * bukan markdown. Tanpa konversi, file .md gak bisa balik otomatis.
 *
 * Dua jalur:
 * - byte ZIP (docx) → pandoc docx → gfm markdown, lalu marker sitasi `[@key]`
 *   yang di-escape pandoc dikembalikan ke bentuk aslinya.
 * - byte lain (teks biasa) → dipakai apa adanya.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = (await request.json().catch(() => null)) as
      | { name?: string; base64?: string }
      | null;
    const name = (body?.name ?? '').trim();
    const base64 = body?.base64 ?? '';
    if (!name || !base64) {
      return NextResponse.json({ error: 'name dan base64 wajib diisi' }, { status: 400 });
    }

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) {
      return NextResponse.json({ error: 'File kosong' }, { status: 400 });
    }
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: 'File terlalu besar' }, { status: 413 });
    }

    // Dokumen WordCraft = ZIP (magic "PK"). Selain itu, teks biasa.
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!isZip) {
      return NextResponse.json({ content: bytes.toString('utf8'), format: 'text' });
    }

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rd-word-'));
    const tmpDocx = path.join(tmpDir, 'doc.docx');
    try {
      await fs.writeFile(tmpDocx, bytes);
      let stdout: string;
      try {
        const res = await exec(
          'pandoc',
          ['-f', 'docx', '-t', 'gfm', '--wrap=none', tmpDocx],
          { maxBuffer: 32 * 1024 * 1024, timeout: 60000 },
        );
        stdout = res.stdout;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'pandoc gagal';
        return NextResponse.json(
          { error: `Konversi .docx → .md gagal: ${message}. Pakai File → Export → Markdown di WordCraft.` },
          { status: 501 },
        );
      }
      // Pandoc meng-escape marker sitasi -> kembalikan ke `[@key]` yang dipakai app.
      const content = stdout.replace(/\\\[@([\s\S]*?)\\\]/g, (_m, inner) => `[@${inner.replace(/\\@/g, '@')}]`);
      return NextResponse.json({ content, format: 'markdown' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memproses hasil simpan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
