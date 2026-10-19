'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, PenLine, TriangleAlert, Upload, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button } from '@/components/ui';
import { seedWordcraftFonts } from '@/lib/wordcraft/seed-fonts';

type SaveCandidate = { name: string; bytes: ArrayBuffer };

/**
 * Hook yang disuntik KE DALAM iframe WordCraft (same-origin). Dua tugas:
 * (1) ganti showSaveFilePicker dengan picker palsu (handle + writable stream
 *     ajaib) — simpan di Word sukses tanpa dialog, bytes dijemput saat close,
 *     lalu dikirim ke parent (app) via postMessage; (2) jemput anchor-download
 * (ekspor dari dalam Word) TANPA memblokir unduhan aslinya.
 */
const HOOK_SOURCE = `
(() => {
  if (window.__rwHooked) return;
  window.__rwHooked = true;
  const post = (name, bytes) => {
    try { parent.postMessage({ source: 'wordcraft-bridge', kind: 'save', name: name, bytes: bytes }, '*'); } catch (e) {}
  };
  // Picker palsu: pura-pura sukses simpan, bytes ditangkap lewat writable stream.
  try {
    window.showSaveFilePicker = async function (opts) {
      const name = (opts && opts.suggestedName) || 'dokumen.md';
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
  // Unduhan jangkar (mis. ekspor dari dalam Word): jemput juga, TANPA memblokir unduhan aslinya.
  const proto = HTMLAnchorElement.prototype;
  const click = proto.click;
  proto.click = function () {
    try {
      const href = this.getAttribute('href') || '';
      if (href.startsWith('blob:') && this.hasAttribute('download')) {
        const name = this.getAttribute('download') || 'dokumen.md';
        fetch(href).then((r) => r.arrayBuffer()).then((bytes) => post(name, bytes)).catch(() => {});
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
export function WordTab({
  slug,
  path,
  version,
  onOpenText,
}: {
  slug: string;
  path: string;
  version: number;
  onOpenText: (path: string) => void;
}) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [booted, setBooted] = useState(false);
  const [thrown, setThrown] = useState(false);
  const [throwFailed, setThrowFailed] = useState(false);
  const [pending, setPending] = useState<SaveCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  // Deteksi file berubah di luar Word (agen nulis): versi terakhir dijembatan vs disk.
  const inWordRef = useRef<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);

  const fileName = path.slice(path.lastIndexOf('/') + 1);

  // Gate font: tanam pack font lengkap (metric Word + Google Docs) ke
  // IndexedDB `wordcraft` SEBELUM iframe Word dibuat - WordCraft membaca
  // seluruh store saat boot, jadi langsum masuk ke daftar Font di Word.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const deadline = new Promise<void>((resolve) => window.setTimeout(resolve, 15000));
    Promise.race([seedWordcraftFonts().catch(() => undefined), deadline]).finally(() => {
      if (alive) setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

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
      // Tandai versi yang saat ini di Word + versi disk yang sudah dikonfirmasi.
      const text = new TextDecoder().decode(bytes);
      inWordRef.current = text;
      seenRef.current = text;
      setStale(null);
      setThrown(true);
      setThrowFailed(false);
    } catch {
      setThrowFailed(true);
    }
  }, [slug, path, fileName, booted]);

  // Auto-lempar: tab dibuka / file diklik lagi → begitu Word siap, file langsung dilempar.
  // version naik tiap klik file (shell) → lempar ulang; manual-throw user tetap bisa via tombol.
  const queuedThrow = useRef(true);
  useEffect(() => {
    queuedThrow.current = true;
    if (booted) {
      queuedThrow.current = false;
      void throwFile();
    }
  }, [version, booted, throwFile]);

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
        inWordRef.current = content;
        seenRef.current = content;
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

  // Hint sekali-soal "Load system fonts" (font bawaan Windows) — dismissable.
  const [sysHint, setSysHint] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('rd.wordcraft.sysHint.ack') !== '1') setSysHint(true);
    } catch {
      /* storage penuh/tidak tersedia → tampil sekali per visit */
    }
  }, []);
  const dismissHint = useCallback(() => {
    setSysHint(false);
    try {
      localStorage.setItem('rd.wordcraft.sysHint.ack', '1');
    } catch {
      /* abaikan */
    }
  }, []);

  // BabBayangan: cek disk tiap 8 detik — file berubah di luar Word (agen nulis) → chip Tarik.
  useEffect(() => {
    const poll = window.setInterval(async () => {
      if (seenRef.current === null) return; // belum pernah lempar apa-apa ke Word
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(path)}`);
        if (!res.ok) return;
        const text = new TextDecoder().decode(await res.arrayBuffer());
        if (text !== seenRef.current) {
          seenRef.current = text; // kabarin sekali, jangan spam tiap siklus
          if (text !== inWordRef.current) setStale(text);
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
            {fontsReady ? t('word.loading') : t('word.fontPack')}
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
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[11px]"
          title={t('word.textEditor')}
          onClick={() => onOpenText(path)}
        >
          <FileText size={12} className="mr-1" />
          {t('word.textEditor')}
        </Button>
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

      {/* Hint sekali: font bawaan Windows via "Load system fonts" */}
      {sysHint && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1">
          <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t('word.sysFontHint')}</span>
          <button
            type="button"
            aria-label={t('word.discard')}
            onClick={dismissHint}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Chip: file berubah di luar Word (agen nulis) → tarik ke Word */}
      {stale !== null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-blue-700/30 bg-blue-50 px-2 py-1.5 dark:bg-blue-950/40">
          <span className="min-w-0 flex-1 text-[11px] text-blue-800 dark:text-blue-200">
            {t('word.stale')}
          </span>
          <Button variant="default" className="h-6 px-2 text-[11px]" onClick={() => void pullLatest()}>
            {t('word.pull')}
          </Button>
          <button
            type="button"
            aria-label={t('word.discard')}
            onClick={() => setStale(null)}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
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

      {/* Kanvas WordCraft penuh — baru muncul setelah pack font ditanam */}
      {fontsReady && (
        <iframe
          ref={frameRef}
          src="/wordcraft/index.html"
          title={t('word.title')}
          className="h-full w-full flex-1 border-0 bg-background"
        />
      )}
      {!fontsReady && (
        <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('word.fontPack')}
        </div>
      )}
    </div>
  );
}
