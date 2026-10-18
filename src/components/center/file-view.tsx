'use client';

import { ExternalLink } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { isPdfPath } from '@/lib/paths';

type FileViewProps = {
  slug: string;
  path: string;
};

function rawUrl(slug: string, path: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(path)}`;
}

/**
 * Preview berkas biner di tab tengah: PDF via iframe (viewer bawaan browser,
 * udah ada zoom/print), gambar via <img> center. Sumber: route /raw (binary
 * inline, aman traversal — sudah diuji fase 3.5b).
 */
export function FileView({ slug, path }: FileViewProps) {
  const t = useT();
  const url = rawUrl(slug, path);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border bg-card px-2">
        <button
          type="button"
          onClick={() => window.open(url, '_blank', 'noopener')}
          title={t('views.openNewTab')}
          aria-label={t('views.openNewTab')}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink size={12} />
          ↗
        </button>
      </div>

      {isPdfPath(path) ? (
        <iframe src={url} title={path} className="min-h-0 w-full flex-1 bg-muted" />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- daftar lokal route /raw */}
          <img
            src={url}
            alt={path}
            draggable={false}
            className="max-h-full max-w-full rounded-lg bg-card object-contain shadow-md"
          />
        </div>
      )}
    </div>
  );
}
