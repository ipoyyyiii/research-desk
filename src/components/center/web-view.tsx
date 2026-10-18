'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Globe, ShieldAlert } from 'lucide-react';
import { useT } from '@/lib/preferences';

type WebViewProps = {
  url: string;
  onChangeUrl: (url: string) => void;
};

/** Tab browser embedded: hint frame-blokir, bar alamat, iframe tanpa sandbox. */
export function WebView({ url, onChangeUrl }: WebViewProps) {
  const t = useT();
  const [draft, setDraft] = useState(url);

  // Sinkronkan draft hanya saat url berubah dari luar (mis. state shell) —
  // jangan reset pas user lagi mengetik karena draft milik komponen ini.
  useEffect(() => {
    setDraft(url);
  }, [url]);

  const navigate = () => {
    const raw = draft.trim();
    if (raw.length === 0) return;
    // Tanpa skema → default https://. Fetch jalan di browser user, bukan server.
    onChangeUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Hint di bawah tab bar — pasang permanen selama tab web aktif, bukan modal. */}
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-3 py-1 text-[10px] text-muted-foreground">
        <ShieldAlert size={11} className="shrink-0" />
        <span className="truncate">{t('center.blockedHint')}</span>
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
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-card text-[12px] text-muted-foreground">
          <Globe size={16} />
          <span>{t('center.webEmpty')}</span>
        </div>
      ) : (
        // Tanpa sandbox (banyak situs rusak kalau dipaksa), no-referrer cukup.
        <iframe
          src={url || undefined}
          title="web"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-card"
        />
      )}
    </div>
  );
}
