'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '@/lib/preferences';
import {
  PaperCard,
  parseSavedEntry,
  type SavedJournalEntry,
} from '@/components/panels/journal-panel';

// Tab "Perpustakaan" (fase 3): daftar jurnal tersimpan project (ikut references.bib).
// Buang entri → dibersih langsung, backend ikut hapus entri BibTeX-nya.

export function LibraryPanel({ slug }: { slug: string }) {
  const t = useT();
  const [entries, setEntries] = useState<SavedJournalEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** paperId yang lagi dihapus (✕ mati sementara). */
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  /** Catatan kecil habis buang — entri BibTeX ikut kebersih. */
  const [deletedNote, setDeletedNote] = useState(false);

  const fetchSaved = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/journals/saved?slug=${encodeURIComponent(slug)}`);
      const data: unknown = await res.json();
      const raw = res.ok && data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results)
        ? ((data as { results: unknown[] }).results)
        : null;
      if (!raw) {
        setError(true);
        setEntries([]);
        return;
      }
      const parsed = raw
        .map(parseSavedEntry)
        .filter((entry): entry is SavedJournalEntry => entry !== null);
      setEntries(parsed);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Ganti project → kosongin dulu, terus ambil ulang sekali di mount.
  useEffect(() => {
    setEntries(null);
    setDeletedNote(false);
    void fetchSaved();
  }, [slug, fetchSaved]);

  const removeEntry = async (entry: SavedJournalEntry) => {
    if (removing.has(entry.paperId)) return;
    setRemoving((prev) => new Set(prev).add(entry.paperId));
    try {
      const res = await fetch('/api/journals/save', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, paperId: entry.paperId }),
      });
      if (res.ok) {
        setEntries((prev) => prev?.filter((item) => item.paperId !== entry.paperId) ?? []);
        setDeletedNote(true);
      }
    } catch {
      // gagal diam — entri tetap daftar, user bisa refresh
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(entry.paperId);
        return next;
      });
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        <span className="min-w-0 truncate text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
          {t('library.title')}
        </span>
        <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {entries ? `${entries.length} ${t('library.count')}` : '…'}
        </span>
        <button
          type="button"
          onClick={() => {
            setDeletedNote(false);
            void fetchSaved();
          }}
          disabled={loading}
          title={t('library.refresh')}
          aria-label={t('library.refresh')}
          className="ml-auto shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {deletedNote && (
          <p className="mb-1.5 rounded bg-blue-50 px-2 py-1 text-[10px] leading-snug text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            {t('library.deleted')}
          </p>
        )}
        {loading ? (
          <p className="px-1 py-6 text-center text-xs text-neutral-400">…</p>
        ) : entries === null ? (
          <p className="px-1 py-6 text-center text-xs text-neutral-400">…</p>
        ) : error ? (
          <p className="px-1 py-6 text-center text-xs text-red-500">{t('journal.error')}</p>
        ) : entries.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs leading-relaxed text-neutral-400">
            {t('library.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <PaperCard
                  slug={slug}
                  paper={entry.paper}
                  savedBibKey={entry.bibKey}
                  compact
                  onRemove={() => void removeEntry(entry)}
                  removing={removing.has(entry.paperId)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
