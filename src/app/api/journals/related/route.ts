import { NextResponse } from 'next/server';
import { fetchOpenAlexReferenced } from '@/lib/journals/openalex';
import { normalizeDoi } from '@/lib/journals/merge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
const OPENALEX_TIMEOUT_MS = 10_000;
const DOI_URL_PREFIX = 'https://doi.org/';

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const limit = parseLimit(params.get('limit'));
    const doi = normalizeDoi(params.get('doi'));
    if (!doi) {
      return NextResponse.json({ results: [], source: 'openalex' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENALEX_TIMEOUT_MS);
    try {
      const bareDoi = doi.slice(DOI_URL_PREFIX.length);
      const results = await fetchOpenAlexReferenced(bareDoi, limit, controller.signal);
      return NextResponse.json({ results, source: 'openalex' });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('[api/journals/related] GET gagal:', error);
    return NextResponse.json({ results: [], source: 'openalex' });
  }
}
