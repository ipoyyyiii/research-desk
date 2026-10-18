'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Quote, Search, X } from 'lucide-react';
import { useT } from '@/lib/preferences';

// Tab "Jurnal" (fase 3): cari paper lintas OpenAlex/Crossref/Semantic Scholar,
// simpan ke perpustakaan project (backend ikut menambah entri BibTeX).
// Kontrak API /api/journals/* ditulis lane backend — UI ngikut persis.

export type JournalSource = 'openalex' | 'crossref' | 'semantic-scholar';

/** Satu paper dari hasil search/terelasi — bentuknya persis kontrak backend. */
export type JournalCard = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null; // "https://doi.org/…"
  citations: number;
  abstract: string | null;
  openAccessUrl: string | null;
  landingUrl: string | null;
  source: JournalSource;
};

export type SortKey = 'relevance' | 'citations' | 'year';

/** Entri di GET /api-journals/saved — data paper + bibKey hasil konversi backend. */
export type SavedJournalEntry = {
  id: number;
  paperId: string;
  bibKey: string;
  paper: JournalCard;
  createdAt: string;
};

const SOURCE_BADGE: Record<JournalSource, string> = {
  openalex: 'OA',
  crossref: 'Crossref',
  'semantic-scholar': 'S2',
};

const SOURCE_LABEL: Record<JournalSource, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  'semantic-scholar': 'Semantic Scholar',
};

/** Nama sumber buat chip "Sumber aktif" — yang gak kenal ditampilkan apa adanya. */
function prettySource(name: string): string {
  return SOURCE_LABEL[name as JournalSource] ?? name;
}

/** URL buka paper: landing → DOI → Open Access; null kalau gak ada satu pun. */
export function paperOpenUrl(
  paper: Pick<JournalCard, 'landingUrl' | 'doi' | 'openAccessUrl'>,
): string | null {
  return paper.landingUrl ?? paper.doi ?? paper.openAccessUrl;
}

/** Payload respons longgar → JournalCard valid, atau null (skip, jangan crash). */
function parsePaper(value: unknown): JournalCard | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<JournalCard>;
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  const source: JournalSource =
    v.source === 'crossref' || v.source === 'semantic-scholar' ? v.source : 'openalex';
  return {
    id: v.id,
    title: v.title,
    authors: Array.isArray(v.authors)
      ? v.authors.filter((author): author is string => typeof author === 'string')
      : [],
    year: typeof v.year === 'number' ? v.year : null,
    venue: typeof v.venue === 'string' ? v.venue : null,
    doi: typeof v.doi === 'string' ? v.doi : null,
    citations: typeof v.citations === 'number' ? v.citations : 0,
    abstract: typeof v.abstract === 'string' ? v.abstract : null,
    openAccessUrl: typeof v.openAccessUrl === 'string' ? v.openAccessUrl : null,
    landingUrl: typeof v.landingUrl === 'string' ? v.landingUrl : null,
    source,
  };
}

export function parseSavedEntry(value: unknown): SavedJournalEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SavedJournalEntry>;
  const paper = parsePaper(v.paper);
  if (typeof v.id !== 'number' || typeof v.paperId !== 'string' || typeof v.bibKey !== 'string' || !paper) {
    return null;
  }
  return {
    id: v.id,
    paperId: v.paperId,
    bibKey: v.bibKey,
    paper,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };
}

function hasResults(key: 'results', data: unknown): data is { results: unknown[] } {
  return Boolean(data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key]));
}

export type PaperCardProps = {
  paper: JournalCard;
  slug: string;
  /** bibKey kalau paper ini sudah tersimpan di project → chip "✓ bibKey" non-aktif. */
  savedBibKey?: string;
  /** Diberikan di panel Jurnal: POST simpan, balikin bibKey atau null kalau gagal. */
  onSave?: (paper: JournalCard) => Promise<string | null>;
  /** Mode perpustakaan: dropdown Terelasi disembunyiin. */
  compact?: boolean;
  /** Diberikan di panel Perpustakaan: tombol ✕ buang. */
  onRemove?: () => void;
  /** Entri ini sedang dihapus (✕ mati). */
  removing?: boolean;
};

/** Kartu satu paper — dipakai panel Jurnal (hasil + terelasi) dan Perpustakaan. */
export function PaperCard({
  paper,
  slug,
  savedBibKey,
  onSave,
  compact = false,
  onRemove,
  removing = false,
}: PaperCardProps) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Terelasi: null = belum dimuat; open = tampil/tutup hasil mau cache-nya.
  const [related, setRelated] = useState<JournalCard[] | null>(null);
  const [relatedOpen, setRelatedOpen] = useState(false);

  const link = paperOpenUrl(paper);

  const handleSave = async () => {
    if (!onSave || saving || savedBibKey) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const bibKey = await onSave(paper);
      // gagal → biar chip pesan muncul, tombol bisa ditekan lagi
      if (bibKey === null) setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const toggleRelated = async () => {
    if (relatedOpen) {
      setRelatedOpen(false);
      return;
    }
    if (related) {
      setRelatedOpen(true);
      return;
    }
    try {
      const res = await fetch(`/api/journals/related?doi=${encodeURIComponent(paper.doi ?? '')}&limit=8`);
      const data: unknown = await res.json();
      if (!res.ok || !hasResults('results', data)) return;
      const cards = data.results.map(parsePaper).filter((card): card is JournalCard => card !== null);
      setRelated(cards.slice(0, 4));
      setRelatedOpen(true);
    } catch {
      // diam — toggle bisa ditekan lagi
    }
  };

  return (
    <article className="relative rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-800/60">
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          title={t('library.remove')}
          aria-label={t('library.remove')}
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-neutral-400 transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={12} />
        </button>
      )}

      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          title={link}
          className="block pr-5 text-[13px] font-medium leading-snug text-neutral-800 hover:underline dark:text-neutral-100"
        >
          {paper.title}
        </a>
      ) : (
        <span className="block pr-5 text-[13px] font-medium leading-snug">{paper.title}</span>
      )}

      {paper.authors.length > 0 && (
        <p
          className="mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400"
          title={paper.authors.join(', ')}
        >
          {paper.authors.join(', ')}
        </p>
      )}
      {(paper.year !== null || paper.venue !== null) && (
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
          {[paper.year, paper.venue].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span
          className="inline-flex items-center gap-0.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          title={t('journal.sortCitations')}
        >
          <Quote size={9} />
          {paper.citations}
        </span>
        <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {SOURCE_BADGE[paper.source]}
        </span>
      </div>

      {paper.abstract && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[11px] text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300">
            {t('journal.abstract')}
          </summary>
          <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
            {paper.abstract}
          </p>
        </details>
      )}

      <div className="mt-1.5 flex items-center gap-2.5 text-[11px]">
        {onSave ? (
          savedBibKey ? (
            <span
              className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400"
              title={`${t('journal.savedChip')} · ${savedBibKey}`}
            >
              ✓ {savedBibKey}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="text-blue-700 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-300"
            >
              {t('journal.save')}
            </button>
          )
        ) : null}

        {paper.doi ? (
          <a
            href={`/api/journals/pdf?doi=${encodeURIComponent(paper.doi)}&slug=${encodeURIComponent(slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:underline"
          >
            {t('journal.pdf')}
          </a>
        ) : (
          <span aria-disabled="true" className="cursor-not-allowed opacity-40">
            {t('journal.pdf')}
          </span>
        )}

        {!compact && paper.doi && (
          <button
            type="button"
            onClick={() => void toggleRelated()}
            className="inline-flex items-center gap-0.5 text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            {t('journal.related')}
            <ChevronDown size={10} className={`transition-transform ${relatedOpen ? 'rotate-0' : '-rotate-90'}`} />
          </button>
        )}
      </div>

      {saveFailed && <p className="mt-1 text-[10px] text-red-500">{t('ai.error')}</p>}

      {relatedOpen && related && related.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-l border-neutral-200 pl-2.5 dark:border-neutral-700">
          {related.map((child, index) => {
            const childLink = paperOpenUrl(child);
            return (
              <li key={`${child.id}-${index}`} className="min-w-0 text-[11px] leading-snug">
                {childLink ? (
                  <a
                    href={childLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={childLink}
                    className="text-neutral-600 hover:underline dark:text-neutral-300"
                  >
                    {child.title}
                  </a>
                ) : (
                  <span className="text-neutral-600 dark:text-neutral-300">{child.title}</span>
                )}
                <span className="text-neutral-400 dark:text-neutral-500">
                  {' · '}
                  {[child.year, child.citations].filter((part) => part !== null).join(' · ')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

/** Tab Jurnal: header pencarian + daftar hasil + aksi simpan/PDF/terelasi. */
export function JournalPanel({ slug }: { slug: string }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [results, setResults] = useState<JournalCard[] | null>(null);
  const [sourcesUsed, setSourcesUsed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** paperId → bibKey (dipakai buat chip ✓ dan biar gak dobel simpan). */
  const [savedMap, setSavedMap] = useState<Record<string, string>>({});

  const abortRef = useRef<AbortController | null>(null);

  /** Daftar paper tersimpan project — buat tandai hasil ✓ & cegah dobel. */
  const fetchSaved = useCallback(async () => {
    try {
      const res = await fetch(`/api/journals/saved?slug=${encodeURIComponent(slug)}`);
      const data: unknown = await res.json();
      if (!res.ok || !hasResults('results', data)) return;
      const next: Record<string, string> = {};
      for (const raw of data.results) {
        const entry = parseSavedEntry(raw);
        if (entry) next[entry.paperId] = entry.bibKey;
      }
      setSavedMap(next);
    } catch {
      // state lama tetap dipakai — gak fatal
    }
  }, [slug]);

  // Ganti project → reset + ambil daftar tersimpan sekali di mount.
  useEffect(() => {
    setQuery('');
    setResults(null);
    setSourcesUsed([]);
    setError(false);
    setLoading(false);
    void fetchSaved();
    return () => abortRef.current?.abort();
  }, [slug, fetchSaved]);

  const runSearch = useCallback(async (rawQuery: string, sortKey: SortKey) => {
    const q = rawQuery.trim();
    if (!q) return;
    abortRef.current?.abort(); // batalkan search lama biar gak race
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ q, sort: sortKey, limit: '12' });
      const res = await fetch(`/api/journals/search?${params}`, { signal: controller.signal });
      const data: unknown = await res.json();
      if (controller.signal.aborted) return; // sudah digantikan search baru
      if (!res.ok || !hasResults('results', data)) {
        setError(true);
        setResults([]);
        return;
      }
      const cards = data.results.map(parsePaper).filter((card): card is JournalCard => card !== null);
      const sources = (data as { sourcesUsed?: unknown }).sourcesUsed;
      setResults(cards);
      setSourcesUsed(
        Array.isArray(sources)
          ? sources.filter((name): name is string => typeof name === 'string')
          : [],
      );
    } catch {
      if (controller.signal.aborted) return;
      setError(true);
      setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  /** POST /api/journals/save → bibKey; null kalau gagal (kartu tunjukin pesan). */
  const handleSave = useCallback(
    async (paper: JournalCard): Promise<string | null> => {
      const existing = savedMap[paper.id];
      if (existing) return existing;
      try {
        const res = await fetch('/api/journals/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, paper }),
        });
        const data: unknown = await res.json();
        const bibKey = res.ok && data && typeof data === 'object' ? (data as { bibKey?: unknown }).bibKey : null;
        if (typeof bibKey === 'string') {
          setSavedMap((prev) => ({ ...prev, [paper.id]: bibKey }));
          return bibKey;
        }
        return null;
      } catch {
        return null;
      }
    },
    [slug, savedMap],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-neutral-200 p-2 dark:border-neutral-800">
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void runSearch(query, sort);
              }
            }}
            placeholder={t('journal.searchPlaceholder')}
            aria-label={t('journal.searchPlaceholder')}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-[12px] outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-200"
          />
          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value as SortKey;
              setSort(next);
              // udah pernah nge-search → urutan hasil langsung ikut
              if (query.trim() && results !== null) void runSearch(query, next);
            }}
            aria-label={t('journal.sort')}
            title={t('journal.sort')}
            className="shrink-0 cursor-pointer rounded-md border border-neutral-300 bg-transparent px-1 py-1 text-[11px] outline-none transition-colors dark:border-neutral-700"
          >
            <option value="relevance">{t('journal.sortRelevance')}</option>
            <option value="citations">{t('journal.sortCitations')}</option>
            <option value="year">{t('journal.sortYear')}</option>
          </select>
          <button
            type="button"
            onClick={() => void runSearch(query, sort)}
            disabled={loading || !query.trim()}
            title={t('journal.search')}
            aria-label={t('journal.search')}
            className="flex shrink-0 items-center justify-center rounded-md bg-neutral-900 p-1.5 text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <Search size={13} className={loading ? 'animate-pulse' : ''} />
          </button>
        </div>

        {sourcesUsed.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[9px] uppercase tracking-wide text-neutral-400">{t('journal.sources')}</span>
            {sourcesUsed.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {prettySource(name)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-1 py-6 text-center text-xs text-neutral-400">{t('journal.loading')}</p>
        ) : error ? (
          <p className="px-1 py-6 text-center text-xs text-red-500">{t('journal.error')}</p>
        ) : results === null ? (
          <p className="px-1 py-6 text-center text-xs leading-relaxed text-neutral-400">
            {t('journal.searchHint')}
          </p>
        ) : results.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-neutral-400">{t('journal.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {results.map((paper) => (
              <li key={paper.id}>
                <PaperCard
                  slug={slug}
                  paper={paper}
                  savedBibKey={savedMap[paper.id]}
                  onSave={handleSave}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
