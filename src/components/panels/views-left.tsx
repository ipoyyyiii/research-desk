'use client';

import { FileText } from 'lucide-react';
import { useT } from '@/lib/preferences';

// ── Views panel kiri berbasis TUJUAN (mental model beeblio) ───────────────────
// Draf, Gambar, Data — semuanya memfilter isi tree (GET /api/projects/<slug>/tree)
// secara client-side, gak butuh API baru. Berkas gambar/data dibuka lewat route
// binary raw project (koordinator): /api/projects/<slug>/raw?path=…

/** Satu baris tree — bentuk persis respons GET /api/projects/<slug>/tree. */
export type TreeEntry = {
  path: string; // relatif dari root project, pemisah selalu '/'
  name: string;
  type: 'dir' | 'file';
  size: number;
};

/** Referensi PDF untuk section di panel Jurnal. */
export type PdfRef = {
  path: string;
  name: string;
  size: number;
};

/** URL tampilan/unduhan mentah berkas project (route binary). */
export function rawUrl(slug: string, path: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(path)}`;
}

// ── Helper murni ─────────────────────────────────────────────────────────────
const parentPathOf = (path: string): string => {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
};

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

const stripExt = (name: string, ext: string): string =>
  name.toLowerCase().endsWith(ext) ? name.slice(0, name.length - ext.length - 1) : name;

const byName = (a: TreeEntry, b: TreeEntry): number =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/** Ukuran pendek buat tampilan font-mono: "240 B" / "12 KB" / "1,3 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DRAFT_EXTS = new Set(['md']);
/** .md di root ATAU folder dokumen/ → kartu draf harian. */
export function draftFiles(entries: TreeEntry[]): TreeEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.type === 'file' &&
        DRAFT_EXTS.has(extOf(entry.name)) &&
        (parentPathOf(entry.path) === '' || parentPathOf(entry.path) === 'dokumen'),
    )
    .sort(byName);
}

const FIGURE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
/** Gambar boleh ada di folder mana pun (termasuk dokumen/). */
export function figureFiles(entries: TreeEntry[]): TreeEntry[] {
  return entries.filter((entry) => entry.type === 'file' && FIGURE_EXTS.has(extOf(entry.name)));
}

const DATA_EXTS = new Set(['csv', 'xlsx', 'xls', 'json']);
export function dataFiles(entries: TreeEntry[]): TreeEntry[] {
  return entries
    .filter((entry) => entry.type === 'file' && DATA_EXTS.has(extOf(entry.name)))
    .sort(byName);
}

/** PDF hasil unduhan jurnal — khusus folder referensi/ (dipakai panel Jurnal). */
export function referencePdfFiles(entries: TreeEntry[]): PdfRef[] {
  return entries
    .filter((entry) => entry.type === 'file' && entry.path.startsWith('referensi/') && extOf(entry.name) === 'pdf')
    .map((entry) => ({ path: entry.path, name: entry.name, size: entry.size }));
}

function EmptyState({ text }: { text: string }) {
  return <p className="px-3 py-6 text-xs leading-relaxed text-muted-foreground">{text}</p>;
}

// ── View komponen ────────────────────────────────────────────────────────────
type ViewProps = {
  slug: string;
  entries: TreeEntry[];
  onOpenFile?: (path: string) => void;
};

/** Draf: kartu baris, klik → editor tengah. */
export function DraftsView({ entries, onOpenFile }: ViewProps) {
  const t = useT();
  const drafts = draftFiles(entries);
  if (drafts.length === 0) return <EmptyState text={t('views.emptyDrafts')} />;
  return (
    <ul className="flex flex-col gap-0.5 px-1 py-2">
      {drafts.map((draft) => (
        <li key={draft.path}>
          <button
            type="button"
            onClick={() => onOpenFile?.(draft.path)}
            title={draft.path}
            className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
          >
            <FileText
              size={14}
              className="shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
            />
            <span className="min-w-0 truncate font-serif text-[13px] text-foreground">
              {stripExt(draft.name, 'md')}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {formatSize(draft.size)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Gambar: grid thumbnail 2 kolom, klik → buka di tab baru. */
export function FiguresView({ slug, entries }: ViewProps) {
  const t = useT();
  const figures = figureFiles(entries);
  if (figures.length === 0) return <EmptyState text={t('views.emptyFigures')} />;
  return (
    <ul className="grid grid-cols-2 gap-2 px-2 py-2">
      {figures.map((figure) => (
        <li key={figure.path}>
          <button
            type="button"
            onClick={() => window.open(rawUrl(slug, figure.path), '_blank', 'noopener')}
            title={t('views.openNewTab')}
            className="block w-full min-w-0 cursor-pointer text-left"
          >
            {/* File kampung via route raw — next/image tak dibutuhkan untuk daftar lokal ini */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={rawUrl(slug, figure.path)}
              alt={figure.name}
              loading="lazy"
              className="aspect-square w-full rounded-lg border border-border bg-card object-cover"
            />
            <span className="mt-1 block truncate text-[10px] text-muted-foreground">{figure.name}</span>
            <span className="block font-mono text-[10px] text-muted-foreground">{formatSize(figure.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Data: baris badge ekstensi + nama + ukuran, klik → buka di tab baru. */
export function DataView({ slug, entries }: ViewProps) {
  const t = useT();
  const data = dataFiles(entries);
  if (data.length === 0) return <EmptyState text={t('views.emptyData')} />;
  return (
    <ul className="flex flex-col gap-0.5 px-1 py-2">
      {data.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            onClick={() => window.open(rawUrl(slug, file.path), '_blank', 'noopener')}
            title={t('views.openNewTab')}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
          >
            <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-mono uppercase text-muted-foreground">
              {extOf(file.name)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{file.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
