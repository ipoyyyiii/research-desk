'use client';

import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TopBar } from '@/components/layout/top-bar';
import { LeftPanel } from '@/components/panels/left-panel';
import { CenterPanel } from '@/components/panels/center-panel';
import { ChatPanel } from '@/components/panels/chat-panel';

// ── State tab panel tengah (sumber kebenaran satu-satunya) ───────────────────

export type CenterTab =
  | { id: string; kind: 'file'; path: string; version: number }
  | { id: string; kind: 'web'; url: string };

interface CenterState {
  tabs: CenterTab[];
  activeId: string | null;
}

// Tab file ID-nya path (unik per file); tab web pakai counter modul biar ID
// stabil & deterministik (double-invoke updater Strict Mode gak konkuren).
let webTabSeq = 0;
const fileTabId = (path: string) => `file:${path}`;

/** Buka file di tab: sudah ada → activate + bump version (remount editor); belum → tab baru. */
function openFileTabState(prev: CenterState, path: string): CenterState {
  const id = fileTabId(path);
  const exists = prev.tabs.some((tab) => tab.kind === 'file' && tab.path === path);
  if (!exists) {
    return { tabs: [...prev.tabs, { id, kind: 'file' as const, path, version: 0 }], activeId: id };
  }
  return {
    tabs: prev.tabs.map((tab) =>
      tab.id === id && tab.kind === 'file' ? { ...tab, version: tab.version + 1 } : tab,
    ),
    activeId: id,
  };
}

/** Tutup tab; kalau tab aktif yang ditutup → activate tetangganya (kanan, fallback kiri). */
function closeTabState(prev: CenterState, id: string): CenterState {
  const closedIndex = prev.tabs.findIndex((tab) => tab.id === id);
  if (closedIndex === -1) return prev;
  const tabs = prev.tabs.filter((tab) => tab.id !== id);
  if (prev.activeId !== id) return { tabs, activeId: prev.activeId };
  const next = tabs[closedIndex] ?? tabs[closedIndex - 1] ?? null;
  return { tabs, activeId: next ? next.id : null };
}

export function WorkspaceShell({
  slug,
  projectName,
}: {
  slug: string;
  projectName: string;
}) {
  const [center, setCenter] = useState<CenterState>({ tabs: [], activeId: null });
  const [focusMode, setFocusMode] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);

  // Path tab file yang aktif — dipakai LeftPanel (highlight) & ChatPanel (konteks).
  const activeTab = center.tabs.find((tab) => tab.id === center.activeId) ?? null;
  const openFile = activeTab?.kind === 'file' ? activeTab.path : null;

  // Catat project ini sebagai yang terakhir dibuka — dipakai /workspace auto-redirect.
  useEffect(() => {
    void fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
  }, [slug]);

  // Esc = focus mode (sembunyikan panel samping). Jangan ke-toggle pas lagi ngetik di chat/form.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
      if (event.key === 'Escape' && !event.defaultPrevented && !typing) setFocusMode((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refreshTree = () => setTreeVersion((v) => v + 1);

  const openFileTab = (path: string) => setCenter((prev) => openFileTabState(prev, path));
  const activateTab = (id: string) => setCenter((prev) => ({ ...prev, activeId: id }));
  const closeTab = (id: string) => setCenter((prev) => closeTabState(prev, id));

  const newWebTab = () => {
    const id = `web-${++webTabSeq}`;
    setCenter((prev) => ({ tabs: [...prev.tabs, { id, kind: 'web' as const, url: '' }], activeId: id }));
  };

  const setWebUrl = (id: string, url: string) =>
    setCenter((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) => (tab.id === id && tab.kind === 'web' ? { ...tab, url } : tab)),
    }));

  // Dokumen baru dari TopBar tree yang di-refresh + SELALU buka tab (kalau tab
  // path itu sudah ada → bump version, editor remount dan fetch konten baru).
  const handleDocumentCreated = (path: string) => {
    refreshTree();
    openFileTab(path);
  };

  // Versi nilai-balik untuk menu + tab-bar: true kalau dokumen berhasil dibuat.
  const createDocumentFromTitle = async (title: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      handleDocumentCreated(data.document.path);
      return true;
    } catch {
      return false;
    }
  };

  // Kontrak LeftPanel cuma kasih wasOpen (file terhapus = tab file yang aktif
  // sekarang), jadi yang bisa ditutup itu tab aktif saja — tab non-aktif yang
  // ternyata buka file sama gak terdeteksi dari param ini.
  const handleDeleteFile = (wasOpen: boolean) => {
    refreshTree();
    if (!wasOpen) return;
    setCenter((prev) => {
      const active = prev.tabs.find((tab) => tab.id === prev.activeId);
      if (!active || active.kind !== 'file') return prev;
      return closeTabState(prev, active.id);
    });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        projectName={projectName}
        projectSlug={slug}
        onDocumentCreated={handleDocumentCreated}
        focusMode={focusMode}
        onToggleFocusMode={() => setFocusMode((v) => !v)}
      />

      <div className="flex min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          {!focusMode && (
            <>
              <Panel id="left" defaultSize="20" minSize="13" maxSize="36" className="min-w-0">
                <LeftPanel
                  slug={slug}
                  treeVersion={treeVersion}
                  openFile={openFile}
                  onOpenFile={openFileTab}
                  onFileDeleted={handleDeleteFile}
                />
              </Panel>
              <Separator className="w-1 bg-neutral-200 transition-colors hover:bg-primary/40 dark:bg-neutral-800" />
            </>
          )}

          <Panel id="center" minSize="30" className="min-w-0">
            <CenterPanel
              slug={slug}
              tabs={center.tabs}
              activeId={center.activeId}
              onActivate={activateTab}
              onClose={closeTab}
              onNewWeb={newWebTab}
              onWebUrl={setWebUrl}
              onNewDocument={createDocumentFromTitle}
            />
          </Panel>

          {!focusMode && (
            <>
              <Separator className="w-1 bg-neutral-200 transition-colors hover:bg-primary/40 dark:bg-neutral-800" />
              <Panel id="right" defaultSize="27" minSize="18" maxSize="42" className="min-w-0">
                <ChatPanel slug={slug} projectTitle={projectName} activeFilePath={openFile} />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  );
}
