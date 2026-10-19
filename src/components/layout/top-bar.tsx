'use client';

import { useState } from 'react';
import { FilePlus2, Columns2, MessagesSquare } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button, IconButton, Modal, TextInput, StatusDot } from '@/components/ui';
import { SettingsMenu } from '@/components/workspace/settings-menu';

export function TopBar({
  projectName,
  projectSlug,
  onDocumentCreated,
  focusMode,
  onToggleFocusMode,
  rightOpen = true,
  onToggleRight,
}: {
  projectName: string;
  projectSlug: string;
  onDocumentCreated: (path: string) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  /** Panel kanan (AI Assistant) lagi kebuka? — buat aria-pressed toggle header. */
  rightOpen?: boolean;
  onToggleRight?: () => void;
}) {
  const t = useT();
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createDocument = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(t('err.createDoc'));
        return;
      }
      setNewDocOpen(false);
      setTitle('');
      onDocumentCreated(data.document.path);
    } catch {
      setError(t('err.server'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <header className="flex h-11 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight">⌗ {projectName}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Export menu — aktif di fase 4 */}
        <Button variant="ghost" disabled title="Fase 4">
          Export ▾
        </Button>
        <IconButton onClick={onToggleFocusMode} title="Focus mode (Esc)" className={focusMode ? 'text-blue-500' : ''}>
          <Columns2 size={15} />
        </IconButton>
        {!focusMode && (
          <Button
            variant="ghost"
            onClick={onToggleRight}
            aria-pressed={rightOpen}
            title={rightOpen ? t('layout.rightClose') : t('layout.aiOpen')}
          >
            <MessagesSquare size={15} />
            {t('layout.aiAssistant')}
          </Button>
        )}
        <Button variant="subtle" onClick={() => setNewDocOpen(true)}>
          <FilePlus2 size={15} />
          {t('common.newDocument')}
        </Button>
        {/* Settings unified ala Claude: Bahasa + Tema + Effort AI (dropdown). */}
        <SettingsMenu />
        <StatusDot tone="amber" title={`OpenCode: ${t('chat.statusOff')} (fase 2)`} />
      </div>

      {/* Dialog dokumen baru */}
      <Modal open={newDocOpen} onClose={() => setNewDocOpen(false)} title={t('common.newDocument')}>
        <div className="space-y-4">
          <div>
            <label htmlFor="new-doc-title" className="mb-1 block text-sm font-medium">
              {t('newDoc.label')}
            </label>
            <TextInput
              id="new-doc-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('newDoc.placeholder')}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && title.trim()) void createDocument();
              }}
            />
            <p className="mt-1 text-xs text-neutral-500">{t('newDoc.hint')}</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewDocOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void createDocument()} disabled={creating || !title.trim()}>
              {creating ? '…' : t('common.create')}
            </Button>
          </div>
        </div>
      </Modal>
    </header>
  );
}
