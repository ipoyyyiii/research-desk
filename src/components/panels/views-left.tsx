'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import { FileText, Image as ImageIcon, Loader2, Plus, Table2, type LucideIcon } from 'lucide-react';
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

// ── Empty state ss7 + util unggah (dipakai juga panel Jurnal & Perpustakaan) ──

/** Catatan kecil di EmptyState — gagal (error) atau info/sukses singkat (ok). */
export type EmptyStateNote = { text: string; tone: 'ok' | 'error' };

export type EmptyStateAction = {
  label: string;
  onClick: () => void;
  /** True → spinner (Loader2), tombol mati sementara. */
  busy?: boolean;
  /** Ikon tombol — default Plus ala ss7; aksi non-tambah pakai ikon lain. */
  icon?: LucideIcon;
};

/**
 * Empty state ss7: ikon dalam lingkaran muted + judul + deskripsi pendek +
 * tombol primary bulat. Ambil warna dari design token murni — buang hardcode.
 */
export function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
  note = null,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  action?: EmptyStateAction;
  note?: EmptyStateNote | null;
  /** Versi ringan buat strip section di dalam daftar scroll (bukan whole-pane). */
  compact?: boolean;
}) {
  const ActionIcon = action ? (action.busy ? Loader2 : (action.icon ?? Plus)) : null;
  return (
    <div
      className={
        compact
          ? 'flex flex-col items-center justify-center gap-2 px-4 py-5 text-center'
          : 'flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center'
      }
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon size={20} className="text-muted-foreground" />
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="max-w-[220px] text-[11px] leading-snug text-muted-foreground">{desc}</p>
      {note && (
        <p className={`text-[11px] ${note.tone === 'error' ? 'text-destructive' : 'text-accent'}`}>
          {note.text}
        </p>
      )}
      {action && ActionIcon && (
        <button
          type="button"
          onClick={action.busy ? undefined : action.onClick}
          disabled={action.busy}
          aria-busy={action.busy ? true : undefined}
          className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors [transition-property:color,background-color] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ActionIcon size={13} className={action.busy ? 'animate-spin' : ''} />
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Overlay drop ss7 — dashed primary + pill label; pointer dilepas biar drop kena container. */
export function DropOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-2 z-20 flex items-start justify-center rounded-lg border border-dashed border-primary bg-primary/5">
      <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground">
        {label}
      </span>
    </div>
  );
}

/** Tanggal lokal YYYY-MM-DD buat nama draf harian. */
function isoDate(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Folder target unggahan — persis kontrak backend POST …/upload-folder. */
export type FolderName = 'dokumen' | 'referensi' | 'data';

/** POST multipart { files[], folder } → path yang tersimpan; throw kalau backend nolak. */
export async function uploadToFolder(
  slug: string,
  folder: FolderName,
  files: File[],
): Promise<{ saved: string[]; skipped: string[] }> {
  const body = new FormData();
  body.append('folder', folder);
  for (const file of files) body.append('files', file);
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/upload-folder`, {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new Error('unggah ditolak backend');
  const data: unknown = await res.json();
  const readList = (key: 'saved' | 'skipped'): string[] =>
    data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key])
      ? ((data as Record<string, unknown>)[key] as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
  return { saved: readList('saved'), skipped: readList('skipped') };
}

/**
 * State unggah + dropzone sekali bilik: tombol (alternatif utama WCAG) +
 * drag file OS sebagai bonus. Dipakai view Gambar/Data & strip PDF Jurnal.
 */
export function useFolderUpload(slug: string, folder: FolderName, accept: string) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const runFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setFailed(false);
      setBusy(true);
      try {
        const { saved } = await uploadToFolder(slug, folder, files);
        if (saved.length > 0) {
          setSavedCount(saved.length);
          window.dispatchEvent(new CustomEvent('workspace:tree-refresh'));
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [slug, folder],
  );

  // Ganti project → reset catatan; daftar view ikut keisi habis refresh tree.
  useEffect(() => {
    setSavedCount(0);
    setFailed(false);
  }, [slug]);

  const pick = useCallback(() => inputRef.current?.click(), []);

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void runFiles(files);
  };

  const onDragEnter = (event: ReactDragEvent) => {
    event.preventDefault();
    if (!busy) setDragActive(true);
  };
  const onDragOver = (event: ReactDragEvent) => {
    event.preventDefault();
    if (!busy) setDragActive(true);
  };
  const onDragLeave = (event: ReactDragEvent) => {
    // dragleave nembak tiap masuk anak elemen — hanya clear kalau beneran keluar.
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragActive(false);
  };
  const onDrop = (event: ReactDragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;
    void runFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return {
    busy,
    failed,
    savedCount,
    dragActive,
    accept,
    inputRef,
    pick,
    onInputChange,
    dnd: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}

// ── View komponen ────────────────────────────────────────────────────────────
type ViewProps = {
  slug: string;
  entries: TreeEntry[];
  onOpenFile?: (path: string) => void;
};

/**
 * Draf: kartu baris, klik → editor tengah. Kosong → ss7 + tombol bikin draf
 * harian draf-YYYY-MM-DD.md di dokumen/ (nement → suffix -2, -3, dst).
 */
export function DraftsView({ slug, entries, onOpenFile }: ViewProps) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const drafts = draftFiles(entries);

  /** Buat draf harian via PUT file route; sukses → refresh tree + buka editor. */
  const createDraft = async () => {
    if (creating) return;
    setFailed(false);
    setCreating(true);
    try {
      const iso = isoDate();
      const stem = `draf-${iso}`;
      const taken = new Set(entries.map((entry) => entry.path.toLowerCase()));
      let path = `dokumen/${stem}.md`;
      for (let index = 2; taken.has(path); index += 1) path = `dokumen/${stem}-${index}.md`;
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: `# Draf ${iso}\n\n` }),
      });
      if (!res.ok) throw new Error('gagal bikin draf');
      setCreatedName(path.slice('dokumen/'.length));
      window.dispatchEvent(new CustomEvent('workspace:tree-refresh'));
      onOpenFile?.(path);
    } catch {
      setFailed(true);
    } finally {
      setCreating(false);
    }
  };

  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={t('es.draftsTitle')}
        desc={t('es.draftsDesc')}
        action={{ label: t('es.draftsAction'), onClick: () => void createDraft(), busy: creating }}
        note={
          failed
            ? { text: t('es.createFail'), tone: 'error' }
            : createdName && drafts.length === 0
              ? { text: t('es.created', { name: createdName }), tone: 'ok' }
              : null
        }
      />
    );
  }

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

/**
 * Gambar: grid thumbnail 2 kolom, klik → buka di tab baru. Kosong → ss7 +
 * unggah (tombol utama) & drag file OS sebagai bonus. Target: dokumen/.
 */
export function FiguresView({ slug, entries }: ViewProps) {
  const t = useT();
  const up = useFolderUpload(slug, 'dokumen', 'image/png,image/jpeg,image/webp,image/gif');
  const figures = figureFiles(entries);
  const note: EmptyStateNote | null = up.failed
    ? { text: t('es.uploadFail'), tone: 'error' }
    : up.savedCount > 0 && figures.length === 0
      ? { text: t('es.uploaded', { n: up.savedCount }), tone: 'ok' }
      : null;

  return (
    <section
      className="relative flex min-h-full flex-col"
      onDragEnter={up.dnd.onDragEnter}
      onDragOver={up.dnd.onDragOver}
      onDragLeave={up.dnd.onDragLeave}
      onDrop={up.dnd.onDrop}
    >
      {figures.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={t('es.figuresTitle')}
          desc={t('es.figuresDesc')}
          action={{ label: t('es.figuresAction'), onClick: up.pick, busy: up.busy }}
          note={note}
        />
      ) : (
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
      )}
      <input
        ref={up.inputRef}
        type="file"
        accept={up.accept}
        multiple
        className="hidden"
        onChange={up.onInputChange}
      />
      {up.dragActive && <DropOverlay label={t('es.drop')} />}
    </section>
  );
}

/**
 * Data: baris badge ekstensi + nama + ukuran, klik → buka di tab baru.
 * Kosong → ss7 + tombol & drag dari OS → unggah folder data/.
 */
export function DataView({ slug, entries }: ViewProps) {
  const t = useT();
  const up = useFolderUpload(slug, 'data', '.csv,.xlsx,.xls,.json');
  const data = dataFiles(entries);
  const note: EmptyStateNote | null = up.failed
    ? { text: t('es.uploadFail'), tone: 'error' }
    : up.savedCount > 0 && data.length === 0
      ? { text: t('es.uploaded', { n: up.savedCount }), tone: 'ok' }
      : null;

  return (
    <section
      className="relative flex min-h-full flex-col"
      onDragEnter={up.dnd.onDragEnter}
      onDragOver={up.dnd.onDragOver}
      onDragLeave={up.dnd.onDragLeave}
      onDrop={up.dnd.onDrop}
    >
      {data.length === 0 ? (
        <EmptyState
          icon={Table2}
          title={t('es.dataTitle')}
          desc={t('es.dataDesc')}
          action={{ label: t('es.dataAction'), onClick: up.pick, busy: up.busy }}
          note={note}
        />
      ) : (
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
      )}
      <input
        ref={up.inputRef}
        type="file"
        accept={up.accept}
        multiple
        className="hidden"
        onChange={up.onInputChange}
      />
      {up.dragActive && <DropOverlay label={t('es.drop')} />}
    </section>
  );
}
