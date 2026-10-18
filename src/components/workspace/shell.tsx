'use client';

import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TopBar } from '@/components/layout/top-bar';
import { LeftPanel } from '@/components/panels/left-panel';
import { CenterPanel } from '@/components/panels/center-panel';
import { ChatPanel } from '@/components/panels/chat-panel';

export function WorkspaceShell({
  slug,
  projectName,
}: {
  slug: string;
  projectName: string;
}) {
  const [openFile, setOpenFile] = useState<string | null>(null);
  // Tambah versi biar editor reload kalau file yang sama dibuka ulang (mis. hasil buat dokumen baru)
  const [openVersion, setOpenVersion] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);

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

  const handleDocumentCreated = (path: string) => {
    refreshTree();
    setOpenFile(path);
    setOpenVersion((v) => v + 1);
  };

  const handleDeleteFile = (wasOpen: boolean) => {
    refreshTree();
    if (wasOpen) setOpenFile(null);
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
                  onOpenFile={(filePath) => {
                    setOpenFile(filePath);
                    setOpenVersion((v) => v + 1);
                  }}
                  onFileDeleted={handleDeleteFile}
                />
              </Panel>
              <Separator className="w-1 bg-neutral-200 transition-colors hover:bg-primary/40 dark:bg-neutral-800" />
            </>
          )}

          <Panel id="center" minSize="30" className="min-w-0">
            <CenterPanel slug={slug} openFile={openFile} openVersion={openVersion} />
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
