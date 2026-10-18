'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, RefreshCw, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button } from '@/components/ui';
import {
  PaperCard,
  parseSavedEntry,
  type SavedJournalEntry,
} from '@/components/panels/journal-panel';

/**
 * Import Zotero (fase 7): kredensial di server (data/zotero-<slug>.json,
 * 0600) → sync menarik library top-level user lalu merge add-only ke
 * references.bib. Key gak pernah mendarat balik ke UI setelah disimpen.
 */
/** Form import Zotero: kredensial di server → sync merge add-only ke references.bib. */
function ZoteroImportForm({ slug, onClose }: { slug: string; onClose: () => void }) {
  const t = useT();
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'sync' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/zotero`);
        const data = (await res.json()) as { configured?: boolean; userId?: string | null };
        setConnected(res.ok && data.configured && data.userId ? data.userId : null);
      } catch {
        setConnected(null);
      }
    })();
  }, [slug]);

  const saveCreds = async () => {
    if (busy) return;
    setBusy('save');
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/zotero`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', userId, apiKey }),
      });
      if (res.ok) {
        setConnected(userId);
        setApiKey(''); // key lif rahasia — jangan dianggep-anggep di state
        setUserId('');
        setMsg('zotero.saved');
      } else {
        setMsg('zotero.errData');
      }
    } catch {
      setMsg('zotero.errNetwork');
    } finally {
      setBusy(null);
    }
  };

  const pullLibrary = async () => {
    if (busy) return;
    setBusy('sync');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/zotero`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      const data = (await res.json()) as { added?: number; error?: string };
      if (res.ok) {
        setMsg(data.added ? `zotero.added:${data.added}` : 'zotero.nothing');
      } else {
        const code = data.error && data.error.startsWith('zotero.') ? data.error : 'zotero.errUpstream';
        setMsg(code);
      }
    } catch {
      setMsg('zotero.errNetwork');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="shrink-0 border-b border-border bg-muted/40 p-2 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="truncate font-medium text-card-foreground">{t('zotero.title')}</span>
        <button
          type="button"
          aria-label={t('library.refresh')}
          onClick={onClose}
          className="ml-auto shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={12} />
        </button>
      </div>
      {connected && (
        <p className="mb-1.5 truncate text-[10px] text-green-700 dark:text-green-400">
          {t('zotero.conf', { id: connected })}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value.trim())}
          placeholder={t('zotero.userId')}
          inputMode="numeric"
          className="w-full rounded-md border border-border bg-background px-2 py-1 outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring"
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder={t('zotero.apiKey')}
          className="w-full rounded-md border border-border bg-background px-2 py-1 outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring"
        />
        <p className="text-[10px] leading-snug text-muted-foreground">{t('zotero.hint')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" className="h-6 px-2 text-[11px]" disabled={busy !== null || userId === '' || apiKey === ''} onClick={() => void saveCreds()}>
            {t('zotero.saveBtn')}
          </Button>
          <Button variant="default" className="h-6 px-2 text-[11px]" disabled={busy !== null || connected === null} onClick={() => void pullLibrary()}>
            {busy === 'sync' ? t('zotero.pulling') : t('zotero.pullBtn')}
          </Button>
        </div>
        {msg && (
          <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300">
            {msg.startsWith('zotero.added:')
              ? t('zotero.added', { n: msg.slice('zotero.added:'.length) })
              : t(msg)}
          </p>
        )}
      </div>
    </div>
  );
}

// Tab "Perpustakaan" (fase 3): daftar jurnal tersimpan project (ikut references.bib).
// Buang entri → dibersih langsung, backend ikut hapus entri BibTeX-nya.

export function LibraryPanel({ slug }: { slug: string }) {
  const t = useT();
  const [entries, setEntries] = useState<SavedJournalEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** Form import Zotero kebuka. */
  const [zoteroOpen, setZoteroOpen] = useState(false);
  /** paperId yang lagi dihapus (✕ mati sementara). */
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  /** Catatan kecil habis buang — entri BibTeX ikut kebersih. */
  const [deletedNote, setDeletedNote] = useState(false);

  const fetchSaved = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/journals/saved?slug=${encodeURIComponent(slug)}`);
      const data: unknown = await res.json();
      const raw = res.ok && data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results)
        ? ((data as { results: unknown[] }).results)
        : null;
      if (!raw) {
        setError(true);
        setEntries([]);
        return;
      }
      const parsed = raw
        .map(parseSavedEntry)
        .filter((entry): entry is SavedJournalEntry => entry !== null);
      setEntries(parsed);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Ganti project → kosongin dulu, terus ambil ulang sekali di mount.
  useEffect(() => {
    setEntries(null);
    setDeletedNote(false);
    void fetchSaved();
  }, [slug, fetchSaved]);

  const removeEntry = async (entry: SavedJournalEntry) => {
    if (removing.has(entry.paperId)) return;
    setRemoving((prev) => new Set(prev).add(entry.paperId));
    try {
      const res = await fetch('/api/journals/save', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, paperId: entry.paperId }),
      });
      if (res.ok) {
        setEntries((prev) => prev?.filter((item) => item.paperId !== entry.paperId) ?? []);
        setDeletedNote(true);
      }
    } catch {
      // gagal diam — entri tetap daftar, user bisa refresh
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(entry.paperId);
        return next;
      });
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5 ">
        <span className="min-w-0 truncate text-[11px] font-medium text-card-foreground ">
          {t('library.title')}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground  ">
          {entries ? `${entries.length} ${t('library.count')}` : '…'}
        </span>
        <button
          type="button"
          onClick={() => {
            setZoteroOpen(true);
            setDeletedNote(false);
          }}
          title={t('zotero.title')}
          aria-label={t('zotero.title')}
          className="ml-auto shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CloudDownload size={12} />
        </button>
        <button
          type="button"
          onClick={() => {
            setDeletedNote(false);
            void fetchSaved();
          }}
          disabled={loading}
          title={t('library.refresh')}
          aria-label={t('library.refresh')}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40  "
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {zoteroOpen && <ZoteroImportForm slug={slug} onClose={() => setZoteroOpen(false)} />}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {deletedNote && (
          <p className="mb-1.5 rounded bg-blue-50 px-2 py-1 text-[10px] leading-snug text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            {t('library.deleted')}
          </p>
        )}
        {loading ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">…</p>
        ) : entries === null ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">…</p>
        ) : error ? (
          <p className="px-1 py-6 text-center text-xs text-red-500">{t('journal.error')}</p>
        ) : entries.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            {t('library.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <PaperCard
                  slug={slug}
                  paper={entry.paper}
                  savedBibKey={entry.bibKey}
                  compact
                  onRemove={() => void removeEntry(entry)}
                  removing={removing.has(entry.paperId)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
