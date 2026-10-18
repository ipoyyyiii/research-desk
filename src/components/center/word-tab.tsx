'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, PenLine, TriangleAlert, Upload, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button } from '@/components/ui';

type SaveCandidate = { name: string; bytes: ArrayBuffer };

/**
 * Hook yang disuntik KE DALAM iframe WordCraft (same-origin). Dua tugas:
 * (1) matiin showSaveFilePicker dengan NotAllowedError → kode WordCraft
 *     otomatis jatuh ke path anchor-download; (2) tangkep anchor download
 * berisi blob → kirim bytes ke parent (app), tanpa download stinggal.
 */
const HOOK_SOURCE = `
(() => {
  if (window.__rwHooked) return;
  window.__rwHooked = true;
  const post = (name, bytesPromise) => Promise.resolve(bytesPromise).then((bytes) => {
    try { parent.postMessage({ source: 'wordcraft-bridge', kind: 'save', name: name, bytes: bytes }, '*'); } catch (e) {}
  });
  // Paksa path anchor: picker gagal dengan error NON-abort (harus, biar fallback anchor).
  try { window.showSaveFilePicker = function () {
    return Promise.reject(new DOMException('word-bridge: tanpa picker', 'NotAllowedError'));
  }; } catch (e) {}
  const proto = HTMLAnchorElement.prototype;
  const click = proto.click;
  proto.click = function () {
    try {
      const href = this.getAttribute('href') || '';
      if (href.startsWith('blob:') && this.hasAttribute('download')) {
        const name = this.getAttribute('download') || 'dokumen.md';
        this.addEventListener('click', (e) => e.preventDefault(), true);
        post(name, fetch(href).then((r) => r.arrayBuffer()));
        return undefined;
      }
    } catch (e) {}
    return click.apply(this, arguments);
  };
})();
`;

/**
 * Tab "Word": seluruh WordCraft (engine + UI Word lengkap, wasm 16MB gzip)
 * di iframe same-origin. File bab dilempar ke dalam via drop sintetis; hasil
 * Save diintip dari anchor-download lalu diminta disimpen balik ke file bab.
 */
export function WordTab({ slug, path }: { slug: string; path: string }) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [booted, setBooted] = useState(false);
  const [thrown, setThrown] = useState(false);
  const [throwFailed, setThrowFailed] = useState(false);
  const [pending, setPending] = useState<SaveCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const fileName = path.slice(path.lastIndexOf('/') + 1);

  // Sinkron: suntik hook begitu document iframe siap penuh.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const frame = frameRef.current;
      const doc = frame?.contentDocument;
      if (!doc || doc.readyState !== 'complete') return;
      const win = frame?.contentWindow as (Window & { __rwHooked?: boolean }) | null | undefined;
      if (win && !win.__rwHooked) {
        const script = doc.createElement('script');
        script.textContent = HOOK_SOURCE;
        (doc.head ?? doc.documentElement).appendChild(script);
        win.__rwHooked = true;
      }
      if (win?.__rwHooked) {
        window.clearInterval(timer);
        window.setTimeout(() => setBooted(true), 1200); // kasih waktu listener drop dipasang
      }
    }, 250);
    const stop = window.setTimeout(() => window.clearInterval(timer), 90000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, []);

  // Pesan simpan dari bridge iframe.
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      const data = event.data as
        | { source?: string; kind?: string; name?: string; bytes?: ArrayBuffer }
        | null;
      if (!data || data.source !== 'wordcraft-bridge') return;
      if (data.kind === 'save' && data.bytes instanceof ArrayBuffer) {
        setPending({ name: data.name ?? 'dokumen.md', bytes: data.bytes });
        setSavedMsg(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Lempar file bab: fetch bytes → File → drop sintetis ke canvas egui.
  const throwFile = useCallback(async () => {
    const frame = frameRef.current;
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    if (!win || !doc || !booted) {
      setThrowFailed(true);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`raw ${res.status}`);
      const bytes = await res.arrayBuffer();
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], fileName, { type: 'text/markdown' }));
      const target = doc.querySelector('canvas') ?? (doc.body as HTMLElement | null);
      if (!target) throw new Error('canvas belum ada');
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      setThrown(true);
      setThrowFailed(false);
    } catch {
      setThrowFailed(true);
    }
  }, [slug, path, fileName, booted]);

  // Simpan balik bytes hasil Word ke file bab (khusus .md — format lain via menu Ekspor).
  const keepSave = useCallback(async () => {
    if (!pending || saving) return;
    setSaving(true);
    try {
      const content = new TextDecoder().decode(pending.bytes);
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });
      if (res.ok) {
        setSavedMsg(true);
        setPending(null);
      }
    } catch {
      // banner tetep muncul, user bisa coba lagi
    } finally {
      setSaving(false);
    }
  }, [pending, saving, slug, path]);

  const nameMatches = pending !== null && pending.name === fileName;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-muted/50">
      {/* Bar mini: identitas file + status bridge */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
        <PenLine size={13} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {path} · {t('word.title')}
        </span>
        {!booted && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            <Loader2 size={11} className="mr-1 inline animate-spin" />
            {t('word.loading')}
          </span>
        )}
        <a
          href="/wordcraft/index.html"
          target="_blank"
          rel="noopener noreferrer"
          title={t('word.fullPage')}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink size={13} />
        </a>
        <Button
          variant="default"
          className="h-7 shrink-0 px-2.5 text-[11px]"
          disabled={!booted}
          onClick={() => void throwFile()}
        >
          <Upload size={12} className="mr-1" />
          {t('word.openBtn')}
        </Button>
      </div>

      {/* Status lempar file */}
      {thrown && !pending && (
        <p className="shrink-0 px-2 py-1 text-[11px] text-muted-foreground">{t('word.thrown')}</p>
      )}
      {throwFailed && (
        <p className="flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] text-amber-700">
          <TriangleAlert size={11} /> {t('word.openFailed')}
        </p>
      )}

      {/* Banner simpan dari Word */}
      {pending && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-700/30 bg-amber-50 px-2 py-1.5 dark:bg-amber-950/40">
          <span className="min-w-0 flex-1 text-[11px] text-amber-800 dark:text-amber-200">
            {nameMatches
              ? t('word.saveAsk').replace('{name}', pending.name)
              : t('word.saveHint').replace('{name}', pending.name)}
          </span>
          {nameMatches && (
            <>
              <Button variant="default" className="h-6 px-2 text-[11px]" disabled={saving} onClick={() => void keepSave()}>
                {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('word.saveKeep')}
              </Button>
              {savedMsg && <span className="text-[11px] text-green-700">{t('word.saved')}</span>}
            </>
          )}
          <button
            type="button"
            aria-label={t('word.discard')}
            onClick={() => setPending(null)}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Kanvas WordCraft penuh */}
      <iframe
        ref={frameRef}
        src="/wordcraft/index.html"
        title={t('word.title')}
        className="h-full w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
