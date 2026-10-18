'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Search } from 'lucide-react';
import { useT } from '@/lib/preferences';

type WebViewProps = {
  url: string;
  onChangeUrl: (url: string) => void;
};

/**
 * Tab "browser" embedded — versi PROXY (bukan iframe mentah):
 * halaman di-fetch server (/api/proxy, strip CSP/X-Frame + rewrite <a>),
 * jadi situs yang menolak di-frame pun tetap tampil.
 */
export function WebView({ url, onChangeUrl }: WebViewProps) {
  const t = useT();
  const [draft, setDraft] = useState(url);
  const [query, setQuery] = useState('');

  // Sinkronkan draft hanya saat url berubah dari luar (mis. state shell) —
  // jangan reset pas user lagi mengetik karena draft milik komponen ini.
  useEffect(() => {
    setDraft(url);
  }, [url]);

  const navigate = () => {
    const raw = draft.trim();
    if (raw.length === 0) return;
    // Tanpa skema → default https://. Fetch jalan di server proxy.
    onChangeUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  };

  const search = () => {
    const q = query.trim();
    if (q.length === 0) return;
    // DuckDuckGo lewat proxy: ringan-javascript, gak nge-bot-detect keras.
    onChangeUrl(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  };

  const proxiedSrc = url ? `/api/proxy?url=${encodeURIComponent(url)}` : undefined;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Hint di bawah tab bar — pasang permanen selama tab web aktif, bukan modal. */}
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-3 py-1 text-[10px] text-muted-foreground">
        <Globe size={11} className="shrink-0" />
        <span className="truncate">{t('center.proxyHint')}</span>
      </div>

      <form
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('center.webPlaceholder')}
          aria-label={t('center.webPlaceholder')}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="shrink-0 cursor-pointer rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {t('center.webGo')}
        </button>
        <button
          type="button"
          title={t('center.openExternal')}
          aria-label={t('center.openExternal')}
          disabled={url.length === 0}
          onClick={() => window.open(url, '_blank', 'noopener')}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ExternalLink size={13} />
        </button>
      </form>

      {url === '' ? (
        // Halaman awal: kotak pencarian (lewat proxy), ala start-browser.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-card px-8">
          <Globe size={20} className="text-muted-foreground" />
          <form
            className="flex w-full max-w-sm items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
          >
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('center.searchPlaceholder')}
              aria-label={t('center.searchPlaceholder')}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[12px] text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <button
              type="submit"
              disabled={query.trim().length === 0}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <Search size={11} />
              {t('center.searchGo')}
            </button>
          </form>
          <p className="max-w-sm text-center text-[11px] text-muted-foreground">{t('center.webHint')}</p>
        </div>
      ) : (
        // Sandbox moderat: scripts+forms jalan (situs polos tetap hidup),
        // origin terisolasi dari app (gak ada allow-same-origin).
        <iframe
          src={proxiedSrc}
          title="web"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms"
          className="min-h-0 w-full flex-1 border-0 bg-card"
        />
      )}
    </div>
  );
}
