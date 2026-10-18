import type { JournalCard } from './types';
import { buildCardId, normalizeDoi } from './merge';

const OPENALEX_BASE = 'https://api.openalex.org';

interface OpenAlexAuthorship {
  author?: { display_name?: string | null } | null;
}

interface OpenAlexLocation {
  source?: { display_name?: string | null } | null;
  landing_page_url?: string | null;
}

interface OpenAlexWork {
  id?: string | null;
  doi?: string | null;
  display_name?: string | null;
  authorships?: OpenAlexAuthorship[] | null;
  publication_year?: number | null;
  primary_location?: OpenAlexLocation | null;
  cited_by_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  open_access?: { oa_url?: string | null } | null;
  referenced_works?: string[] | null;
}

const OPENALEX_SOURCE = 'openalex' as const;

/** Rekonstruksi teks abstrak dari inverted index (posisi index → susun token berurutan). */
function reconstructAbstract(inverted: Record<string, number[]> | null | undefined): string | null {
  if (!inverted) return null;
  const entries = Object.entries(inverted);
  if (entries.length === 0) return null;

  let maxPosition = -1;
  for (const positions of Object.values(inverted)) {
    for (const position of positions) {
      if (position > maxPosition) maxPosition = position;
    }
  }
  if (maxPosition < 0) return null;

  const tokens: (string | undefined)[] = new Array(maxPosition + 1).fill(undefined);
  for (const [word, positions] of entries) {
    for (const position of positions) tokens[position] = word;
  }
  const text = tokens
    .filter((token): token is string => typeof token === 'string' && token.trim() !== '')
    .join(' ')
    .trim();
  return text !== '' ? text : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : null;
}

/** Map satu work OpenAlex → JournalCard; return null kalau title kosong / id tak bisa dibentuk. */
export function mapOpenAlexWork(work: OpenAlexWork): JournalCard | null {
  const title = cleanText(work.display_name);
  if (!title) return null;

  const doi = normalizeDoi(work.doi ?? null);
  const providerId = cleanText(work.id) ?? '';
  const id = doi ? doi : providerId !== '' ? buildCardId(null, OPENALEX_SOURCE, providerId) : null;
  if (!id) return null;

  return {
    id,
    title,
    authors: (work.authorships ?? [])
      .map((authorship) => cleanText(authorship?.author?.display_name) ?? '')
      .filter((name) => name !== ''),
    year: typeof work.publication_year === 'number' ? work.publication_year : null,
    venue: cleanText(work.primary_location?.source?.display_name),
    doi,
    citations: typeof work.cited_by_count === 'number' ? work.cited_by_count : 0,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    openAccessUrl: cleanText(work.open_access?.oa_url),
    landingUrl: cleanText(work.primary_location?.landing_page_url),
    source: OPENALEX_SOURCE,
  };
}

function withContactEmail(params: URLSearchParams): void {
  const email = process.env.JOURNAL_CONTACT_EMAIL ?? '';
  if (email.trim() !== '') params.set('mailto', email.trim());
}

/** Pencarian works OpenAlex. Selalu return array (error → []), tidak pernah throw. */
export async function fetchOpenAlex(
  query: string,
  limit: number,
  opts?: { yearFrom?: number; signal?: AbortSignal },
): Promise<JournalCard[]> {
  try {
    const url = new URL(`${OPENALEX_BASE}/works`);
    withContactEmail(url.searchParams);
    url.searchParams.set('search', query);
    url.searchParams.set('per-page', String(limit));
    if (opts?.yearFrom != null) {
      url.searchParams.set('filter', `from_publication_date:${opts.yearFrom}-01-01`);
    }

    const res = await fetch(url, { signal: opts?.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: OpenAlexWork[] };
    const works = Array.isArray(data.results) ? data.results : [];
    return works
      .map(mapOpenAlexWork)
      .filter((card): card is JournalCard => card !== null);
  } catch {
    return [];
  }
}

/**
 * Satu hop citation graph: work yang DIKUTIP oleh paper `doi` (referenced works).
 * `doi` = DOI telanjang berawalan "10." (sudah dinormalisasi pemanggil).
 * Error / tidak ketemu → [], tidak pernah throw.
 */
export async function fetchOpenAlexReferenced(
  doi: string,
  limit: number,
  signal?: AbortSignal,
): Promise<JournalCard[]> {
  try {
    const workUrl = new URL(`${OPENALEX_BASE}/works/doi:${doi}`);
    withContactEmail(workUrl.searchParams);

    const workRes = await fetch(workUrl, { signal });
    if (!workRes.ok) return [];
    const work = (await workRes.json()) as OpenAlexWork;

    const referenced = Array.isArray(work.referenced_works) ? work.referenced_works : [];
    const ids = referenced
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .slice(0, Math.min(Math.max(limit, 0), 25));
    if (ids.length === 0) return [];

    const listUrl = new URL(`${OPENALEX_BASE}/works`);
    withContactEmail(listUrl.searchParams);
    listUrl.searchParams.set('filter', `ids.openalex:${ids.join('|')}`);
    listUrl.searchParams.set('per-page', '25');

    const res = await fetch(listUrl, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: OpenAlexWork[] };
    const works = Array.isArray(data.results) ? data.results : [];
    return works
      .map(mapOpenAlexWork)
      .filter((card): card is JournalCard => card !== null)
      .slice(0, limit);
  } catch {
    return [];
  }
}
