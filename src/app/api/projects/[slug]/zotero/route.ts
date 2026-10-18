import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Import Zotero → references.bib (fase 7).
 * - POST save : simpan kredensial ke data/zotero-<slug>.json (0600, di-gitignore).
 * - POST sync : tarik semua item top-level library user dari api.zotero.org
 *   (format=bibtex, paginated 100/page) → merge ADD-ONLY ke references.bib
 *   (key yang sudah ada gak disentuh — entry manual/jurnal kejaga).
 * - GET       : status koneksi (kredensial tersimpen + userID; key tidak pernah lolos).
 */

const credsSchema = z.object({
  action: z.literal('save'),
  userId: z.string().regex(/^[0-9]{6,12}$/, 'userId'),
  apiKey: z.string().regex(/^[A-Za-z0-9]{12,64}$/, 'apiKey'),
});
const syncSchema = z.object({ action: z.literal('sync') });
const bodySchema = z.union([credsSchema, syncSchema]);

const credsPath = (slug: string) => path.join(process.cwd(), 'data', `zotero-${slug}.json`);

async function loadCreds(slug: string): Promise<{ userId: string; apiKey: string } | null> {
  try {
    const raw = await fs.readFile(credsPath(slug), 'utf8');
    const parsed = JSON.parse(raw) as { userId?: string; apiKey?: string };
    if (!parsed.userId || !parsed.apiKey) return null;
    return { userId: parsed.userId, apiKey: parsed.apiKey };
  } catch {
    return null;
  }
}

/**
 * Tarik seluruh library → teks BibTeX mentah (Zotero API v3, `items/top`,
 * `format=bibtex`). Buffet error jadi kode pendek untuk i18n UI.
 */
async function fetchZoteroBib(creds: { apiKey: string } | null, userId: string): Promise<string> {
  const headers: Record<string, string> = { 'Zotero-API-Version': '3' };
  if (creds?.apiKey) headers['Zotero-API-Key'] = creds.apiKey;
  let all = '';
  let start = 0;
  try {
    for (let page = 0; page < 200; page += 1) {
      const url = `https://api.zotero.org/users/${encodeURIComponent(userId)}/items/top?format=bibtex&limit=100&start=${start}`;
      const res = await fetch(url, { headers });
      if (res.status === 404) throw new Error('errUser');
      if (res.status === 401 || res.status === 403) throw new Error('errForbidden');
      if (!res.ok) throw new Error('errUpstream');
      const chunk = await res.text();
      all += chunk;
      if (chunk.trim() === '') break;
      const totalRaw = res.headers.get('Total-Results');
      const total = totalRaw ? Number(totalRaw) : null;
      start += 100;
      if (total !== null && start >= total) break;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('err')) throw error;
    throw new Error('errNetwork');
  }
  return all;
}

/** Pecah teks BibTeX jadi entri individual (baris mulai `@type{key,`). */
function splitEntries(bib: string): string[] {
  const chunks: string[] = [];
  let cur: string[] | null = null;
  for (const line of bib.split('\n')) {
    if (/^\s*@\w+\s*[{(]/.test(line)) {
      if (cur) chunks.push(cur.join('\n'));
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) chunks.push(cur.join('\n'));
  return chunks;
}

const entryKey = (chunk: string): string | null =>
  /^\s*@\w+\s*[{(]\s*([^,\s]+)\s*,/.exec(chunk)?.[1] ?? null;

function existingKeys(bib: string): Set<string> {
  const set = new Set<string>();
  const re = /@\w+\s*[{(]\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bib)) !== null) set.add(m[1]);
  return set;
}

/** Kontrak balik: row project + validasi slug (tanpa traversal aneh). */
async function projectFromSlug(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0] ?? null;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);
    const creds = await loadCreds(slug);
    return NextResponse.json({ configured: creds !== null, userId: creds?.userId ?? null });
  } catch (error) {
    console.error('[api/projects/zotero] GET gagal:', error);
    return fail('errUpstream', 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail('zotero.errData', 400);

    if (parsed.data.action === 'save') {
      const creds = { userId: parsed.data.userId, apiKey: parsed.data.apiKey };
      await fs.mkdir(path.dirname(credsPath(slug)), { recursive: true });
      await fs.writeFile(credsPath(slug), JSON.stringify(creds), { mode: 0o600 });
      return NextResponse.json({ ok: true, userId: creds.userId });
    }

    // action === 'sync'
    const creds = await loadCreds(slug);
    if (!creds) return fail('zotero.noCreds', 400);
    const bibText = await fetchZoteroBib(creds, creds.userId);
    const bibAbs = path.join(project.folderPath, 'references.bib');
    const old = await fs.readFile(bibAbs, 'utf8').catch(() => '');

    const keys = existingKeys(old);
    let fresh = '';
    let added = 0;
    for (const chunk of splitEntries(bibText)) {
      const key = entryKey(chunk);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      fresh += `${fresh === '' ? '' : '\n\n'}${chunk.trim()}`;
      added += 1;
    }
    if (added > 0) {
      const base = old.trimEnd();
      await fs.writeFile(bibAbs, `${base}${base ? '\n\n' : ''}${fresh}\n`, 'utf8');
    }
    return NextResponse.json({ ok: true, added, total: keys.size });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('err') ? error.message : 'errUpstream';
    console.error('[api/projects/zotero] POST gagal:', code, error);
    return NextResponse.json({ error: `zotero.${code}` }, { status: 502 });  }
}
