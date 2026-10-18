'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Target } from 'lucide-react';
import { ListTree } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { countMarkdownWords, firstHeading } from '@/lib/outline';
import type { TreeEntry } from '@/components/panels/views-left';

type ChapterRow = {
  path: string;
  name: string;
  title: string | null;
  words: number | null; // null = masih menghitung
};

const MAX_DOCS = 12;

function targetKey(slug: string, path: string): string {
  return `outline:target:${slug}:${path}`;
}

function readTarget(slug: string, path: string): number {
  const raw = localStorage.getItem(targetKey(slug, path));
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Tab purpose view "Outline": daftar bab (dokumen/*.md) + hitungan kata
 * + target per bab (kesimpen localStorage, per browser). Baris progress selalu
 * berangka — gak cuma andalan warna (a11y).
 */
export function OutlineView({
  slug,
  entries,
  onOpenFile,
}: {
  slug: string;
  entries: TreeEntry[];
  onOpenFile: (path: string) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<ChapterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const cancelledRef = useRef(false);

  // Daftar bab dari tree — filter dokumen/*.md (abaikan _* cache/test file).
  const docPaths = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            entry.type === 'file' &&
            entry.path.startsWith('dokumen/') &&
            entry.path.endsWith('.md') &&
            !/\/_/.test(entry.path),
        )
        .slice(0, MAX_DOCS),
    [entries],
  );

  // Target: persona load pas slug berubah.
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const entry of docPaths) {
      next[entry.path] = readTarget(slug, entry.path);
    }
    setTargets(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, docPaths.map((doc) => doc.path).join('|')]);

  // Hitung kata tiap bab: fetch file text (udah ada API). Ulang pas tree berubah pas entries.
  useEffect(() => {
    cancelledRef.current = false;
    if (docPaths.length === 0) {
      setRows([]);
      return undefined;
    }
    setLoading(true);
    setRows(docPaths.map((doc) => ({ path: doc.path, name: doc.name, title: null, words: null })));

    const load = async () => {
      const fetched = await Promise.allSettled(
        docPaths.map(async (doc) => {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(doc.path)}`,
          );
          if (!res.ok) throw new Error('fetch gagal');
          const data = (await res.json()) as { content?: string };
          const md = data.content ?? '';
          return { path: doc.path, words: countMarkdownWords(md), title: firstHeading(md) };
        }),
      );

      if (cancelledRef.current) return;
      setRows((prev) =>
        prev.map((row) => {
          const hit = fetched.find(
            (item) => item.status === 'fulfilled' && item.value.path === row.path,
          );
          if (hit && hit.status === 'fulfilled') {
            return { ...row, words: hit.value.words, title: hit.value.title };
          }
          return { ...row, words: 0, title: null };
        }),
      );
      setLoading(false);
    };

    void load();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, docPaths.map((doc) => doc.path).join('|')]);

  const saveTarget = useCallback(
    (path: string, value: number) => {
      const clean = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      try {
        if (clean > 0) localStorage.setItem(targetKey(slug, path), String(clean));
        else localStorage.removeItem(targetKey(slug, path));
      } catch {
        // localStorage penuh/privat mode — biarkan state aja.
      }
      setTargets((prev) => ({ ...prev, [path]: clean }));
    },
    [slug],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <p className="flex items-center gap-1.5 font-serif text-sm font-semibold tracking-tight">
          <ListTree size={13} className="text-primary" />
          {t('outline.title')}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{t('outline.targetHint')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 && !loading ? (
          <p className="px-3 py-6 text-xs leading-relaxed text-muted-foreground">{t('outline.noDocs')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => {
              const target = targets[row.path] ?? 0;
              const pct = target > 0 && (row.words ?? 0) > 0 ? Math.min(100, Math.round(((row.words ?? 0) / target) * 100)) : 0;
              const done = target > 0 && (row.words ?? 0) >= target;
              return (
                <li
                  key={row.path}
                  className="group rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-card"
                >
                  <button
                    type="button"
                    title={t('outline.openHint')}
                    onClick={() => onOpenFile(row.path)}
                    className="flex min-h-[24px] w-full cursor-pointer items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-foreground">
                      {row.title ?? row.name.replace(/\.md$/i, '')}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {row.words === null ? <Loader2 size={10} className="inline animate-spin" /> : `${row.words.toLocaleString('id-ID')}`}
                    </span>
                  </button>

                  {target > 0 && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-green-600' : 'bg-amber-600'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`shrink-0 font-mono text-[10px] ${done ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}>
                        {pct}%
                      </span>
                    </div>
                  )}

                  {editingPath === row.path ? (
                    <form
                      className="mt-1 flex items-center gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setEditingPath(null);
                      }}
                    >
                      <Target size={11} className="shrink-0 text-muted-foreground" />
                      <input
                        autoFocus
                        type="number"
                        min={0}
                        step={100}
                        defaultValue={target}
                        onBlur={(event) => {
                          saveTarget(row.path, Number(event.target.value));
                          setEditingPath(null);
                        }}
                        aria-label={t('outline.target')}
                        className="h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingPath(row.path)}
                      className="mt-0.5 flex h-5 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Target size={10} />
                      {target > 0 ? (row.words ?? 0).toLocaleString('id-ID') + ' / ' + target.toLocaleString('id-ID') : ''}
                      {target > 0 ? ` · ${t('outline.target')}` : t('outline.target')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
