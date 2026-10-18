import type { JournalCard } from './types';
import { buildCardId } from './merge';

const S2_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const S2_FIELDS = 'title,authors,year,venue,externalIds,citationCount,abstract,openAccessPdf,url';

interface S2Paper {
  paperId?: string | null;
  title?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  year?: number | null;
  venue?: string | null;
  externalIds?: { DOI?: string | null } | null;
  citationCount?: number | null;
  abstract?: string | null;
  openAccessPdf?: { url?: string | null } | null;
  url?: string | null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed !== '' ? trimmed : null;
}

function mapS2Paper(paper: S2Paper): JournalCard | null {
  const title = cleanText(paper.title);
  if (!title) return null;

  const externalDoi = cleanText(paper.externalIds?.DOI);
  const doi = externalDoi ? `https://doi.org/${externalDoi.toLowerCase()}` : null;
  const providerId = cleanText(paper.paperId) ?? '';
  const id = doi ? doi : providerId !== '' ? buildCardId(null, 'semantic-scholar', providerId) : null;
  if (!id) return null;

  return {
    id,
    title,
    authors: (paper.authors ?? [])
      .map((author) => cleanText(author?.name) ?? '')
      .filter((name) => name !== ''),
    year: typeof paper.year === 'number' ? paper.year : null,
    venue: cleanText(paper.venue),
    doi,
    citations: typeof paper.citationCount === 'number' ? paper.citationCount : 0,
    abstract: cleanText(paper.abstract),
    openAccessUrl: cleanText(paper.openAccessPdf?.url),
    landingUrl: cleanText(paper.url),
    source: 'semantic-scholar',
  };
}

/**
 * Pencarian papers Semantic Scholar. 429 / error ditangkap → return [] (tanpa retry loop, tanpa throw).
 */
export async function fetchSemanticScholar(
  query: string,
  limit: number,
  opts?: { signal?: AbortSignal },
): Promise<JournalCard[]> {
  try {
    const url = new URL(S2_SEARCH_URL);
    url.searchParams.set('fields', S2_FIELDS);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(limit));

    const headers: Record<string, string> = {};
    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY ?? '';
    if (apiKey.trim() !== '') headers['x-api-key'] = apiKey.trim();

    const res = await fetch(url, { headers, signal: opts?.signal });
    if (res.status === 429) return []; // rate limit → skip, jangan crash
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: S2Paper[] };
    const papers = Array.isArray(data.data) ? data.data : [];
    return papers
      .map(mapS2Paper)
      .filter((card): card is JournalCard => card !== null);
  } catch {
    return [];
  }
}
