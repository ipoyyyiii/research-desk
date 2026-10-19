'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, FileText, Loader2, Plus, Search, X } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Modal } from '@/components/ui';

/**
 * Pane "Basis Pengetahuan" (ss7) — tab ketiga panel agent. List file workspace
 * yang boleh dicari agent. Sumber tambah file (WCAG: drag HANYA bonus, tombol
 * selalu ada sebagai alternatif single-pointer):
 *  1. Modal picker file workspace (+ Add File di empty state & tombol bulat plus).
 *  2. Drag file-tree → dataTransfer 'application/x-rd-path' → POST path relatif.
 *  3. Drop file OS → POST /knowledge/upload (simpan ke <project>/pengetahuan/).
 */

type KnowledgeItem = { path: string; addedAt: number; exists: boolean };

type TreeEntry = { path: string; name: string; type: 'dir' | 'file'; size: number };

type Notice = { text: string; tone: 'ok' | 'err' };

/** Batas ukuran upload file OS (sama dengan kontrak server — return 413 kalau lewat). */
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

export function KnowledgePane({ slug }: { slug: string }) {
  const t = useT();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** Mutasi apa pun jalan → tombol add/remove dinonaktifkan (spinner di plus). */
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [filter, setFilter] = useState('');
  /** Overlay highlight seluruh pane saat drag hover. */
  const [dragActive, setDragActive] = useState(false);

  // Modal picker file workspace (sumber NO.1, alternatif non-drag).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerEntries, setPickerEntries] = useState<TreeEntry[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  /** Pola applyResult (extensions-panel): tarik pesan inline, jangan console spam. */
  const showFailure = useCallback(
    (serverError?: string) => setNotice({ text: serverError || t('err.server'), tone: 'err' }),
    [t],
  );

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/knowledge`);
      const data = (await res.json()) as { items?: KnowledgeItem[]; error?: string };
      setItems(res.ok ? (data.items ?? []) : []);
      if (!res.ok) showFailure(data.error);
    } catch {
      setItems([]);
      showFailure();
    } finally {
      setLoading(false);
    }
  }, [slug, showFailure]);

  useEffect(() => {
    setLoading(true);
    setFilter('');
    setNotice(null);
    void loadList();
  }, [slug, loadList]);

  /** POST daftar path (drag tree → relatif; picker → 1 file). */
  const addPaths = useCallback(
    async (paths: string[]) => {
      setBusy(true);
      setNotice(null);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        });
        const data = (await res.json()) as { items?: KnowledgeItem[]; added?: string[]; error?: string; invalid?: string[] };
        if (!res.ok) {
          setItems(data.items ?? []);
          showFailure(data.error);
          return;
        }
        setItems(data.items ?? []);
        const added = data.added ?? [];
        if (added.length > 0) {
          setNotice({ text: t('knowledge.added', { name: added.join(', ') }), tone: 'ok' });
        } else {
          // Sudah terdaftar sebelumnya → anggap netral, list di-refresh.
          const name = paths[0] ?? '';
          setNotice({ text: t('knowledge.added', { name }), tone: 'ok' });
        }
      } catch {
        showFailure();
      } finally {
        setBusy(false);
      }
    },
    [slug, t, showFailure],
  );

  /** Tambah 1 file dari modal picker (tree API sudah validasi jauh di project). */
  const addFromPicker = async (path: string) => {
    setPickerOpen(false);
    setPickerEntries(null);
    await addPaths([path]);
  };

  /** Muat daftar file workspace buat picker (semua tipe, folder dilewati). */
  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/tree`);
      const data = (await res.json()) as { tree?: TreeEntry[] };
      const files = (data.tree ?? []).filter((entry) => entry.type === 'file');
      files.sort((a, b) => a.path.localeCompare(b.path));
      setPickerEntries(res.ok ? files : null);
    } catch {
      setPickerEntries(null);
    } finally {
      setPickerLoading(false);
    }
  }, [slug]);

  /** Drop file OS → upload per file ke /knowledge/upload (server yang daftarkan row). */
  const uploadFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setNotice(null);
      const saved: string[] = [];
      let lastError: string | null = null;
      try {
        for (const file of files) {
          if (file.size > MAX_UPLOAD_SIZE) {
            lastError = `${file.name} — ${t('err.server')}`;
            continue;
          }
          try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/knowledge/upload`, {
              method: 'POST',
              body: formData,
            });
            const data = (await res.json()) as { items?: KnowledgeItem[]; name?: string; error?: string };
            if (!res.ok) {
              lastError = data.error ?? null;
              continue;
            }
            if (data.name) saved.push(data.name);
            if (data.items) setItems(data.items);
          } catch {
            // satu file gagal → lanjut sisanya (network error per file)
          }
        }
        setNotice(
          saved.length > 0
            ? { text: t('knowledge.added', { name: saved.join(', ') }), tone: 'ok' }
            : { tone: 'err', text: lastError ?? t('knowledge.invalidFile') },
        );
      } finally {
        setBusy(false);
      }
    },
    [slug, t],
  );

  /** Hapus baris pengetahuan (file disk gak disentuh). */
  const removeItem = async (item: KnowledgeItem) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/knowledge`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      const data = (await res.json()) as { items?: KnowledgeItem[]; error?: string };
      if (!res.ok) {
        showFailure(data.error);
        return;
      }
      setItems(data.items ?? []);
      setNotice({ text: t('knowledge.removed', { name: item.path }), tone: 'ok' });
    } catch {
      showFailure();
    } finally {
      setBusy(false);
    }
  };

  // ── Dropzone (seluruh pane) ─────────────────────────────────────────────────
  // Dua sumber: tree drag (application/x-rd-path) → POST langsung; file OS → upload.
  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    if (pickerOpen || busy) return;
    setDragActive(true);
  };
  const onDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    if (pickerOpen || busy) return;
    setDragActive(true);
  };
  const onDragLeave = (event: React.DragEvent) => {
    // dragleave nembak tiap masuk anak elemen — hanya clear kalau beneran keluar.
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragActive(false);
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (pickerOpen || busy) return;
    const treePath = event.dataTransfer.getData('application/x-rd-path');
    if (treePath) {
      void addPaths([treePath]);
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) void uploadFiles(files);
  };

  // Filter client: path contains (case-insensitive).
  const needle = filter.trim().toLowerCase();
  const visible = needle ? items.filter((item) => item.path.toLowerCase().includes(needle)) : items;

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col bg-background"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Overlay drop — dashed primary + label; gak nangkep pointer biar drop tetap ke pane */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-start justify-center rounded-lg border border-dashed border-primary bg-primary/5 py-3">
          <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground">
            {t('knowledge.dropNow')}
          </span>
        </div>
      )}

      {/* Header: judul + desc + baris search/plus (ss7) */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="min-w-0 text-[15px] font-semibold tracking-tight text-foreground">
            {t('knowledge.title')}
          </h2>
          {!loading && items.length > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {t('knowledge.count', { n: visible.length })}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('knowledge.desc')}</p>

        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('knowledge.searchPh')}
              aria-label={t('knowledge.searchPh')}
              className="h-9 w-full rounded-full border border-border bg-card pl-8 pr-3 text-xs text-foreground outline-none transition-colors [transition-property:color,background-color,border-color] placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={() => void openPicker()}
            disabled={busy}
            aria-label={t('knowledge.addFile')}
            title={t('knowledge.addFile')}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors [transition-property:color,background-color] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && pickerOpen ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
          </button>
        </div>
      </div>

      {/* Body: empty state / list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground" role="status" aria-label={t('knowledge.searchPh')}>
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BookOpen size={20} className="text-muted-foreground" />
            </span>
            <p className="text-[13px] font-medium text-foreground">{t('knowledge.empty')}</p>
            <p className="max-w-[232px] text-[11px] leading-snug text-muted-foreground">{t('knowledge.emptyDesc')}</p>
            <button
              type="button"
              onClick={() => void openPicker()}
              disabled={busy}
              className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors [transition-property:color,background-color] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={13} />
              {t('knowledge.addFile')}
            </button>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((item) => (
              <li
                key={item.path}
                className="group flex min-h-9 items-center gap-1.5 rounded-md px-2 transition-colors [transition-property:color,background-color,border-color] hover:bg-muted"
              >
                <FileText
                  size={13}
                  className={`shrink-0 ${item.exists ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}
                  aria-hidden={item.exists ? true : undefined}
                />
                {!item.exists && <span className="sr-only">{t('knowledge.missing')}</span>}
                <span
                  dir="ltr"
                  title={item.exists ? item.path : `${item.path} — ${t('knowledge.missing')}`}
                  className={`min-w-0 flex-1 truncate font-mono text-[11px] text-foreground ${
                    item.exists ? '' : 'opacity-60 line-through'
                  }`}
                >
                  {item.path}
                </span>
                <button
                  type="button"
                  onClick={() => void removeItem(item)}
                  disabled={busy}
                  aria-label={t('knowledge.removeAction')}
                  title={t('knowledge.removeAction')}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-colors [transition-property:color,background-color,border-color] hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-4 text-center text-[11px] text-muted-foreground">{t('knowledge.emptySearch')}</li>
            )}
          </ul>
        )}
      </div>

      {/* Pesan inline (pola applyResult) — sukses muted, gagal amber */}
      {notice && (
        <p
          className={`shrink-0 border-t border-border px-3 py-1.5 text-[10px] leading-snug ${
            notice.tone === 'err' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {/* Modal picker file workspace (alternatif non-drag — WCAG 2.2) */}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('knowledge.pickTitle')}>
        {pickerLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : pickerEntries && pickerEntries.length > 0 ? (
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {pickerEntries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => void addFromPicker(entry.path)}
                  disabled={busy}
                  title={entry.path}
                  className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors [transition-property:color,background-color,border-color] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                >
                  <FileText size={13} className="shrink-0 text-muted-foreground" />
                  <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {entry.path}
                  </span>
                  <Plus size={12} className="shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">{t('knowledge.emptySearch')}</p>
        )}
      </Modal>
    </section>
  );
}
