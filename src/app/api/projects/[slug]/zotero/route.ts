import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
 * - PUT resync: force re-sync — refresh entri yang pernah di-import (key
 *   dijaga, isi di-ganti) + tambah yang baru. Peta item↔key buat deteksi
 *   berubah disimpen di data/zotero-map-<slug>.json (0600).
 * - GET       : status koneksi (kredensial tersimpen + userID; key tidak pernah lolos).
 */

const credsSchema = z.object({
  action: z.literal('save'),
  userId: z.string().regex(/^[0-9]{6,12}$/, 'userId'),
  apiKey: z.string().regex(/^[A-Za-z0-9]{12,64}$/, 'apiKey'),
});
const syncSchema = z.object({ action: z.literal('sync') });
const resyncSchema = z.object({ action: z.literal('resync') });
const credsBodySchema = z.union([credsSchema, syncSchema]);

const credsPath = (slug: string) => path.join(process.cwd(), 'data', `zotero-${slug}.json`);
const mapPath = (slug: string) => path.join(process.cwd(), 'data', `zotero-map-${slug}.json`);

/** Peta bookkeeping Zotero item ↔ entry bib (isi hash utk deteksi berubah). */
type MapPair = { itemKey: string; bibKey: string; hash: string };

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

const isMapPair = (value: unknown): value is MapPair => {
  if (typeof value !== 'object' || value === null) return false;
  const pair = value as Record<string, unknown>;
  return (
    typeof pair.itemKey === 'string' &&
    pair.itemKey !== '' &&
    typeof pair.bibKey === 'string' &&
    pair.bibKey !== '' &&
    typeof pair.hash === 'string' &&
    pair.hash !== ''
  );
};

/** Peta lama (null = file belum ada / rusak → mode fallback per-key). */
async function loadZoteroMap(slug: string): Promise<MapPair[] | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(mapPath(slug), 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isMapPair) : null;
  } catch {
    return null;
  }
}

/** Tulis file lewat sementara lalu rename — baca konsisten tanpa file setengah jadi. */
async function atomicWrite(filePath: string, content: string, mode = 0o644): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, { mode });
  await fs.rename(tmp, filePath);
}

/** Peta gagal ditulis bukan fatal — re-sync berikutnya jatuh ke mode fallback. */
async function writeZoteroMap(slug: string, pairs: MapPair[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(mapPath(slug)), { recursive: true });
    await atomicWrite(mapPath(slug), JSON.stringify(pairs), 0o600);
  } catch (error) {
    console.error('[api/projects/zotero] peta map gagal ditulis:', error);
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

/**
 * Item key tiap item (`format=json`, pagination sama `items/top` — urutan
 * default sort API identik). Export bibtex tidak mbawa item key, jadi peta
 * dibentuk berdasarkan posisi. Error ditembak ke atas (dipanggil dalam try).
 */
async function fetchZoteroItemKeys(creds: { apiKey: string } | null, userId: string): Promise<string[]> {
  const headers: Record<string, string> = { 'Zotero-API-Version': '3' };
  if (creds?.apiKey) headers['Zotero-API-Key'] = creds.apiKey;
  const keys: string[] = [];
  let start = 0;
  for (let page = 0; page < 200; page += 1) {
    const url = `https://api.zotero.org/users/${encodeURIComponent(userId)}/items/top?format=json&limit=100&start=${start}`;
    const res = await fetch(url, { headers });
    if (res.status === 404) throw new Error('errUser');
    if (res.status === 401 || res.status === 403) throw new Error('errForbidden');
    if (!res.ok) throw new Error('errUpstream');
    const chunk = await res.text();
    if (chunk.trim() === '') break;
    const parsed = JSON.parse(chunk) as unknown;
    if (!Array.isArray(parsed)) throw new Error('errUpstream');
    for (const item of parsed) {
      const itemKey = (item as { key?: unknown }).key;
      if (typeof itemKey === 'string' && itemKey !== '') keys.push(itemKey);
    }
    const totalRaw = res.headers.get('Total-Results');
    const total = totalRaw ? Number(totalRaw) : null;
    start += 100;
    if (total !== null && start >= total) break;
  }
  return keys;
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

/** Entri export bibtex + pasangan item key (dari posisi JSON, sekadar informasi). */
type ExportEntry = { text: string; key: string | null; itemKey: string | null };

function alignExport(bibText: string, itemKeys: string[]): ExportEntry[] {
  const chunks = splitEntries(bibText);
  // Pasangan valid cuma kalau jumlahnya nyambung 1:1 (Zotero konsist urut —
  // item yang gak jadi bibtex bikin misaligned → semua itemKey dibuang).
  const paired = itemKeys.length > 0 && itemKeys.length === chunks.length;
  return chunks.map((text, i) => ({
    text,
    key: entryKey(text),
    itemKey: paired ? itemKeys[i] ?? null : null,
  }));
}

/** Hash entry: normalisasi whitespace (\s+ → ' ') lalu sha256 hex. */
const hashEntry = (text: string): string => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');

/**
 * Potong entry export jadi [tipe, isi-setelah-key]: `@type{key, ... }` →
 * `@type{key,` + body. Brace-matching sederhana yang robust utk bibtex
 * (apa pun `@word{key, ... }` sampai kurung tutup sejajar).
 */
function splitEntryHead(entry: string): { type: string; body: string } | null {
  const head = /^(\s*)@(\w+)\s*\{/.exec(entry);
  if (!head) return null;
  const comma = entry.indexOf(',', head[0].length);
  if (comma < 0) return null;
  let depth = 1;
  let end = comma + 1;
  while (end < entry.length && depth > 0) {
    const ch = entry[end];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    end += 1;
  }
  if (depth !== 0) return null;
  return { type: head[2], body: entry.slice(comma + 1, end - 1) };
}

/**
 * Span entry `{key,` di file bib lama (`@word{key,` → kurung tutup sejajar)
 * — dipakai buat ganti isi entry tanpa menyentuh sisa file.
 */
function findEntrySpan(content: string, key: string): { start: number; end: number } | null {
  let cursor = 0;
  while (cursor < content.length) {
    const at = content.indexOf('@', cursor);
    if (at < 0) return null;
    const brace = content.indexOf('{', at);
    const nl = content.indexOf('\n', at);
    if (brace < 0 || (nl >= 0 && nl < brace)) {
      cursor = at + 1;
      continue;
    }
    const comma = content.indexOf(',', brace);
    if (comma < 0) return null;
    const cand = content.slice(brace + 1, comma).trim();
    let depth = 1;
    let end = comma + 1;
    while (end < content.length && depth > 0) {
      const ch = content[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      end += 1;
    }
    if (cand === key && depth === 0) return { start: at, end };
    cursor = end;
  }
  return null;
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

    const parsed = credsBodySchema.safeParse(await request.json());
    if (!parsed.success) return fail('zotero.errData', 400);

    if (parsed.data.action === 'save') {
      const creds = { userId: parsed.data.userId, apiKey: parsed.data.apiKey };
      await fs.mkdir(path.dirname(credsPath(slug)), { recursive: true });
      await fs.writeFile(credsPath(slug), JSON.stringify(creds), { mode: 0o600 });
      return NextResponse.json({ ok: true, userId: creds.userId });
    }

    // action === 'sync' (add-only)
    const creds = await loadCreds(slug);
    if (!creds) return fail('zotero.noCreds', 400);
    const bibText = await fetchZoteroBib(creds, creds.userId);
    let itemKeys: string[] = [];
    try {
      itemKeys = await fetchZoteroItemKeys(creds, creds.userId);
    } catch (error) {
      // Gak fatal: pull tetap add-only, cuma peta item↔key gak kebentuk.
      console.error('[api/projects/zotero] POST item keys gagal:', error);
    }
    const exportEntries = alignExport(bibText, itemKeys);

    const bibAbs = path.join(project.folderPath, 'references.bib');
    const old = await fs.readFile(bibAbs, 'utf8').catch(() => '');

    const keys = existingKeys(old);
    let fresh = '';
    let added = 0;
    const mapPairs: MapPair[] = [];
    for (const entry of exportEntries) {
      if (!entry.key || keys.has(entry.key)) continue;
      keys.add(entry.key);
      const text = entry.text.trim();
      fresh += `${fresh === '' ? '' : '\n\n'}${text}`;
      added += 1;
      if (entry.itemKey) {
        mapPairs.push({ itemKey: entry.itemKey, bibKey: entry.key, hash: hashEntry(text) });
      }
    }
    if (added > 0) {
      const base = old.trimEnd();
      await fs.writeFile(bibAbs, `${base}${base ? '\n\n' : ''}${fresh}\n`, 'utf8');
      if (mapPairs.length > 0) {
        // Merge ke peta lama — pull cuma nambah entri, rekaman lama kejaga.
        const stored = await loadZoteroMap(slug);
        const merged = new Map((stored ?? []).map((pair) => [pair.itemKey, pair] as const));
        for (const pair of mapPairs) merged.set(pair.itemKey, pair);
        await writeZoteroMap(slug, [...merged.values()]);
      }
    }
    return NextResponse.json({ ok: true, added, total: keys.size });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('err') ? error.message : 'errUpstream';
    console.error('[api/projects/zotero] POST gagal:', code, error);
    return NextResponse.json({ error: `zotero.${code}` }, { status: 502 });
  }
}

/**
 * PUT resync — force re-sync: bibKey lama dijaga (chip `[@bibKey]` di dokumen
 * gak bouls), isi entry di-refresh kalau hash export ~ hash tersimpan, entri
 * baru ditambah add-only di akhir; entry yang Zotero item-nya sudah terhapus
 * di bib dibiarkan. Peta ditulis ulang setelah sukses.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const project = await projectFromSlug(slug);
    if (!project) return fail('Project tidak ditemukan', 404);

    const parsed = resyncSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail('zotero.errData', 400);

    const creds = await loadCreds(slug);
    if (!creds) return fail('zotero.noCreds', 400);
    const bibText = await fetchZoteroBib(creds, creds.userId);
    let itemKeys: string[] = [];
    try {
      itemKeys = await fetchZoteroItemKeys(creds, creds.userId);
    } catch (error) {
      // Gak fatal: re-sync lanjut mode key-fallback tanpa pasangan item.
      console.error('[api/projects/zotero] PUT item keys gagal:', error);
    }
    const exportEntries = alignExport(bibText, itemKeys);

    const bibAbs = path.join(project.folderPath, 'references.bib');
    const content = await fs.readFile(bibAbs, 'utf8').catch(() => '');
    const storedMap = await loadZoteroMap(slug);
    const byItemKey = new Map((storedMap ?? []).map((pair) => [pair.itemKey, pair] as const));
    const bibKeys = existingKeys(content);

    const replacements: { start: number; end: number; text: string }[] = [];
    const appended: string[] = [];
    const mapPairs: MapPair[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of exportEntries) {
      const hash = hashEntry(entry.text);
      const stored = entry.itemKey ? byItemKey.get(entry.itemKey) : undefined;
      if (stored && entry.itemKey) {
        // Entri pernah di-import + tercatat di peta: keputusan via hash.
        mapPairs.push({ itemKey: entry.itemKey, bibKey: stored.bibKey, hash });
        if (hash === stored.hash) {
          skipped += 1;
          continue;
        }
        const head = splitEntryHead(entry.text);
        if (!head) {
          skipped += 1;
          continue;
        }
        const text = `@${head.type}{${stored.bibKey},${head.body}`;
        const span = findEntrySpan(content, stored.bibKey);
        if (span) replacements.push({ start: span.start, end: span.end, text });
        else appended.push(text); // key gak ketemu lagi (dihapus manual) → muat balik
        updated += 1;
        continue;
      }
      if (storedMap === null && entry.key && bibKeys.has(entry.key)) {
        // Fallback data lama (peta belum kebentuk): entry dengan citation key
        // sama persis → treat sebagai updated (isi di-refresh, key sama).
        const head = splitEntryHead(entry.text);
        if (head) {
          const span = findEntrySpan(content, entry.key);
          const text = `@${head.type}{${entry.key},${head.body}`;
          if (span) replacements.push({ start: span.start, end: span.end, text });
          else appended.push(text);
          updated += 1;
        } else {
          skipped += 1;
        }
        if (entry.itemKey) mapPairs.push({ itemKey: entry.itemKey, bibKey: entry.key, hash });
        continue;
      }
      // Tanpa pasangan di peta: add-only seperti pull sebelumnya.
      if (!entry.key || bibKeys.has(entry.key)) {
        skipped += 1;
        if (entry.key && entry.itemKey) {
          mapPairs.push({ itemKey: entry.itemKey, bibKey: entry.key, hash });
        }
        continue;
      }
      bibKeys.add(entry.key);
      appended.push(entry.text.trim());
      added += 1;
      if (entry.itemKey) mapPairs.push({ itemKey: entry.itemKey, bibKey: entry.key, hash });
    }

    let output = content;
    if (replacements.length > 0) {
      replacements.sort((a, b) => a.start - b.start);
      let out = '';
      let cursor = 0;
      for (const replace of replacements) {
        out += content.slice(cursor, replace.start) + replace.text;
        cursor = replace.end;
      }
      out += content.slice(cursor);
      output = out;
    }
    if (appended.length > 0) {
      const base = output.trimEnd();
      output = `${base}${base ? '\n\n' : ''}${appended.join('\n\n')}\n`;
    }
    if (output !== content) await atomicWrite(bibAbs, output);
    if (mapPairs.length > 0) await writeZoteroMap(slug, mapPairs);
    return NextResponse.json({ ok: true, added, updated, skipped });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('err') ? error.message : 'errUpstream';
    console.error('[api/projects/zotero] PUT gagal:', code, error);
    return NextResponse.json({ error: `zotero.${code}` }, { status: 502 });
  }
}
