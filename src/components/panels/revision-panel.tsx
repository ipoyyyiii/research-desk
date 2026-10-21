'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Circle,
  Download,
  FileText,
  Loader2,
  MessageSquareQuote,
  NotebookPen,
  Plus,
  X,
} from 'lucide-react';
import { usePreferences, useT, type Locale } from '@/lib/preferences';
import { Modal, StatusDot, TextInput } from '@/components/ui';
import { EmptyState, NoResultsNote, ViewSearchRow, type TreeEntry } from '@/components/panels/views-left';
import {
  MAX_REVISION_ITEMS,
  parseRevisionItemJson,
  parseRevisionRaw,
  type RevisionItem,
  type RevisionStatus,
} from '@/lib/revision/types';

// Tab "Loop Revisi Dosen": komentar supervisor ditempel jadi checklist,
// ditautkan ke bab, lalu ditandai selesai saat sudah diperbaiki.
// Kontrak API: /api/projects/<slug>/revisions (+ tree untuk daftar bab).

type Filter = 'all' | RevisionStatus;

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

type PatchBody = {
  status?: RevisionStatus;
  chapterPath?: string | null;
  note?: string | null;
  text?: string;
  position?: number;
};

/** Urutan siklus status: belum → sedang → selesai → belum. */
const NEXT_STATUS: Record<RevisionStatus, RevisionStatus> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo',
};

/** Error server punya `code` = key i18n → pakai terjemahan lokal; else pesan mentahnya. */
function errorText(
  t: TranslateFn,
  data: { error?: string; code?: string } | null,
  fallback: string,
): string {
  if (data?.code) return t(data.code);
  return data?.error ?? fallback;
}

function statusLabel(t: TranslateFn, status: RevisionStatus): string {
  if (status === 'doing') return t('revision.statusDoing');
  if (status === 'done') return t('revision.statusDone');
  return t('revision.statusTodo');
}

function statusTone(status: RevisionStatus): 'green' | 'amber' | 'idle' {
  if (status === 'done') return 'green';
  if (status === 'doing') return 'amber';
  return 'idle';
}

function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Komentar yang masih terbuka → Markdown per bab, buat dijawab ke dokumen dosen. */
function buildExportMarkdown(
  open: RevisionItem[],
  heading: string,
  doingLabel: string,
  noChapterLabel: string,
): string {
  const groups = new Map<string, RevisionItem[]>();
  for (const item of open) {
    const key = item.chapterPath ?? '';
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const lines: string[] = [`## ${heading}`, ''];
  for (const [chapter, list] of groups) {
    lines.push(`### ${chapter === '' ? noChapterLabel : chapter}`, '');
    for (const item of list) {
      const suffix = item.status === 'doing' ? ` (${doingLabel})` : '';
      lines.push(`- [ ] ${item.text}${suffix}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function toPatchBody(changes: Partial<RevisionItem>): PatchBody {
  const body: PatchBody = {};
  if (changes.status !== undefined) body.status = changes.status;
  if (changes.chapterPath !== undefined) body.chapterPath = changes.chapterPath;
  if (changes.note !== undefined) body.note = changes.note;
  if (changes.text !== undefined) body.text = changes.text;
  if (changes.position !== undefined) body.position = changes.position;
  return body;
}

export function RevisionPanel({ slug }: { slug: string }) {
  const t = useT();
  const { locale } = usePreferences();
  const [items, setItems] = useState<RevisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pickerItemId, setPickerItemId] = useState<number | null>(null);
  const [chapters, setChapters] = useState<string[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RevisionItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Markdown hasil export — dibuka manual kalau clipboard browser gak bisa dipakai. */
  const [exportText, setExportText] = useState<string | null>(null);
  /** Item yang editor catatannya sedang dibuka. */
  const [noteOpen, setNoteOpen] = useState<Set<number>>(() => new Set());
  const itemsRef = useRef<RevisionItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/revisions`);
      const data: unknown = await res.json();
      const raw =
        res.ok && data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
          ? ((data as { items: unknown[] }).items)
          : null;
      if (!raw) {
        setError(true);
        setItems([]);
        return;
      }
      setItems(raw.map(parseRevisionItemJson).filter((item): item is RevisionItem => item !== null));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setItems([]);
    setNote(null);
    setQuery('');
    setFilter('all');
    setNoteOpen(new Set());
    void fetchItems();
  }, [slug, fetchItems]);

  /** Ubah satu item — update optimistis dulu, lalu rekonsiliasi sama server. */
  const patchItem = useCallback(
    async (id: number, changes: Partial<RevisionItem>): Promise<boolean> => {
      const snapshot = itemsRef.current;
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/revisions`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...toPatchBody(changes) }),
        });
        if (!res.ok) {
          setItems(snapshot);
          const data = (await res.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          setNote({ text: errorText(t, data, t('revision.saveFail')), tone: 'error' });
          return false;
        }
        const data = (await res.json().catch(() => null)) as { item?: unknown } | null;
        const updated = data?.item ? parseRevisionItemJson(data.item) : null;
        if (updated) setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
        return true;
      } catch {
        setItems(snapshot);
        setNote({ text: t('revision.saveFail'), tone: 'error' });
        return false;
      }
    },
    [slug, t],
  );

  const setStatus = useCallback(
    async (item: RevisionItem, status: RevisionStatus) => {
      await patchItem(item.id, { status, resolvedAt: status === 'done' ? new Date().toISOString() : null });
    },
    [patchItem],
  );

  const toggleDone = useCallback(
    (item: RevisionItem) => {
      void setStatus(item, item.status === 'done' ? 'todo' : 'done');
    },
    [setStatus],
  );

  const cycleStatus = useCallback(
    (item: RevisionItem) => {
      void setStatus(item, NEXT_STATUS[item.status]);
    },
    [setStatus],
  );

  const saveNote = useCallback(
    async (item: RevisionItem, value: string) => {
      const ok = await patchItem(item.id, { note: value.trim() === '' ? null : value.trim() });
      return ok;
    },
    [patchItem],
  );

  const addBatch = useCallback(
    async (raw: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/revisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          setNote({ text: errorText(t, data, t('revision.saveFail')), tone: 'error' });
          return false;
        }
        const data = (await res.json().catch(() => null)) as {
          items?: unknown;
          item?: unknown;
        } | null;
        const list = Array.isArray(data?.items)
          ? data.items
          : data?.item
            ? [data.item]
            : [];
        const created = list
          .map(parseRevisionItemJson)
          .filter((item): item is RevisionItem => item !== null);
        setItems((prev) => [...prev, ...created]);
        setNote({ text: t('revision.added', { n: created.length }), tone: 'ok' });
        return true;
      } catch {
        setNote({ text: t('revision.saveFail'), tone: 'error' });
        return false;
      }
    },
    [slug, t],
  );

  const removeItem = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/revisions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== pendingDelete.id));
        setNote({ text: t('revision.removed'), tone: 'ok' });
      } else {
        setNote({ text: t('revision.saveFail'), tone: 'error' });
      }
    } catch {
      setNote({ text: t('revision.saveFail'), tone: 'error' });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, slug, t]);

  /** Daftar bab = file .md di folder dokumen/ (dari API tree yang sudah ada). */
  const openChapterPicker = useCallback(
    async (item: RevisionItem) => {
      setPickerItemId(item.id);
      setChaptersLoading(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/tree`);
        const data: unknown = await res.json();
        const tree =
          data && typeof data === 'object' && Array.isArray((data as { tree?: unknown }).tree)
            ? ((data as { tree: unknown[] }).tree)
            : [];
        const paths = tree
          .filter((entry): entry is TreeEntry => {
            if (!entry || typeof entry !== 'object') return false;
            const e = entry as Partial<TreeEntry>;
            return (
              e.type === 'file' &&
              typeof e.path === 'string' &&
              e.path.startsWith('dokumen/') &&
              e.path.endsWith('.md')
            );
          })
          .map((entry) => entry.path)
          .sort();
        setChapters(paths);
      } catch {
        setChapters([]);
      } finally {
        setChaptersLoading(false);
      }
    },
    [slug],
  );

  const pickChapter = useCallback(
    async (path: string | null) => {
      if (pickerItemId === null) return;
      const item = itemsRef.current.find((row) => row.id === pickerItemId);
      if (!item) return;
      const ok = await patchItem(item.id, { chapterPath: path });
      if (ok) setPickerItemId(null);
    },
    [patchItem, pickerItemId],
  );

  const exportMarkdown = useCallback(async () => {
    const open = itemsRef.current.filter((item) => item.status !== 'done');
    if (open.length === 0) {
      setNote({ text: t('revision.exportEmpty'), tone: 'error' });
      return;
    }
    const markdown = buildExportMarkdown(
      open,
      t('revision.exportHeading', { n: open.length }),
      t('revision.exportDoing'),
      t('revision.exportNoChapter'),
    );
    setExporting(true);
    try {
      await navigator.clipboard.writeText(markdown);
      setNote({ text: t('revision.exportCopied'), tone: 'ok' });
    } catch {
      setExportText(markdown);
    } finally {
      setExporting(false);
    }
  }, [t]);

  const toggleNoteEditor = useCallback((id: number) => {
    setNoteOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const counts = useMemo(
    () => ({
      todo: items.filter((item) => item.status === 'todo').length,
      doing: items.filter((item) => item.status === 'doing').length,
      done: items.filter((item) => item.status === 'done').length,
    }),
    [items],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (filter !== 'all' && item.status !== filter) return false;
        if (q === '') return true;
        return [item.text, item.note ?? '', item.chapterPath ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [items, filter, q],
  );

  const pickerItem = pickerItemId === null ? null : items.find((item) => item.id === pickerItemId) ?? null;

  const filters: Array<{ value: Filter; label: string; count: number }> = [
    { value: 'all', label: t('revision.filterAll'), count: items.length },
    { value: 'todo', label: t('revision.statusTodo'), count: counts.todo },
    { value: 'doing', label: t('revision.statusDoing'), count: counts.doing },
    { value: 'done', label: t('revision.statusDone'), count: counts.done },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <div className="shrink-0 px-2 py-2">
        <ViewSearchRow
          searchPh={t('revision.searchPlaceholder')}
          filter={query}
          onFilter={setQuery}
          onPlus={() => setPasteOpen(true)}
          plusTitle={t('revision.addAction')}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 pb-1.5">
        {filters.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setFilter(entry.value)}
            aria-pressed={filter === entry.value}
            className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              filter === entry.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {entry.label} {entry.count}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => void exportMarkdown()}
          disabled={exporting || items.length === 0}
          title={t('revision.exportHint')}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {t('revision.export')}
        </button>
        <span className="min-w-0 text-[11px] text-muted-foreground">
          {t('revision.counts', {
            todo: counts.todo,
            doing: counts.doing,
            done: counts.done,
          })}
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
          <p className="px-3 py-6 text-center text-xs text-destructive">{t('revision.loadFail')}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={MessageSquareQuote}
            title={t('revision.emptyTitle')}
            desc={t('revision.emptyDesc')}
            action={{ label: t('revision.emptyAction'), onClick: () => setPasteOpen(true), icon: Plus }}
          />
        ) : visible.length === 0 ? (
          <NoResultsNote />
        ) : (
          <ul className="flex flex-col gap-1 px-2 pb-2">
            {visible.map((item) => (
              <RevisionCard
                key={item.id}
                item={item}
                locale={locale}
                noteOpen={noteOpen.has(item.id)}
                onToggleDone={toggleDone}
                onCycleStatus={cycleStatus}
                onOpenChapter={(row) => void openChapterPicker(row)}
                onToggleNote={toggleNoteEditor}
                onSaveNote={saveNote}
                onDelete={(row) => setPendingDelete(row)}
              />
            ))}
          </ul>
        )}
      </div>

      <PasteModal open={pasteOpen} onClose={() => setPasteOpen(false)} onSubmit={addBatch} />

      <ChapterPickerModal
        open={pickerItem !== null}
        onClose={() => setPickerItemId(null)}
        chapters={chapters}
        loading={chaptersLoading}
        current={pickerItem?.chapterPath ?? null}
        onPick={(path) => void pickChapter(path)}
      />

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title={t('revision.deleteTitle')}>
        <p className="text-sm text-foreground">{t('revision.deleteConfirm')}</p>
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
            onClick={() => void removeItem()}
            disabled={deleting}
            className="cursor-pointer rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.delete')}
          </button>
        </div>
      </Modal>

      {/* Fallback salin manual — clipboard browser butuh permission/secure context. */}
      <Modal open={exportText !== null} onClose={() => setExportText(null)} title={t('revision.exportTitle')} wide>
        <p className="mb-2 text-xs text-muted-foreground">{t('revision.exportCopyHint')}</p>
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

/** Satu item revisi: teks komentar + status + tautan bab + catatan resolution. */
function RevisionCard({
  item,
  locale,
  noteOpen,
  onToggleDone,
  onCycleStatus,
  onOpenChapter,
  onToggleNote,
  onSaveNote,
  onDelete,
}: {
  item: RevisionItem;
  locale: Locale;
  noteOpen: boolean;
  onToggleDone: (item: RevisionItem) => void;
  onCycleStatus: (item: RevisionItem) => void;
  onOpenChapter: (item: RevisionItem) => void;
  onToggleNote: (id: number) => void;
  onSaveNote: (item: RevisionItem, value: string) => Promise<boolean>;
  onDelete: (item: RevisionItem) => void;
}) {
  const t = useT();
  const done = item.status === 'done';
  const showNote = noteOpen || done || item.note !== null;
  const chipClass =
    'inline-flex max-w-[150px] cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

  return (
    <li className="rounded-md border border-border bg-card p-2">
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => onToggleDone(item)}
          title={done ? t('revision.markUndone') : t('revision.markDone')}
          aria-label={done ? t('revision.markUndone') : t('revision.markDone')}
          className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
            done
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-border text-muted-foreground hover:border-primary hover:text-primary'
          }`}
        >
          {done ? <Check size={11} /> : <Circle size={11} />}
        </button>

        <div className="min-w-0 flex-1">
          <p
            className={`whitespace-pre-wrap text-[11px] leading-snug ${
              done ? 'text-muted-foreground line-through' : 'text-foreground'
            }`}
          >
            {item.text}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenChapter(item)}
              title={t('revision.attachChapter')}
              className={chipClass}
            >
              <FileText size={10} className="shrink-0" />
              <span className="truncate">{item.chapterPath ?? t('revision.noChapter')}</span>
            </button>
            <button
              type="button"
              onClick={() => onCycleStatus(item)}
              title={t('revision.cycleStatus')}
              className={chipClass}
            >
              <StatusDot tone={statusTone(item.status)} />
              <span className="truncate">{statusLabel(t, item.status)}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleNote(item.id)}
              title={showNote ? t('revision.noteHide') : t('revision.noteShow')}
              aria-label={showNote ? t('revision.noteHide') : t('revision.noteShow')}
              className={chipClass}
            >
              <NotebookPen size={10} className="shrink-0" />
            </button>
          </div>

          {showNote && (
            <div className="mt-1">
              <NoteField
                value={item.note ?? ''}
                placeholder={t('revision.notePlaceholder')}
                onCommit={(value) => onSaveNote(item, value)}
              />
            </div>
          )}

          {item.resolvedAt && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('revision.resolvedAt', { date: formatDate(item.resolvedAt, locale) })}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onDelete(item)}
          title={t('revision.removeItem')}
          aria-label={t('revision.removeItem')}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={12} />
        </button>
      </div>
    </li>
  );
}

/** Catatan resolution — disimpan saat blur (atau Enter). */
function NoteField({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = async () => {
    if (draft === value) return;
    const ok = await onCommit(draft);
    if (!ok) setDraft(value);
  };

  return (
    <TextInput
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      className="h-7 px-2 text-[11px]"
    />
  );
}

/** Tempel komentar dosen mentah → preview jumlah item sebelum disimpan. */
function PasteModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (raw: string) => Promise<boolean>;
}) {
  const t = useT();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseRevisionRaw(raw), [raw]);

  useEffect(() => {
    if (open) {
      setRaw('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (busy || parsed.length === 0) return;
    setBusy(true);
    try {
      const ok = await onSubmit(raw);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('revision.pasteTitle')} wide>
      <textarea
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        placeholder={t('revision.pastePlaceholder')}
        aria-label={t('revision.pastePlaceholder')}
        rows={10}
        autoFocus
        className="w-full resize-y rounded-md border border-border bg-background p-2 text-[11px] leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
      />
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {t('revision.pasteHint', { n: MAX_REVISION_ITEMS })}
      </p>
      <p className="mt-1 text-[11px] text-foreground">
        {parsed.length === 0 ? t('revision.pasteNone') : t('revision.pasteDetected', { n: parsed.length })}
      </p>
      {parsed.length >= MAX_REVISION_ITEMS && (
        <p className="mt-0.5 text-[10px] text-accent">{t('revision.capped', { n: MAX_REVISION_ITEMS })}</p>
      )}
      {parsed.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {parsed.slice(0, 8).map((text, index) => (
            <li key={`${index}:${text}`} className="truncate text-[11px] text-muted-foreground">
              • {text}
            </li>
          ))}
          {parsed.length > 8 && (
            <li className="text-[10px] text-muted-foreground">… +{parsed.length - 8}</li>
          )}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || parsed.length === 0}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {t('revision.pasteSubmit')}
        </button>
      </div>
    </Modal>
  );
}

/** Pilih file bab (dokumen/*.md) buat ditautkan ke satu item revisi. */
function ChapterPickerModal({
  open,
  onClose,
  chapters,
  loading,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  chapters: string[];
  loading: boolean;
  current: string | null;
  onPick: (path: string | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = q === '' ? chapters : chapters.filter((path) => path.toLowerCase().includes(q));

  return (
    <Modal open={open} onClose={onClose} title={t('revision.chapterTitle')}>
      <TextInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('revision.chapterSearch')}
        aria-label={t('revision.chapterSearch')}
        className="h-9 text-xs"
      />
      <div className="mt-2 max-h-[45vh] overflow-y-auto rounded-md border border-border">
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex w-full cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
        >
          <X size={12} className="shrink-0 text-muted-foreground" />
          {t('revision.chapterUnlink')}
        </button>
        {loading ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">…</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('revision.chapterEmpty')}</p>
        ) : (
          <ul>
            {visible.map((path) => (
              <li key={path} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => onPick(path)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${
                    path === current ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  <FileText size={12} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
