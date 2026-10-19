import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manifest pack font WordCraft (fase 12): daftar file font (metric Word +
 * Google Docs) yang ditanam ke IndexedDB `wordcraft` oleh seeder di client.
 * File fisik di `data/wordcraft-fonts/` (dibangun oleh skrip pack, di luar git).
 */
const PACK_DIR = path.join(process.cwd(), 'data', 'wordcraft-fonts');
const MANIFEST = path.join(PACK_DIR, 'manifest.json');

export async function GET() {
  try {
    const raw = await fs.readFile(MANIFEST, 'utf8');
    const json = JSON.parse(raw) as unknown;
    return NextResponse.json(json, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'wordcraft-pack-not-found', fonts: [] }, { status: 404 });
  }
}
