'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Search } from 'lucide-react';
import { useT } from '@/lib/preferences';

type WebViewProps = {
  url: string;
  onChangeUrl: (url: string) => void;
};

/**
 * UA standar desktop untuk <webview> — UA default Electron ("…Electron/x.y…")
 * kadang ditolak situs tertentu (Google cek string ini).
 */
const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function useIsElectron(): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    setFlag(typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
  }, []);
  return flag;
}

export function WebView({ url, onChangeUrl }: WebViewProps) {
  const t = useT();
  const isElectron = useIsElectron();
  const [draft, setDraft] = useState(url);
  const [query, setQuery] = useState('');
  const [key, setKey] = useState(0);

  // Sinkron draft saat URL eksternal berubah (mis. tab lain navigasi);
  // draft pakai state sendiri agar pengetikan user tidak ter-reset tiap render.
  useEffect(() => {
    setDraft(url);
    setKey((v) => v + 1);
  }, [url]);

  // Navigasi pintar ala browser: ada titik → situs; tanpa titik/skema → cari DDG.
  const navigate = () => {
    const raw = draft.trim();
    if (!raw) return;
    const looksUrl = /^https?:\/\//i.test(raw) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(raw);
    if (!looksUrl) {
      runSearch(raw);
      return;
    }
    // Tanpa skema → https://. In Electron ini = true; di browser = via proxy.
    onChangeUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  };

  // DuckDuckGo lewat proxy: ringan-javascript, gak nge-bot-detect keras.
  const runSearch = (q: string) => {
    const query = q.trim();
    if (!query) return;
    onChangeUrl(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  };

  const search = () => runSearch(query);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Hint pas di bawah tab bar — selalu ada selama web tab aktif. */}
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-3 py-1 text-[10px] text-muted-foreground">
        <Globe size={11} className="shrink-0" />
        <span className="truncate">
          {isElectron ? t('center.electronHint') : t('center.proxyHint')}
        </span>
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
        // Halaman awal: kotak cari (DuckDuckGo — JS ringan, gak bot-detect keras).
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
      ) : isElectron ? (
        // Di dalam Electron: webview native — Chromium penuh, bukan iframe.
        <webview
          key={key}
          src={url}
          useragent={ELECTRON_UA}
          allowpopups
          title="web"
          className="min-h-0 flex-1 border-0 bg-card"
        />
      ) : (
        // Di browser biasa: mode PROXY-REWRITE.
        <iframe
          src={`/api/proxy?url=${encodeURIComponent(url)}`}
          title="web"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms"
          className="min-h-0 w-full flex-1 border-0 bg-card"
        />
      )}
    </div>
  );
}
