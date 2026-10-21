'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, RefreshCw, Search } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { EmptyState } from '@/components/panels/views-left';
import {
  PaperCard,
  PdfUploadSection,
  parseSavedEntry,
  type SavedJournalEntry,
} from '@/components/panels/journal-panel';

/**
 * Tab "Perpustakaan" (fase 3): daftar jurnal tersimpan project (ikut references.bib).
 * Ini juga yang jadi daftar "Tersimpan" di tab Jurnal. Import Zotero sekarang
 * punya tab sendiri di rail kiri (zotero-panel.tsx).
 */
export function LibraryPanel({
  slug,
  onSearch,
  pdfCount = 0,
}: {
  slug: string;
  /** Kosong → tombol "Cari Jurnal" lompat ke mode Cari (state milik LeftPanel). */
  onSearch?: () => void;
  /** Jumlah PDF di referensi/ — 0 → tampil strip unggah PDF di bawah daftar. */
  pdfCount?: number;
}) {
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
      const res = await fetch(`/api/journals/save?slug=${encodeURIComponent(slug)}`);
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
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5 ">
        <span className="min-w-0 truncate text-[11px] font-medium text-card-foreground ">
          {t('library.title')}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground  ">
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
          className="ml-auto shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40  "
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
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">…</p>
        ) : entries === null ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">…</p>
        ) : error ? (
          <p className="px-1 py-6 text-center text-xs text-red-500">{t('journal.error')}</p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t('es.journalSavedTitle')}
            desc={t('es.journalSavedDesc')}
            action={
              onSearch
                ? { label: t('es.journalSavedAction'), onClick: onSearch, icon: Search }
                : undefined
            }
          />
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

        {/* Tab Tersimpan ikut dapet strip unggah PDF saat referensi/ kosong. */}
        {pdfCount === 0 && <PdfUploadSection slug={slug} hasFiles />}
      </div>
    </section>
  );
}
