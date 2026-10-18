'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, Loader2 } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button } from '@/components/ui';

/**
 * Tab Zotero (fase 7): panel penuh di rail kiri. Kredensial disimpen server
 * (data/zotero-<slug>.json, 0600, gitignored); sync menarik seluruh library
 * top-level user dari api.zotero.org lalu merge add-only ke references.bib
 * (key yang sudah ada gak disentuh — entry manual/jurnal kejaga).
 */
export function ZoteroPanel({ slug }: { slug: string }) {
  const t = useT();
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'sync' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [bibTotal, setBibTotal] = useState<number | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/zotero`);
      const data = (await res.json()) as { configured?: boolean; userId?: string | null };
      setConnected(res.ok && data.configured && data.userId ? data.userId : null);
    } catch {
      setConnected(null);
    }
  }, [slug]);

  // Status koneksi + total entri bib (query `?q=` polos = semua).
  useEffect(() => {
    void loadStatus();
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/bib`);
        const data = (await res.json()) as { total?: number };
        setBibTotal(res.ok ? (data.total ?? 0) : null);
      } catch {
        setBibTotal(null);
      }
    })();
  }, [slug, loadStatus]);

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
        setApiKey(''); // key rahasia — jangan dianggep-anggep di state
        setUserId('');
        await loadStatus();
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
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/zotero`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      const data = (await res.json()) as { added?: number; error?: string };
      if (res.ok) {
        setMsg(data.added ? `zotero.added:${data.added}` : 'zotero.nothing');
        const bib = await fetch(`/api/projects/${encodeURIComponent(slug)}/bib`);
        const bibData = (await bib.json()) as { total?: number };
        setBibTotal(bib.ok ? (bibData.total ?? 0) : null);
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
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
        {connected && (
          <div className="mb-2.5 flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1.5 text-[11px] text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
            {t('zotero.conf', { id: connected })}
          </div>
        )}
        {bibTotal !== null && (
          <p className="mb-2.5 text-[11px] text-muted-foreground">
            {t('zotero.bibTotal', { n: bibTotal })}
          </p>
        )}

        <label className="mb-1 block text-[11px] font-medium text-card-foreground">
          {t('zotero.userId')}
        </label>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value.trim())}
          placeholder={t('zotero.userId')}
          inputMode="numeric"
          className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring"
        />
        <label className="mb-1 block text-[11px] font-medium text-card-foreground">
          {t('zotero.apiKey')}
        </label>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder={connected ? t('zotero.apiKeyNew') : t('zotero.apiKey')}
          className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring"
        />
        <p className="mb-2.5 text-[10px] leading-snug text-muted-foreground">{t('zotero.hint')}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            className="h-7 px-2.5 text-[11px]"
            disabled={busy !== null || userId === '' || apiKey === ''}
            onClick={() => void saveCreds()}
          >
            {t('zotero.saveBtn')}
          </Button>
          <Button
            variant="default"
            className="flex h-7 shrink-0 items-center gap-1 px-2.5 text-[11px]"
            disabled={busy !== null || connected === null}
            onClick={() => void pullLibrary()}
          >
            {busy === 'sync' ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}
            {busy === 'sync' ? t('zotero.pulling') : t('zotero.pullBtn')}
          </Button>
        </div>

        {msg && (
          <p className="mt-2.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            {msg.startsWith('zotero.added:')
              ? t('zotero.added', { n: msg.slice('zotero.added:'.length) })
              : t(msg)}
          </p>
        )}
      </div>
    </section>
  );
}
