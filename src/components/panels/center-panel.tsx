'use client';

import { ClipboardList, FilePlus2, Globe, Loader2, PencilRuler, PenLine, Plus, Table2, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/preferences';
import { ThesisEditor } from '@/components/editor/thesis-editor';
import { WebView } from '@/components/center/web-view';
import { FileView } from '@/components/center/file-view';
import { WordTab } from '@/components/center/word-tab';
import { isPreviewBinary } from '@/lib/paths';
import type { CenterTab } from '@/components/workspace/shell';

/** Nama file tanpa ekstensi + ekstensi — ekstensi jadi badge tipe ala beeblio (MD/BIB/PDF…). */
function splitName(path: string): { name: string; ext: string | null } {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { name: fileName, ext: null };
  return { name: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

/** Hostname buat label tab/footer web. Gagal parse → tampilkan url mentahnya. */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function CenterPanel({
  slug,
  tabs,
  activeId,
  onActivate,
  onClose,
  onNewWeb,
  onWebUrl,
  onNewDocument,
  onOpenWord,
}: {
  slug: string;
  tabs: CenterTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewWeb: () => void;
  onWebUrl: (id: string, url: string) => void;
  onNewDocument: (title: string) => Promise<boolean>;
  onOpenWord: (path: string) => void;
}) {
  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  // Hitungan kata per-path buat footer (ThesisEditor lapor via onWordsChange).
  const [wordsByPath, setWordsByPath] = useState<Record<string, number>>({});

  return (
    <section className="flex h-full min-w-0 flex-col bg-muted/50">
      {tabs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivate}
            onClose={onClose}
            onNewWeb={onNewWeb}
            onNewDocument={onNewDocument}
          />
          <div className="flex min-h-0 flex-1 text-foreground">
            {active?.kind === 'file' &&
              (isPreviewBinary(active.path) ? (
                <FileView key={`${active.path}:${active.version}`} slug={slug} path={active.path} />
              ) : (
                <ThesisEditor
                  key={`${active.path}:${active.version}`}
                  slug={slug}
                  filePath={active.path}
                  onWordsChange={(n) =>
                    setWordsByPath((prev) => (prev[active.path] === n ? prev : { ...prev, [active.path]: n }))
                  }
                />
              ))}
            {active?.kind === 'web' && (
              <WebView
                key={active.id}
                url={active.url}
                onChangeUrl={(url) => onWebUrl(active.id, url)}
              />
            )}
            {active?.kind === 'word' && <WordTab key={`${active.id}:${active.path}`} slug={slug} path={active.path} />}
          </div>
          <FooterBar active={active} words={active?.kind === 'file' ? wordsByPath[active.path] : undefined} onOpenWord={onOpenWord} />
        </>
      )}
    </section>
  );
}

/** Strip tab ala beeblio: chip file (nama + badge tipe) / chip web (hostname), ✕, tombol +. */
function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNewWeb,
  onNewDocument,
}: {
  tabs: CenterTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewWeb: () => void;
  onNewDocument: (title: string) => Promise<boolean>;
}) {
  const t = useT();

  const [menuOpen, setMenuOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submitDoc = async () => {
    const title = docTitle.trim();
    if (title.length === 0 || creating) return;
    setCreating(true);
    setCreateError(null);
    const ok = await onNewDocument(title);
    setCreating(false);
    if (ok) {
      setMenuOpen(false);
      setNaming(false);
      setDocTitle('');
    } else {
      setCreateError(t('err.createDoc'));
    }
  };

  const chip = (tab: CenterTab) => {
    const active = tab.id === activeId;
    const fileParts = tab.kind === 'file' ? splitName(tab.path) : null;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onActivate(tab.id)}
        title={tab.kind === 'file' || tab.kind === 'word' ? tab.path : tab.url || undefined}
        className={`group flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border-b-2 border-b-transparent px-3 transition-colors ${
          active
            ? 'border-b-primary bg-background text-card-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        {fileParts ? (
          <>
            <span className="max-w-40 truncate text-xs">{fileParts.name}</span>
            {fileParts.ext && (
              <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-mono uppercase text-muted-foreground">
                {fileParts.ext}
              </span>
            )}
          </>
        ) : tab.kind === 'web' ? (
          <>
            <Globe size={12} className="shrink-0" />
            <span className="max-w-40 truncate text-xs">
              {tab.url === '' ? t('center.newWeb') : safeHostname(tab.url)}
            </span>
          </>
        ) : tab.kind === 'word' ? (
          <>
            <PenLine size={12} className="shrink-0 text-amber-700" />
            <span className="max-w-40 truncate text-xs">{splitName(tab.path).name}</span>
            <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-mono uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              W
            </span>
          </>
        ) : null}
        {/* ✕ di dalam button tab — pakai pattern span/button LeftPanel (nested <button> tidak valid). */}
        <span
          role="button"
          tabIndex={-1}
          aria-label={t('center.closeTab')}
          title={t('center.closeTab')}
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.id);
          }}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:text-destructive ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <X size={12} />
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-1">{tabs.map(chip)}</div>
      <div className="relative flex shrink-0">
        <button
          type="button"
          onClick={() => {
            setMenuOpen((prev) => !prev);
            setNaming(false);
            setCreateError(null);
          }}
          title={t('center.newWeb')}
          aria-label={t('center.newWeb')}
          aria-expanded={menuOpen}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus size={14} />
        </button>

        {menuOpen && (
          <>
            {/* Backdrop transparan untuk klik-diluar; di bawah menu. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              role="menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMenuOpen(false);
              }}
              className="absolute right-1 top-10 z-50 w-48 rounded-lg border border-border bg-card p-1 shadow-lg"
            >
              {naming ? (
                <form
                  className="p-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitDoc();
                  }}
                >
                  <input
                    autoFocus
                    type="text"
                    value={docTitle}
                    onChange={(event) => setDocTitle(event.target.value)}
                    placeholder={t('newDoc.placeholder')}
                    aria-label={t('newDoc.label')}
                    className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <button
                    type="submit"
                    disabled={docTitle.trim().length === 0 || creating}
                    className="mt-1.5 flex w-full cursor-pointer items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {creating && <Loader2 size={11} className="animate-spin" />}
                    {t('common.create')}
                  </button>
                  {createError && <p className="mt-1 text-[10px] text-destructive">{createError}</p>}
                </form>
              ) : (
                <>
                  <MenuItem
                    icon={FilePlus2}
                    label={t('center.newDoc')}
                    onClick={() => {
                      setNaming(true);
                      setDocTitle('');
                      setCreateError(null);
                    }}
                  />
                  <MenuItem
                    icon={Globe}
                    label={t('center.newWeb')}
                    onClick={() => {
                      setMenuOpen(false);
                      onNewWeb();
                    }}
                  />
                  <div className="mx-1 my-1 h-px bg-border" />
                  <MenuItem icon={PencilRuler} label={t('center.itemDrawing')} disabled title={t('center.soon')} />
                  <MenuItem icon={ClipboardList} label={t('center.itemSurvey')} disabled title={t('center.soon')} />
                  <MenuItem icon={Table2} label={t('center.itemMatrix')} disabled title={t('center.soon')} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Baris item menu + (menu ala ss3: ikon + label; disabled = fitur berikutnya). */
function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-card-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Icon size={13} className="shrink-0 text-muted-foreground" />
      {label}
    </button>
  );
}

/** Footer ala beeblio: path/label tab aktif di kiri, jenis konten di kanan (file saja). */
function FooterBar({
  active,
  words,
  onOpenWord,
}: {
  active: CenterTab | null;
  words?: number;
  onOpenWord: (path: string) => void;
}) {
  const t = useT();
  let left = '';
  if (active?.kind === 'file' || active?.kind === 'word') left = active.path;
  else if (active) left = active.url === '' ? t('center.webPage') : safeHostname(active.url);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate font-mono">{left}</span>
      {active?.kind === 'file' && isPreviewBinary(active.path) ? (
        <span className="shrink-0 font-mono uppercase">{active.path.slice(active.path.lastIndexOf('.') + 1)}</span>
      ) : active?.kind === 'file' ? (
        <>
          {typeof words === 'number' && <span className="shrink-0 font-mono">{words} {t('center.words')}</span>}
          <button
            type="button"
            onClick={() => onOpenWord(active.path)}
            title={t('word.openBtn')}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-amber-700"
          >
            <PenLine size={11} />
            {t('word.openBtn')}
          </button>
          <span className="shrink-0">{t('center.workspaceFile')}</span>
        </>
      ) : active?.kind === 'word' ? (
        <span className="shrink-0">{t('word.title')}</span>
      ) : null}
    </footer>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="rounded-xl border border-dashed border-border bg-card px-8 py-10 shadow-sm">
        <p className="font-serif text-base font-semibold tracking-tight">{t('editor.noFile')}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('editor.noFileHint')}</p>
      </div>
    </div>
  );
}
