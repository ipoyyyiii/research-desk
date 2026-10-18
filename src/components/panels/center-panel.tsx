'use client';

import { Globe, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { ThesisEditor } from '@/components/editor/thesis-editor';
import { WebView } from '@/components/center/web-view';
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
}: {
  slug: string;
  tabs: CenterTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewWeb: () => void;
  onWebUrl: (id: string, url: string) => void;
}) {
  const active = tabs.find((tab) => tab.id === activeId) ?? null;

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
          />
          <div className="flex min-h-0 flex-1 text-foreground">
            {active?.kind === 'file' && (
              <ThesisEditor key={`${active.path}:${active.version}`} slug={slug} filePath={active.path} />
            )}
            {active?.kind === 'web' && (
              <WebView
                key={active.id}
                url={active.url}
                onChangeUrl={(url) => onWebUrl(active.id, url)}
              />
            )}
          </div>
          <FooterBar active={active} />
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
}: {
  tabs: CenterTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewWeb: () => void;
}) {
  const t = useT();

  const chip = (tab: CenterTab) => {
    const active = tab.id === activeId;
    const fileParts = tab.kind === 'file' ? splitName(tab.path) : null;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onActivate(tab.id)}
        title={tab.kind === 'file' ? tab.path : tab.url || undefined}
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
      <button
        type="button"
        onClick={onNewWeb}
        title={t('center.newWeb')}
        aria-label={t('center.newWeb')}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Globe size={13} />
      </button>
    </div>
  );
}

/** Footer ala beeblio: path/label tab aktif di kiri, jenis konten di kanan (file saja). */
function FooterBar({ active }: { active: CenterTab | null }) {
  const t = useT();
  let left = '';
  if (active?.kind === 'file') left = active.path;
  else if (active) left = active.url === '' ? t('center.webPage') : safeHostname(active.url);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate font-mono">{left}</span>
      {active?.kind === 'file' && <span className="shrink-0">{t('center.workspaceFile')}</span>}
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
