import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serve satu file font dari pack WordCraft (`data/wordcraft-fonts/<name>`).
 * Nama file tervalidasi ketat (whitelist karakter + ekstensi, tanpa direktori)
 * supaya traversal tidak mungkin; response immutable (file pack tak berubah).
 */
const PACK_DIR = path.join(process.cwd(), 'data', 'wordcraft-fonts');
const NAME_RE = /^[A-Za-z0-9()+,._-]{1,128}\.(ttf|otf|ttc|otc|woff2|woff)$/;

const MIME: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  ttc: 'font/collection',
  otc: 'font/collection',
  woff2: 'font/woff2',
  woff: 'font/woff',
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  let file = '';
  try {
    file = decodeURIComponent(name);
  } catch {
    file = name;
  }
  if (!NAME_RE.test(file) || file.includes('..')) {
    return new NextResponse('bad font name', { status: 400 });
  }
  try {
    const bytes = await fs.readFile(path.join(PACK_DIR, file));
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('font not found', { status: 404 });
  }
}
