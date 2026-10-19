'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { useT } from '@/lib/preferences';

/**
 * Modal create project homepage — dialog kecil (backdrop blur ringan, Esc +
 * klik backdrop menutup): Nama + Folder → POST /api/projects, PATCH last-opened,
 * lalu router.push ke /p/{slug}. Fresh reset tiap dibuka (pola settings-dialog).
 */
export function CreateProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Modal fresh tiap dibuka: form kosong, fokus ke Nama.
      setName('');
      setFolder('');
      setError(null);
      nameRef.current?.focus();
    }
  }, [open]);

  // Esc menutup — capture di window biar gak tabrakan listener lain.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Kunci scroll halaman belakang selama modal kebuka.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder }),
      });
      if (!res.ok) {
        setError(t('err.createProject'));
        return;
      }
      const data = await res.json();
      const slug: string | undefined = data?.project?.slug;
      if (!slug) {
        setError(t('err.createProject'));
        return;
      }
      // Catat last-opened dulu — kegagalannya gak blokir masuk workspace.
      try {
        await fetch('/api/projects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
      } catch {
        // Gagal nyatet — tetap lanjut masuk.
      }
      router.push(`/p/${slug}`);
    } catch {
      setError(t('err.server'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-create-title"
        className="w-[min(92vw,420px)] rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <h2 id="home-create-title" className="text-[15px] font-semibold tracking-tight">
          {t('w.attachTitle')}
        </h2>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t('home.newProjectHint')}
        </p>

        <form
          onSubmit={(event) => void submit(event)}
          className="mt-4 space-y-3"
        >
          <div>
            <label htmlFor="home-project-name" className="block text-sm font-medium">
              {t('w.nameLabel')}
            </label>
            <input
              id="home-project-name"
              ref={nameRef}
              type="text"
              required
              autoFocus
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors [transition-property:color,background-color,border-color] placeholder:text-muted-foreground focus:border-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="home-project-folder" className="block text-sm font-medium">
              {t('w.folderLabel')}
            </label>
            <input
              id="home-project-folder"
              type="text"
              required
              disabled={busy}
              dir="ltr"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-xs outline-none transition-colors [transition-property:color,background-color,border-color] placeholder:text-muted-foreground focus:border-primary disabled:opacity-50"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground transition-colors [transition-property:color,background-color] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={15} aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            {busy ? t('w.attaching') : t('w.attach')}
          </button>
        </form>
      </div>
    </div>
  );
}
