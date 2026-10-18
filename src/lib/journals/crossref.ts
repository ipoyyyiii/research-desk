import type { JournalCard } from './types';
import { buildCardId } from './merge';

const CROSSREF_BASE = 'https://api.crossref.org/works';

interface CrossrefWork {
  title?: string[] | null;
  author?: Array<{ given?: string | null; family?: string | null }> | null;
  issued?: { 'date-parts'?: number[][] | null } | null;
  'container-title'?: string[] | null;
  publisher?: string | null;
  DOI?: string | null;
  'is-referenced-by-count'?: number | null;
  abstract?: string | null;
  link?: Array<{ URL?: string | null; 'content-type'?: string | null }> | null;
  URL?: string | null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed !== '' ? trimmed : null;
}

/** Abstract Crossref berupa JATS XML — buang tag sederhana dengan regex. */
function stripJatsXml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = cleanText(raw.replace(/<[^>]+>/g, ' '));
  return text;
}

function mapCrossrefWork(item: CrossrefWork): JournalCard | null {
  const title = cleanText(item.title?.[0]);
  if (!title) return null;

  const doiRaw = cleanText(item.DOI);
  const doi = doiRaw ? `https://doi.org/${doiRaw.toLowerCase()}` : null;
  const id = doi ? doi : doiRaw ? buildCardId(null, 'crossref', doiRaw.toLowerCase()) : null;
  if (!id) return null;

  const yearPart = item.issued?.['date-parts']?.[0]?.[0];
  const pdfLink =
    (item.link ?? []).find((link) => link['content-type'] === 'application/pdf' && cleanText(link.URL))
      ?.URL ?? null;

  return {
    id,
    title,
    authors: (item.author ?? [])
      .map((author) => `${author.given ?? ''} ${author.family ?? ''}`.trim())
      .filter((name) => name !== ''),
    year: typeof yearPart === 'number' ? yearPart : null,
    venue: cleanText(item['container-title']?.[0]) ?? cleanText(item.publisher),
    doi,
    citations: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : 0,
    abstract: stripJatsXml(item.abstract),
    openAccessUrl: pdfLink,
    landingUrl: cleanText(item.URL),
    source: 'crossref',
  };
}

/** Pencarian works Crossref. Selalu return array (error → []), tidak pernah throw. */
export async function fetchCrossref(
  query: string,
  limit: number,
  opts?: { signal?: AbortSignal },
): Promise<JournalCard[]> {
  try {
    const url = new URL(CROSSREF_BASE);
    url.searchParams.set('query', query);
    url.searchParams.set('rows', String(limit));
    const email = process.env.JOURNAL_CONTACT_EMAIL ?? '';
    if (email.trim() !== '') url.searchParams.set('mailto', email.trim());

    const res = await fetch(url, { signal: opts?.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { message?: { items?: CrossrefWork[] } };
    const items = Array.isArray(data.message?.items) ? (data.message?.items ?? []) : [];
    return items
      .map(mapCrossrefWork)
      .filter((card): card is JournalCard => card !== null);
  } catch {
    return [];
  }
}
