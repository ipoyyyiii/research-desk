'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Table2, TriangleAlert, Upload, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button } from '@/components/ui';

type SaveCandidate = { name: string; bytes: ArrayBuffer };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function dropMime(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'csv') return 'text/csv';
  if (ext === 'tsv') return 'text/tab-separated-values';
  return XLSX_MIME;
}

/**
 * Hook yang disuntik KE DALAM iframe GridCraft (same-origin). Sama uratnya
 * dengan bridge WordCraft: (1) showSaveFilePicker palsu — simpan di Excel
 * sukses tanpa dialog OS, bytes dijemput lewat writable stream lalu
 * dikirim ke parent via postMessage; (2) jemput anchor-download (File →
 * Save as) TANPA memblokir basis unduhannya.
 * Tag sengaja beda dari Word supaya tab Word & tab Excel gak saling
 * nyimpen kirim-kirim pesan.
 */
const HOOK_SOURCE = `
(() => {
  if (window.__rwHooked) return;
  window.__rwHooked = true;
  const post = (name, bytes) => {
    try { parent.postMessage({ source: 'gridcraft-bridge', kind: 'save', name: name, bytes: bytes }, '*'); } catch (e) {}
  };
  try {
    window.showSaveFilePicker = async function (opts) {
      const name = (opts && opts.suggestedName) || 'book.xlsx';
      return {
        kind: 'file',
        name: name,
        createWritable: async function () {
          const parts = [];
          return {
            write: async function (d) {
              if (d && typeof d === 'object' && 'type' in d) {
                if (d.type === 'truncate') { parts.length = 0; if (d.size > 0) parts.push(new Uint8Array(d.size)); return; }
                if (d.type === 'seek') return;
                if ('data' in d) { d = d.data; } else { return; }
              }
              if (d instanceof Blob) { d = await d.arrayBuffer(); }
              if (d instanceof ArrayBuffer) { parts.push(new Uint8Array(d)); return; }
              if (ArrayBuffer.isView(d)) { parts.push(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)); return; }
              parts.push(new TextEncoder().encode(String(d)));
            },
            truncate: async function (size) { parts.length = 0; if (size > 0) parts.push(new Uint8Array(size)); },
            seek: async function () {},
            close: async function () {
              let total = 0;
              for (const p of parts) { total += p.length; }
              const out = new Uint8Array(total);
              let at = 0;
              for (const p of parts) { out.set(p, at); at += p.length; }
              post(name, out.buffer);
            },
            abort: async function (r) { throw r; },
          };
        },
      };
    };
  } catch (e) {}
  const proto = HTMLAnchorElement.prototype;
  const click = proto.click;
  proto.click = function () {
    try {
      const href = this.getAttribute('href') || '';
      if (href.startsWith('blob:') && this.hasAttribute('download')) {
        const name = this.getAttribute('download') || 'book.xlsx';
        fetch(href).then((r) => r.arrayBuffer()).then((bytes) => post(name, bytes)).catch(() => {});
      }
    } catch (e) {}
    return click.apply(this, arguments);
  };
})();
`;

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Tab "Excel": GridCraft (spreadsheet Rust→wasm) di iframe same-origin,
 * pola persis tab Word — file .xlsx/.csv ditenggelam lewat drop sintetis;
 * hasil Save GridCraft (bytes) dikirim ke parent → disimpen balik ke file.
 */
export function GridTab({ slug, path, version }: { slug: string; path: string; version: number }) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [booted, setBooted] = useState(false);
  const [thrown, setThrown] = useState(false);
  const [throwFailed, setThrowFailed] = useState(false);
  const [pending, setPending] = useState<SaveCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  // Versi bytes yang di-dalam Excel vs disk — basis cek file berubah di luar.
  const inGridRef = useRef<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);

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
        window.setTimeout(() => setBooted(true), 1500);
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
      if (!data || data.source !== 'gridcraft-bridge') return;
      if (data.kind === 'save' && data.bytes instanceof ArrayBuffer) {
        setPending({ name: data.name ?? 'book.xlsx', bytes: data.bytes });
        setSavedMsg(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Lempar file spreadsheet: fetch bytes → File → drop sintetis ke canvas.
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
      dt.items.add(new File([bytes], fileName, { type: dropMime(fileName) }));
      const target = doc.querySelector('canvas') ?? (doc.body as HTMLElement | null);
      if (!target) throw new Error('canvas belum ada');
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      // Banding byte pakai latin1 (gak pernah gagal decode, pas buat identitas).
      const latin = new TextDecoder('latin1').decode(new Uint8Array(bytes));
      inGridRef.current = latin;
      seenRef.current = latin;
      setStale(null);
      setThrown(true);
      setThrowFailed(false);
    } catch {
      setThrowFailed(true);
    }
  }, [slug, path, fileName, booted]);

  // Auto-lempar: tab dibuka / file diklik lagi → begitu siap, file dilempar.
  // version naik tiap klik → lempar ulang. Beda dari Word: GridCraft cudah
  // nggak udah pasang listener drop pas doc "complete" (boot wasm terus jalan),
  // jadi tiap belum hitam (thrown), ulang tiap 2 detik sampe hit.
  const queuedThrow = useRef(true);
  useEffect(() => {
    queuedThrow.current = true;
    if (booted) {
      queuedThrow.current = false;
      void throwFile();
    }
  }, [version, booted, throwFile]);
  useEffect(() => {
    if (!booted || thrown) return;
    const poll = window.setInterval(() => {
      void throwFile();
    }, 2000);
    const stop = window.setTimeout(() => window.clearInterval(poll), 90000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [booted, thrown, throwFile]);

  // Simpan balik bytes hasil Excel ke file spreadsheet (base64 → PUT).
  const keepSave = useCallback(async () => {
    if (!pending || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: toBase64(pending.bytes), encoding: 'base64' }),
      });
      if (res.ok) {
        const latin = new TextDecoder('latin1').decode(new Uint8Array(pending.bytes));
        inGridRef.current = latin;
        seenRef.current = latin;
        setStale(null);
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

  // BabBayangan Excel: cek disk tiap 8 detik — file berubah di luar Excel
  // (agent olah data nulis script hasil) → chip Tarik.
  useEffect(() => {
    const poll = window.setInterval(async () => {
      if (seenRef.current === null) return;
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(path)}`);
        if (!res.ok) return;
        const latin = new TextDecoder('latin1').decode(await res.arrayBuffer());
        if (latin !== seenRef.current) {
          seenRef.current = latin;
          if (latin !== inGridRef.current) setStale(latin);
        }
      } catch {
        // network gagal → siklus berikutnya
      }
    }, 8000);
    return () => window.clearInterval(poll);
  }, [slug, path]);

  const pullLatest = useCallback(async () => {
    await throwFile();
    setStale(null);
  }, [throwFile]);

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-muted/50">
      {/* Bar mini: identitas file + status bridge */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
        <Table2 size={13} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {path} · {t('excel.title')}
        </span>
        {!booted && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            <Loader2 size={11} className="mr-1 inline animate-spin" />
            {t('excel.loading')}
          </span>
        )}
        <a
          href="/gridcraft/index.html"
          target="_blank"
          rel="noopener noreferrer"
          title={t('excel.fullPage')}
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
          {t('excel.openBtn')}
        </Button>
      </div>

      {/* Status lempar file */}
      {thrown && !pending && (
        <p className="shrink-0 px-2 py-1 text-[11px] text-muted-foreground">{t('excel.thrown')}</p>
      )}
      {throwFailed && (
        <p className="flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] text-amber-700">
          <TriangleAlert size={11} /> {t('excel.openFailed')}
        </p>
      )}

      {/* Chip: file berubah di luar Excel (agent olah data) → tarik ke Excel */}
      {stale !== null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-blue-700/30 bg-blue-50 px-2 py-1.5 dark:bg-blue-950/40">
          <span className="min-w-0 flex-1 text-[11px] text-blue-800 dark:text-blue-200">
            {t('excel.stale')}
          </span>
          <Button variant="default" className="h-6 px-2 text-[11px]" onClick={() => void pullLatest()}>
            {t('excel.pull')}
          </Button>
          <button
            type="button"
            aria-label={t('excel.discard')}
            onClick={() => setStale(null)}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Banner simpan dari Excel */}
      {pending && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-700/30 bg-amber-50 px-2 py-1.5 dark:bg-amber-950/40">
          <span className="min-w-0 flex-1 text-[11px] text-amber-800 dark:text-amber-200">
            {nameMatches
              ? t('excel.saveAsk').replace('{name}', pending.name)
              : t('excel.saveHint').replace('{name}', pending.name)}
          </span>
          {nameMatches && (
            <>
              <Button variant="default" className="h-6 px-2 text-[11px]" disabled={saving} onClick={() => void keepSave()}>
                {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('excel.saveKeep')}
              </Button>
              {savedMsg && <span className="text-[11px] text-green-700">{t('excel.saved')}</span>}
            </>
          )}
          <button
            type="button"
            aria-label={t('excel.discard')}
            onClick={() => setPending(null)}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Kanvas GridCraft penuh; cover loader selama belum boot */}
      <iframe
        ref={frameRef}
        src="/gridcraft/index.html"
        title={t('excel.title')}
        className="h-full w-full flex-1 border-0 bg-background"
      />
      {!booted && (
        <div className="absolute inset-0 top-9 z-10 flex flex-1 items-center justify-center gap-2 bg-background text-[12px] text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('excel.loading')}
        </div>
      )}
    </div>
  );
}
