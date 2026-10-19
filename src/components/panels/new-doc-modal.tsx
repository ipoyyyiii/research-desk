'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/preferences';
import { Button, Modal, TextInput } from '@/components/ui';

/**
 * Dialog dokumen baru — NAMA BEBAS sesuai user (bukan auto bab{n}).
 * DImount sekali (top-bar); komponen lain minta buka via event global:
 * `requestNewDocument()` → dialog kebuka → POST /api/projects/{slug}/documents
 * → sukses: refresh tree + event `workspace:doc-created` { path } biar
 * pemanggil (shell) bisa langsung buka file-nya di editor.
 */
export const NEW_DOC_EVENT = 'workspace:new-doc';
export const DOC_CREATED_EVENT = 'workspace:doc-created';

/** Panggil dari komponen manapun buat buka dialog dokumen baru. */
export function requestNewDocument(): void {
  window.dispatchEvent(new CustomEvent(NEW_DOC_EVENT));
}

export function NewDocModal({ slug }: { slug: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = () => {
      setOpen(true);
      setTitle('');
      setError(null);
    };
    window.addEventListener(NEW_DOC_EVENT, open);
    return () => window.removeEventListener(NEW_DOC_EVENT, open);
  }, []);

  const create = async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name }),
      });
      const data: unknown = await res.json().catch(() => null);
      const docPath =
        data && typeof data === 'object' && 'document' in data
          ? (data as { document?: { path?: string } }).document?.path
          : undefined;
      if (!res.ok || typeof docPath !== 'string') {
        setError(t('err.createDoc'));
        return;
      }
      setOpen(false);
      setTitle('');
      window.dispatchEvent(new CustomEvent('workspace:tree-refresh'));
      window.dispatchEvent(
        new CustomEvent(DOC_CREATED_EVENT, { detail: { path: docPath } }),
      );
    } catch {
      setError(t('err.server'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && setOpen(false)} title={t('common.newDocument')}>
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
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim()) void create();
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('newDoc.hint')}</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void create()} disabled={busy || !title.trim()}>
            {busy ? '…' : t('common.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
