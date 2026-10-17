'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File as FileIcon, FolderClosed, FolderOpen } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button, Modal } from '@/components/ui';

type TreeEntry = {
  path: string; // relatif dari root project, selalu '/'
  name: string;
  type: 'dir' | 'file';
  size: number;
};

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
  const nodes = buildTree(entries);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['dokumen', 'referensi']));
  const [activeTab, setActiveTab] = useState<'file' | 'journal' | 'library'>('file');
  const [pendingDelete, setPendingDelete] = useState<TreeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      const isOpen = expanded.has(node.path);
      return (
        <li key={node.path}>
          <button
            onClick={() => toggleExpand(node.path)}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[13px] hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {isOpen ? (
              <ChevronDown size={13} className="shrink-0 text-neutral-400" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-neutral-400" />
            )}
            {isOpen ? (
              <FolderOpen size={13} className="shrink-0 text-neutral-400" />
            ) : (
              <FolderClosed size={13} className="shrink-0 text-neutral-400" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </li>
      );
    }

    const openable = isTextFile(node.name);
    const active = openFile === node.path;
    return (
      <li key={node.path}>
        <button
          onClick={() => openable && onOpenFile(node.path)}
          onDoubleClick={() => openable && setPendingDelete(node)}
          disabled={!openable}
          className={`group flex w-full items-center gap-1.5 px-2 py-1 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
            active
              ? 'bg-neutral-100 font-medium dark:bg-neutral-800'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          title={!openable ? t('tree.fase3Hint') : node.path}
        >
          <FileIcon size={13} className="shrink-0 text-neutral-400" />
          <span className="truncate">{node.name}</span>
          <span
            role="button"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete(node);
            }}
            className="ml-auto hidden text-[11px] text-neutral-400 hover:text-red-500 group-hover:inline-flex"
            title="×"
          >
            ×
          </span>
        </button>
      </li>
    );
  };

  return (
    <aside className="flex h-full flex-col border-r border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-neutral-200 px-1.5 dark:border-neutral-800">
        {(['file', 'journal', 'library'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={tab !== 'file'}
            className={`flex-1 rounded px-1.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              activeTab === tab
                ? 'bg-neutral-200 dark:bg-neutral-700'
                : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
            title={tab !== 'file' ? 'Fase 3' : t('tabs.file')}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'file' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
          {loading ? (
            <p className="px-2 py-4 text-xs text-neutral-400">…</p>
          ) : error ? (
            <p className="px-2 py-4 text-xs text-red-500">Gagal memuat — coba lagi saat window fokus</p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-4 text-xs text-neutral-400">{t('tree.empty')}</p>
          ) : (
            <ul>{nodes.map((node) => renderNode(node, 0))}</ul>
          )}
        </div>
      )}

      {activeTab === 'journal' && (
        <p className="px-3 py-4 text-xs text-neutral-400">{t('left.journalComing')}</p>
      )}
      {activeTab === 'library' && (
        <p className="px-3 py-4 text-xs text-neutral-400">{t('left.libraryComing')}</p>
      )}

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title={t('common.delete')}>
        <p className="text-sm">{t('tree.deleteConfirm', { name: pendingDelete?.name ?? '' })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" disabled={deleting} onClick={() => void performDelete()}>
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </aside>
  );
}
