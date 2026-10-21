'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, Loader2, Plus, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Modal, SegmentedGroup, StatusDot, TextInput } from '@/components/ui';
import { EmptyState, NoResultsNote, ViewSearchRow } from '@/components/panels/views-left';
import type { MatrixField, MatrixRow } from '@/lib/matrix/types';
import type { JournalCard } from '@/lib/journals/types';

// Tab "Matriks Literatur" (Bab 2): paper dari Perpustakaan ditarik ke tabel,
// kolom tema/metode/temuan/kutipan diisi manual, lalu diekspor jadi tabel
// Markdown. Kontrak API: /api/projects/<slug>/matrix (+ /matrix/export).

type PickerPaper = {
  paperId: string;
  paper: JournalCard;
};

type EditableField = Extract<MatrixField, 'tema' | 'metode' | 'temuan' | 'kutipan'>;

/** Payload respons matrix → MatrixRow; baris rusak dilewati, bukan bikin crash. */
function parseMatrixRow(value: unknown): MatrixRow | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<MatrixRow>;
  if (typeof v.id !== 'number' || typeof v.title !== 'string') return null;
  return {
    id: v.id,
    slug: typeof v.slug === 'string' ? v.slug : '',
    paperId: typeof v.paperId === 'string' ? v.paperId : null,
    title: v.title,
    authors: Array.isArray(v.authors)
      ? v.authors.filter((item): item is string => typeof item === 'string')
      : [],
    year: typeof v.year === 'number' ? v.year : null,
    tema: typeof v.tema === 'string' ? v.tema : '',
    metode: typeof v.metode === 'string' ? v.metode : '',
    temuan: typeof v.temuan === 'string' ? v.temuan : '',
    kutipan: typeof v.kutipan === 'string' ? v.kutipan : '',
    position: typeof v.position === 'number' ? v.position : 0,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };
}

/** Entri library (saved paper) → paperId + JournalCard. */
function parsePickerPaper(value: unknown): PickerPaper | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { paperId?: unknown; paper?: unknown };
  if (typeof v.paperId !== 'string' || !v.paper || typeof v.paper !== 'object') return null;
  const p = v.paper as Partial<JournalCard>;
  if (typeof p.title !== 'string') return null;
  return {
    paperId: v.paperId,
    paper: {
      id: typeof p.id === 'string' ? p.id : v.paperId,
      title: p.title,
      authors: Array.isArray(p.authors)
        ? p.authors.filter((item): item is string => typeof item === 'string')
        : [],
      year: typeof p.year === 'number' ? p.year : null,
      venue: typeof p.venue === 'string' ? p.venue : null,
      doi: typeof p.doi === 'string' ? p.doi : null,
      citations: typeof p.citations === 'number' ? p.citations : 0,
      abstract: typeof p.abstract === 'string' ? p.abstract : null,
      openAccessUrl: typeof p.openAccessUrl === 'string' ? p.openAccessUrl : null,
      landingUrl: typeof p.landingUrl === 'string' ? p.landingUrl : null,
      source:
        p.source === 'crossref' || p.source === 'semantic-scholar' ? p.source : 'openalex',
    },
  };
}

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** Error server punya `code` = key i18n → pakai terjemahan lokal; else pesan mentahnya. */
function errorText(
  t: TranslateFn,
  data: { error?: string; code?: string } | null,
  fallback: string,
): string {
  if (data?.code) return t(data.code);
  return data?.error ?? fallback;
}

export function MatrixPanel({ slug }: { slug: string }) {
  const t = useT();
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MatrixRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Markdown hasil export — dibuka manual kalau clipboard browser gak bisa dipakai. */
  const [exportText, setExportText] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/matrix`);
      const data: unknown = await res.json();
      const raw =
        res.ok && data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)
          ? ((data as { rows: unknown[] }).rows)
          : null;
      if (!raw) {
        setError(true);
        setRows([]);
        return;
      }
      setRows(raw.map(parseMatrixRow).filter((row): row is MatrixRow => row !== null));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setRows([]);
    setNote(null);
    void fetchRows();
  }, [slug, fetchRows]);

  const saveCell = useCallback(
    async (id: number, field: EditableField, value: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/matrix`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, [field]: value }),
        });
        if (!res.ok) return false;
        const data = (await res.json().catch(() => null)) as { row?: unknown } | null;
        const updated = data?.row ? parseMatrixRow(data.row) : null;
        if (updated) setRows((prev) => prev.map((row) => (row.id === id ? updated : row)));
        return true;
      } catch {
        return false;
      }
    },
    [slug],
  );

  const addRow = useCallback(
    async (payload: { paperId?: string; title?: string; authors?: string[]; year?: number | null }) => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/matrix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          setNote({ text: errorText(t, data, t('matrix.saveFail')), tone: 'error' });
          return false;
        }
        const data = (await res.json().catch(() => null)) as { row?: unknown } | null;
        const row = data?.row ? parseMatrixRow(data.row) : null;
        if (row) setRows((prev) => [...prev, row]);
        setNote({ text: t('matrix.added'), tone: 'ok' });
        return true;
      } catch {
        setNote({ text: t('matrix.saveFail'), tone: 'error' });
        return false;
      }
    },
    [slug, t],
  );

  const removeRow = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/matrix`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((row) => row.id !== pendingDelete.id));
        setNote({ text: t('matrix.removed'), tone: 'ok' });
      } else {
        setNote({ text: t('matrix.saveFail'), tone: 'error' });
      }
    } catch {
      setNote({ text: t('matrix.saveFail'), tone: 'error' });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, slug, t]);

  const exportMarkdown = useCallback(async () => {
    if (rows.length === 0) {
      setNote({ text: t('matrix.exportEmpty'), tone: 'error' });
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/matrix/export`, {
        method: 'POST',
      });
      if (!res.ok) {
        setNote({ text: t('matrix.exportFail'), tone: 'error' });
        return;
      }
      const data = (await res.json().catch(() => null)) as { markdown?: string } | null;
      const markdown = typeof data?.markdown === 'string' ? data.markdown : '';
      if (markdown === '') {
        setNote({ text: t('matrix.exportEmpty'), tone: 'error' });
        return;
      }
      try {
        await navigator.clipboard.writeText(markdown);
        setNote({ text: t('matrix.exportCopied'), tone: 'ok' });
      } catch {
        setExportText(markdown);
      }
    } catch {
      setNote({ text: t('matrix.exportFail'), tone: 'error' });
    } finally {
      setExporting(false);
    }
  }, [rows.length, slug, t]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q === ''
        ? rows
        : rows.filter((row) =>
            [row.title, row.authors.join(' '), row.tema, row.metode, row.temuan, row.kutipan]
              .join(' ')
              .toLowerCase()
              .includes(q),
          ),
    [rows, q],
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="shrink-0 px-2 py-2">
        <ViewSearchRow
          searchPh={t('matrix.searchPlaceholder')}
          filter={query}
          onFilter={setQuery}
          onPlus={() => setPickerOpen(true)}
          plusTitle={t('matrix.addAction')}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => void exportMarkdown()}
          disabled={exporting || rows.length === 0}
          title={t('matrix.exportHint')}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {t('matrix.export')}
        </button>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('matrix.rows', { n: rows.length })}
        </span>
      </div>

      {note && (
        <p
          className={`shrink-0 px-3 pb-1.5 text-[11px] ${
            note.tone === 'error' ? 'text-destructive' : 'text-accent'
          }`}
          role="status"
        >
          {note.text}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">…</p>
        ) : error ? (
          <p className="px-3 py-6 text-center text-xs text-destructive">{t('matrix.loadFail')}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t('matrix.emptyTitle')}
            desc={t('matrix.emptyDesc')}
            action={{ label: t('matrix.emptyAction'), onClick: () => setPickerOpen(true), icon: Plus }}
          />
        ) : visible.length === 0 ? (
          <NoResultsNote />
        ) : (
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="w-[30%] px-2 py-1.5 font-medium">{t('matrix.paper')}</th>
                <th className="px-2 py-1.5 font-medium">{t('matrix.tema')}</th>
                <th className="px-2 py-1.5 font-medium">{t('matrix.metode')}</th>
                <th className="px-2 py-1.5 font-medium">{t('matrix.temuan')}</th>
                <th className="px-2 py-1.5 font-medium">{t('matrix.kutipan')}</th>
                <th className="w-8 px-1 py-1.5">
                  <span className="sr-only">{t('matrix.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-border align-top">
                  <td className="px-2 py-1.5">
                    <p className="text-[11px] font-medium leading-snug text-foreground">
                      {row.title}
                    </p>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      {[row.authors.join(', '), row.year !== null ? String(row.year) : '']
                        .filter((part) => part !== '')
                        .join(' — ')}
                    </p>
                  </td>
                  <EditableCell
                    value={row.tema}
                    label={t('matrix.tema')}
                    placeholder={t('matrix.temaPh')}
                    onCommit={(value) => saveCell(row.id, 'tema', value)}
                  />
                  <EditableCell
                    value={row.metode}
                    label={t('matrix.metode')}
                    placeholder={t('matrix.metodePh')}
                    onCommit={(value) => saveCell(row.id, 'metode', value)}
                  />
                  <EditableCell
                    value={row.temuan}
                    label={t('matrix.temuan')}
                    placeholder={t('matrix.temuanPh')}
                    onCommit={(value) => saveCell(row.id, 'temuan', value)}
                  />
                  <EditableCell
                    value={row.kutipan}
                    label={t('matrix.kutipan')}
                    placeholder={t('matrix.kutipanPh')}
                    onCommit={(value) => saveCell(row.id, 'kutipan', value)}
                  />
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => setPendingDelete(row)}
                      title={t('matrix.removeRow')}
                      aria-label={t('matrix.removeRow')}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MatrixAddModal
        slug={slug}
        open={pickerOpen}
        existingPaperIds={rows.map((row) => row.paperId).filter((id): id is string => id !== null)}
        onClose={() => setPickerOpen(false)}
        onAddLibrary={(paperId) => addRow({ paperId })}
        onAddManual={(title, authors, year) => addRow({ title, authors, year })}
      />

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={t('matrix.deleteTitle')}
      >
        <p className="text-sm text-foreground">
          {t('matrix.deleteConfirm', { title: pendingDelete?.title ?? '' })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void removeRow()}
            disabled={deleting}
            className="cursor-pointer rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.delete')}
          </button>
        </div>
      </Modal>

      {/* Fallback salin manual — clipboard browser butuh permission/secure context. */}
      <Modal open={exportText !== null} onClose={() => setExportText(null)} title={t('matrix.exportTitle')} wide>
        <p className="mb-2 text-xs text-muted-foreground">{t('matrix.exportCopyHint')}</p>
        <textarea
          readOnly
          value={exportText ?? ''}
          rows={12}
          className="w-full rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-snug text-foreground outline-none"
        />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setExportText(null)}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('common.close')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Sel tabel yang bisa diedit — simpan saat blur (atau Ctrl/Cmd+Enter). */
function EditableCell({
  value,
  label,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder: string;
  onCommit: (value: string) => Promise<boolean>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = async () => {
    if (draft === value) {
      setStatus('idle');
      return;
    }
    setStatus('saving');
    const ok = await onCommit(draft);
    if (ok) {
      setStatus('saved');
    } else {
      setDraft(value);
      setStatus('error');
    }
  };

  const tone = status === 'saving' ? 'amber' : status === 'saved' ? 'green' : 'red';
  const title =
    status === 'saving'
      ? t('matrix.saving')
      : status === 'saved'
        ? t('matrix.saved')
        : status === 'error'
          ? t('matrix.saveFail')
          : '';

  return (
    <td className="px-1 py-1.5">
      <div className="relative">
        <textarea
          value={draft}
          aria-label={label}
          placeholder={placeholder}
          rows={2}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus('idle');
          }}
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
              event.currentTarget.blur();
            }
          }}
          className="w-full resize-y rounded border border-border bg-background px-1.5 py-1 text-[11px] leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
        />
        {status !== 'idle' && (
          <span className="absolute bottom-1 right-1">
            <StatusDot tone={tone} title={title} />
          </span>
        )}
      </div>
    </td>
  );
}

/**
 * Modal tambah baris: pilih paper tersimpan di Perpustakaan atau bikin baris
 * manual (judul doang). Judul/penulis/tahun paper library otomatis terisi
 * dari saved_papers.
 */
function MatrixAddModal({
  slug,
  open,
  existingPaperIds,
  onClose,
  onAddLibrary,
  onAddManual,
}: {
  slug: string;
  open: boolean;
  existingPaperIds: string[];
  onClose: () => void;
  onAddLibrary: (paperId: string) => Promise<boolean>;
  onAddManual: (
    title: string,
    authors: string[],
    year: number | null,
  ) => Promise<boolean>;
}) {
  const t = useT();
  const [mode, setMode] = useState<'library' | 'manual'>('library');
  const [papers, setPapers] = useState<PickerPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [busyPaperId, setBusyPaperId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/journals/save?slug=${encodeURIComponent(slug)}`);
      const data: unknown = await res.json();
      const raw =
        res.ok &&
        data &&
        typeof data === 'object' &&
        Array.isArray((data as { results?: unknown }).results)
          ? ((data as { results: unknown[] }).results)
          : null;
      if (!raw) {
        setLoadError(true);
        setPapers([]);
        return;
      }
      setPapers(raw.map(parsePickerPaper).filter((item): item is PickerPaper => item !== null));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setAuthors('');
    setYear('');
    void fetchPapers();
  }, [open, fetchPapers]);

  const taken = useMemo(() => new Set(existingPaperIds), [existingPaperIds]);
  const lq = libraryQuery.trim().toLowerCase();
  const visiblePapers = useMemo(
    () =>
      lq === ''
        ? papers
        : papers.filter((item) =>
            [item.paper.title, item.paper.authors.join(' ')]
              .join(' ')
              .toLowerCase()
              .includes(lq),
          ),
    [papers, lq],
  );

  const pickLibrary = async (paperId: string) => {
    setBusyPaperId(paperId);
    try {
      const ok = await onAddLibrary(paperId);
      if (ok) onClose();
    } finally {
      setBusyPaperId(null);
    }
  };

  const submitManual = async () => {
    const cleanTitle = title.trim();
    if (cleanTitle === '' || manualBusy) return;
    setManualBusy(true);
    try {
      const parsedYear = year.trim() === '' ? null : Number.parseInt(year.trim(), 10);
      const ok = await onAddManual(
        cleanTitle,
        authors
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== ''),
        parsedYear !== null && Number.isFinite(parsedYear) ? parsedYear : null,
      );
      if (ok) onClose();
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('matrix.addTitle')} wide>
      <div className="space-y-3">
        <SegmentedGroup
          options={[
            { value: 'library', label: t('matrix.fromLibrary') },
            { value: 'manual', label: t('matrix.manual') },
          ]}
          active={mode}
          onSelect={(value) => setMode(value === 'manual' ? 'manual' : 'library')}
        />

        {mode === 'library' ? (
          <>
            <TextInput
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder={t('matrix.pickerSearch')}
              aria-label={t('matrix.pickerSearch')}
              className="h-9 text-xs"
            />
            <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border">
              {loading ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">…</p>
              ) : loadError ? (
                <p className="px-3 py-6 text-center text-xs text-destructive">
                  {t('matrix.loadFail')}
                </p>
              ) : visiblePapers.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t('matrix.libraryEmpty')}
                </p>
              ) : (
                <ul>
                  {visiblePapers.map((item) => {
                    const already = taken.has(item.paperId);
                    return (
                      <li key={item.paperId} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          disabled={already || busyPaperId !== null}
                          onClick={() => void pickLibrary(item.paperId)}
                          className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-foreground">
                              {item.paper.title}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {[
                                item.paper.authors.join(', '),
                                item.paper.year !== null ? String(item.paper.year) : '',
                              ]
                                .filter((part) => part !== '')
                                .join(' — ')}
                            </span>
                          </span>
                          {already && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {t('matrix.alreadyAdded')}
                            </span>
                          )}
                          {busyPaperId === item.paperId && (
                            <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="matrix-title" className="mb-1 block text-xs font-medium">
                {t('matrix.manualTitle')}
              </label>
              <TextInput
                id="matrix-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('matrix.manualTitlePh')}
                className="h-9 text-xs"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="matrix-authors" className="mb-1 block text-xs font-medium">
                {t('matrix.manualAuthors')}
              </label>
              <TextInput
                id="matrix-authors"
                value={authors}
                onChange={(event) => setAuthors(event.target.value)}
                placeholder={t('matrix.manualAuthorsPh')}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label htmlFor="matrix-year" className="mb-1 block text-xs font-medium">
                {t('matrix.manualYear')}
              </label>
              <TextInput
                id="matrix-year"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                placeholder={t('matrix.manualYearPh')}
                inputMode="numeric"
                className="h-9 text-xs"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitManual();
                }}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void submitManual()}
                disabled={manualBusy || title.trim() === ''}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {manualBusy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {t('matrix.addManualAction')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
