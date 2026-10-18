import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PDF route (fase 3): ambil PDF open-access untuk kai DOI.
 * Keamanan SSRF: URL PDF TIDAK PERNAH dari client — server yang resolve
 * sendiri via OpenAlex (best_oa_location) / Semantic Scholar (openAccessPdf).
 * Hasil unduhan disimpan ke `<project>/referensi/papers/` lalu di-serve inline.
 */

const querySchema = z.object({
  doi: z.string().min(8).max(200),
  slug: z.string().min(1),
});

const UA =
  'research-desk/0.1 (+thesis assistant; polite pool)';

/** Kumpulkan kandidat URL PDF OA untuk satu DOI — semua dari sumber server, bukan client. */
async function resolveOpenAccessPdfCandidates(doiRaw: string): Promise<string[]> {
  const doi = normalizeDoi(doiRaw);
  if (!doi) return [];

  const candidates: string[] = [];

  // 0) Pola arXiv: DOI 10.48550/arXiv.<id> → PDF kanonik arxiv.
  const arxiv = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
  if (arxiv) candidates.push(`https://arxiv.org/pdf/${arxiv[1]}`);

  // 1) OpenAlex: best_oa + primary + SEMUA locations yang ber-pdf.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(
      `https://api.openalex.org/works/doi:${doi}`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (res.ok) {
      const json = (await res.json()) as {
        best_oa_location?: { pdf_url?: string | null } | null;
        primary_location?: { pdf_url?: string | null } | null;
        locations?: Array<{ pdf_url?: string | null }> | null;
      };
      for (const loc of [
        json.best_oa_location,
        json.primary_location,
        ...(json.locations ?? []),
      ]) {
        if (loc?.pdf_url) candidates.push(loc.pdf_url);
      }
    }
  } catch {
    // provider gagal → kandidat dari jalur lain
  }

  // 2) Semantic Scholar: openAccessPdf.url
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=externalIds,openAccessPdf`,
      { headers, signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (res.ok) {
      const json = (await res.json()) as { openAccessPdf?: { url?: string | null } | null };
      if (json.openAccessPdf?.url) candidates.push(json.openAccessPdf.url);
    }
  } catch {
    // sama — abaikan
  }

  // Hanya URL publik http(s) (blok host internal) + dedup.
  const seen = new Set<string>();
  return candidates.filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return isPublicHttpUrl(url);
  });
}

function normalizeDoi(doi: string): string | null {
  const stripped = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim();
  return /^10\.\d{4,9}\//.test(stripped) ? stripped.toLowerCase() : null;
}

function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    // Blok localhost / private-range biar gak jadi pintu SSRF
    if (host === 'localhost' || host.endsWith('.local')) return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (/::1$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parameter doi & slug wajib ada' }, { status: 400 });
    }
    const { doi, slug } = parsed.data;

    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    if (rows.length === 0 || !fs.existsSync(rows[0].folderPath)) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });
    }
    const folderPath = rows[0].folderPath;

    const candidates = await resolveOpenAccessPdfCandidates(doi);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'Tidak ada salinan open-access yang tersedia untuk DOI ini' },
        { status: 404 },
      );
    }

    // Coba tiap kandidat sampai dapat berkas yang beneran PDF (magic bytes).
    let buffer: Buffer | null = null;
    for (const candidate of candidates.slice(0, 6)) {
      try {
        const res = await fetch(candidate, {
          headers: { 'User-Agent': UA, Accept: 'application/pdf' },
          redirect: 'follow',
        });
        if (!res.ok) continue;
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length < 1200 || !data.subarray(0, 8).toString('latin1').startsWith('%PDF')) {
          continue; // HTML/paywall page → kandidat berikutnya
        }
        buffer = data;
        break;
      } catch {
        continue;
      }
    }
    if (!buffer) {
      return NextResponse.json(
        { error: 'Salinan open-access ketemu tapi unduhan PDF gagal (paywall/CDN)' },
        { status: 502 },
      );
    }

    const papersDir = path.join(folderPath, 'referensi', 'papers');
    fs.mkdirSync(papersDir, { recursive: true });
    const safeName = `${doi.replace(/^10\.\d{4,9}\//, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'paper'}.pdf`;
    const file = path.join(papersDir, safeName);
    fs.writeFileSync(file, buffer);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[api/journals/pdf] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal memproses PDF' }, { status: 200 });
  }
}
