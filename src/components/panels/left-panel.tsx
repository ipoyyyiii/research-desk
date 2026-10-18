'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Search } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Modal } from '@/components/ui';
import { JournalPanel } from '@/components/panels/journal-panel';
import { LibraryPanel } from '@/components/panels/library-panel';
import { IconRail, type LeftTab } from '@/components/workspace/icon-rail';
import {
  DataView,
  DraftsView,
  FiguresView,
  dataFiles,
  draftFiles,
  figureFiles,
  referencePdfFiles,
  type TreeEntry,
} from '@/components/panels/views-left';

type TreeNode = TreeEntry & { children: TreeNode[] };

function buildTree(entries: TreeEntry[]): TreeNode[] {
  const root: TreeNode = { path: '', name: '', type: 'dir', size: 0, children: [] };
  const dirNodes = new Map<string, TreeNode>();
  dirNodes.set('', root);

  for (const entry of entries) {
    const parent = dirNodes.get(parentPathOf(entry.path));
    if (!parent) continue;
    const node: TreeNode = { ...entry, children: [] };
    parent.children.push(node);
    if (entry.type === 'dir') dirNodes.set(entry.path, node);
  }
  return root.children;
}

function parentPathOf(p: string): string {
  const index = p.lastIndexOf('/');
  return index === -1 ? '' : p.slice(0, index);
}

const TEXT_EXTS = ['.md', '.txt', '.json', '.jsonc', '.csv', '.ris', '.bib', '.tex'];
const isTextFile = (name: string) => TEXT_EXTS.some((ext) => name.toLowerCase().endsWith(ext));

/** Ekstensi yang dapet badge di tree — sisanya (mis. .json) tampil polos. */
const BADGE_EXTS = new Set(['md', 'pdf', 'bib', 'docx', 'txt', 'png', 'jpg']);

function extBadge(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return BADGE_EXTS.has(ext) ? ext.toUpperCase() : null;
}

/** Fetch pohon berkas; refetch on window-focus (file hasil copy manual langsung	muncul). */
function useFileTree(slug: string, version: number) {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/tree`);
      const data = await res.json();
      if (res.ok) {
        setEntries(data.tree ?? []);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree, version]);

  // Refetch saat window fokus KEMBALI (bukan tiap fokus-event) + throttle 3 detik,
  // biar gak numpuk request saat tab fwd VS Code flicker.
  const lastFetchRef = useRef(Date.now());
  useEffect(() => {
    let visible = true;
    const maybeFetch = () => {
      if (!visible || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFetchRef.current < 3000) return;
      lastFetchRef.current = now;
      void fetchTree();
    };
    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      maybeFetch();
    };
    window.addEventListener('focus', maybeFetch);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', maybeFetch);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchTree]);

  return { entries, loading, error };
}

export function LeftPanel({
  slug,
  treeVersion,
  openFile,
  onOpenFile,
  onFileDeleted,
}: {
  slug: string;
  treeVersion: number;
  openFile: string | null;
  onOpenFile: (path: string) => void;
  onFileDeleted: (wasOpen: boolean) => void;
}) {
  const t = useT();
  const { entries, loading, error } = useFileTree(slug, treeVersion);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['dokumen', 'referensi']));
  const [activeTab, setActiveTab] = useState<LeftTab>('drafts');
  const [journalMode, setJournalMode] = useState<'search' | 'saved'>('search');
  const [pendingDelete, setPendingDelete] = useState<TreeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState('');

  // Filter client-side by path (case-insensitive). Folder induk ikut disertakan
  // biar hasil tetap muncul di dalam pohonnya — buildTree butuh parent dir-nya ada.
  const normalizedFilter = filter.trim().toLowerCase();
  const filterActive = normalizedFilter.length > 0;
  const filteredEntries = filterActive
    ? (() => {
        const matched = entries.filter((entry) => entry.path.toLowerCase().includes(normalizedFilter));
        const keep = new Set<string>(matched.map((entry) => entry.path));
        for (const entry of matched) {
          let parent = parentPathOf(entry.path);
          while (parent && !keep.has(parent)) {
            keep.add(parent);
            parent = parentPathOf(parent);
          }
        }
        return entries.filter((entry) => keep.has(entry.path));
      })()
    : entries;
  const nodes = buildTree(filteredEntries);

  const chipCount = (count: number) => t('lib.fileCount', { n: count });

  /** PDF unduhan jurnal di referensi/ — tampil juga sebagai section di tab Jurnal. */
  const pdfFiles = useMemo(() => referencePdfFiles(entries), [entries]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(pendingDelete.path)}`,
        { method: 'DELETE' },
      );
      if (res.ok) onFileDeleted(openFile === pendingDelete.path);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.type === 'dir') {
      // Saat filter aktif semua folder yang relevan dibuka otomatis — hasil search langsung kelihatan.
      const isOpen = filterActive || expanded.has(node.path);
      return (
        <li key={node.path}>
          <button
            onClick={() => toggleExpand(node.path)}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {isOpen ? (
              <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
            )}
            {isOpen ? (
              <FolderOpen size={13} className="shrink-0 text-muted-foreground" />
            ) : (
              <Folder size={13} className="shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </li>
      );
    }

    const openable = isTextFile(node.name);
    const active = openFile === node.path;
    const badge = extBadge(node.name);
    return (
      <li key={node.path}>
        <button
          onClick={() => openable && onOpenFile(node.path)}
          onDoubleClick={() => openable && setPendingDelete(node)}
          disabled={!openable}
          className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
            active
              ? 'bg-primary/10 font-medium text-primary'
              : 'cursor-pointer text-foreground hover:bg-muted'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          title={!openable ? t('tree.fase3Hint') : node.path}
        >
          <FileText
            size={13}
            className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {badge && (
              <span className="rounded bg-muted px-1 text-[9px] font-mono uppercase text-muted-foreground">
                {badge}
              </span>
            )}
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                setPendingDelete(node);
              }}
              className="hidden text-[11px] text-muted-foreground transition-colors hover:text-destructive group-hover:inline-flex"
              title="×"
            >
              ×
            </span>
          </span>
        </button>
      </li>
    );
  };

  const tabHeader = (title: string, chip?: string) => (
    <header className="shrink-0 border-b border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-sm font-semibold tracking-tight text-card-foreground">{title}</h2>
        {chip && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            {chip}
          </span>
        )}
      </div>
    </header>
  );

  /** Kerangka tab view tujuan: header + area scroll, plus status load/error tree yang sama. */
  const viewPane = (title: string, chip: string, view: React.ReactNode) => (
    <div className="flex min-w-0 flex-1 flex-col bg-background text-foreground">
      {tabHeader(title, chip)}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">…</p>
        ) : error ? (
          <p className="px-2 py-4 text-xs text-destructive">{t('err.loadFocus')}</p>
        ) : (
          view
        )}
      </div>
    </div>
  );

  return (
    <aside className="flex h-full">
      <IconRail active={activeTab} onChange={setActiveTab} />

      {activeTab === 'drafts' &&
        viewPane(
          t('views.drafts'),
          chipCount(draftFiles(entries).length),
          <DraftsView slug={slug} entries={entries} onOpenFile={onOpenFile} />,
        )}

      {activeTab === 'figures' &&
        viewPane(
          t('views.figures'),
          chipCount(figureFiles(entries).length),
          <FiguresView slug={slug} entries={entries} />,
        )}

      {activeTab === 'data' &&
        viewPane(t('views.data'), chipCount(dataFiles(entries).length), <DataView slug={slug} entries={entries} />)}

      {activeTab === 'journals' && (
        <div className="flex min-w-0 flex-1 flex-col bg-background text-foreground">
          {tabHeader(t('journal.header'), `${pdfFiles.length} PDF`)}
          <div className="flex shrink-0 gap-1 border-b border-border bg-card px-2 pb-1.5">
            <button
              type="button"
              onClick={() => setJournalMode('search')}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                journalMode === 'search'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('journal.search')}
            </button>
            <button
              type="button"
              onClick={() => setJournalMode('saved')}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                journalMode === 'saved'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('library.tabSaved')}
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {journalMode === 'search' ? (
              <JournalPanel slug={slug} pdfFiles={pdfFiles} />
            ) : (
              <LibraryPanel slug={slug} />
            )}
          </div>
        </div>
      )}

      {activeTab === 'files' && (
        <div className="flex min-w-0 flex-1 flex-col bg-background text-foreground">
          {tabHeader(t('tabs.file'), t('lib.fileCount', { n: entries.length }))}
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('lib.searchPlaceholder')}
                aria-label={t('lib.searchPlaceholder')}
                className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground transition-colors placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
            {loading ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">…</p>
            ) : error ? (
              <p className="px-2 py-4 text-xs text-destructive">{t('err.loadFocus')}</p>
            ) : entries.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">{t('tree.empty')}</p>
            ) : (
              <ul>{nodes.map((node) => renderNode(node, 0))}</ul>
            )}
          </div>
        </div>
      )}

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title={t('common.delete')}>
        <p className="text-sm text-foreground">{t('tree.deleteConfirm', { name: pendingDelete?.name ?? '' })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void performDelete()}
            className="cursor-pointer rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.delete')}
          </button>
        </div>
      </Modal>
    </aside>
  );
}
