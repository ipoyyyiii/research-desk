'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Image as ImageIcon, Loader2, Table2 } from 'lucide-react';
import { Button, Modal, SegmentedGroup } from '@/components/ui';
import { useT } from '@/lib/preferences';

type Table = {
  index: number;
  caption: string;
  header: string[];
  rows: string[][];
  markdown: string;
};

type Figure = {
  index: number;
  alt: string;
  path: string;
  caption: string;
  markdown: string;
};

type Chapter = { path: string; name: string };

/**
 * Sisip tabel dari laporan hasil analisis (folder hasil/) ke sebuah bab.
 *
 * Laporan analisis dari scripts/uji-statistik.py isinya banyak tabel; user
 * biasanya cuma mau satu yang masuk draft. Penomoran "Tabel 3.1" ikut bab
 * tujuan, sesuai gaya penulisan skripsi.
 */
export function InsertResultModal({
  slug,
  sourcePath,
  onClose,
  onDone,
}: {
  slug: string;
  sourcePath: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [tables, setTables] = useState<Table[] | null>(null);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [kind, setKind] = useState<'table' | 'figure'>('table');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [tableIndex, setTableIndex] = useState(0);
  const [figureIndex, setFigureIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const [chapterPath, setChapterPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/insert-result?sourcePath=${encodeURIComponent(sourcePath)}`,
        );
        const data = (await res.json().catch(() => null)) as
          | { tables?: Table[]; figures?: Figure[] }
          | null;
        if (!alive) return;
        setTables(data?.tables ?? []);
        setFigures(data?.figures ?? []);
        if ((data?.tables ?? []).length === 0 && (data?.figures ?? []).length > 0) {
          setKind('figure');
        }
      } catch {
        if (alive) setTables([]);
      }
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/tree`);
        const data = (await res.json().catch(() => null)) as
          | { entries?: Array<{ path: string; name: string; type: string }> }
          | null;
        if (!alive) return;
        const list = (data?.entries ?? [])
          .filter((entry) => entry.type === 'file' && /^dokumen\/.*\.md$/i.test(entry.path))
          .map((entry) => ({ path: entry.path, name: entry.name }));
        setChapters(list);
        setChapterPath((current) => current || (list[0]?.path ?? ''));
      } catch {
        if (alive) setChapters([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, sourcePath]);

  const submit = async () => {
    if (!chapterPath) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/insert-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePath,
          chapterPath,
          kind,
          index: kind === 'figure' ? figureIndex : tableIndex,
          caption,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; number?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? t('insertResult.fail'));
        return;
      }
      onDone(t('insertResult.done', { number: data.number ?? '' }));
      onClose();
    } catch {
      setError(t('insertResult.fail'));
    } finally {
      setBusy(false);
    }
  };

  const table = tables?.[tableIndex];

  return (
    <Modal open onClose={onClose} title={t('insertResult.title')}>
      <div className="space-y-3 text-xs">
        <p className="text-muted-foreground">
          {t('insertResult.source', { name: sourcePath.split('/').pop() ?? sourcePath })}
        </p>

        <SegmentedGroup
          options={[
            { value: 'table', label: t('insertResult.tabTables'), disabled: (tables ?? []).length === 0 },
            { value: 'figure', label: t('insertResult.tabFigures'), disabled: figures.length === 0 },
          ]}
          active={kind}
          onSelect={(value) => setKind(value === 'figure' ? 'figure' : 'table')}
        />

        {tables === null && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />
            {t('insertResult.loading')}
          </p>
        )}

        {tables !== null && kind === 'table' && tables.length === 0 && (
          <p className="text-muted-foreground">{t('insertResult.noTables')}</p>
        )}

        {kind === 'figure' && figures.length === 0 && (
          <p className="text-muted-foreground">{t('insertResult.noFigures')}</p>
        )}

        {kind === 'figure' && figures.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">{t('insertResult.pickFigure')}</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {figures.map((item) => (
                <button
                  key={item.index}
                  type="button"
                  onClick={() => setFigureIndex(item.index)}
                  className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    item.index === figureIndex
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <ImageIcon size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {item.caption || item.alt || t('insertResult.untitled')}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {item.path}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === 'table' && tables !== null && tables.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">{t('insertResult.pickTable')}</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {tables.map((item) => (
                <button
                  key={item.index}
                  type="button"
                  onClick={() => setTableIndex(item.index)}
                  className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    item.index === tableIndex
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <Table2 size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {item.caption || t('insertResult.untitled')}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {item.header.join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {((kind === 'table' && (tables ?? []).length > 0) || (kind === 'figure' && figures.length > 0)) && (
          <div className="space-y-1">
            <p className="font-medium">{t('insertResult.caption')}</p>
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder={
                kind === 'figure'
                  ? figures[figureIndex]?.caption || t('insertResult.untitled')
                  : tables?.[tableIndex]?.caption || t('insertResult.untitled')
              }
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </div>
        )}

        {chapters.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">{t('insertResult.pickChapter')}</p>
            <select
              value={chapterPath}
              onChange={(event) => setChapterPath(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              {chapters.map((chapter) => (
                <option key={chapter.path} value={chapter.path}>
                  {chapter.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {table && (
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-[10px]">
            {table.markdown}
          </pre>
        )}

        {error && <p className="text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-7 px-2 text-[11px]" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            className="h-7 px-2 text-[11px]"
            disabled={
              busy ||
              !chapterPath ||
              (kind === 'table' ? !tables || tables.length === 0 : figures.length === 0)
            }
            onClick={() => void submit()}
          >
            {busy ? <Loader2 size={12} className="mr-1 animate-spin" /> : <FileSpreadsheet size={12} className="mr-1" />}
            {t('insertResult.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
