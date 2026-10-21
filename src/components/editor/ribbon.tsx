'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  BookMarked,
  Bold,
  Download,
  ImagePlus,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  Minus,
  Outdent,
  Redo2,
  ScanSearch,
  Search,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button, Modal, TextInput } from '@/components/ui';
import type { BibEntry } from '@/lib/journals/bib';
import type { JournalCard } from '@/lib/journals/types';
import { applyCitationMarks, normalizeCitationEscapes } from '@/components/editor/citation-mark';
import { applyQualityFixes, scanQuality, type QualityIssue } from '@/lib/document-quality';

// ── View prefs (tampilan editor saja — file .md gak ikut nyimpennya) ─────────
const FONT_FAMILIES = [
  { value: 'times', label: 'Times New Roman', css: '"Times New Roman", ui-serif, Georgia, serif' },
  { value: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { value: 'calibri', label: 'Calibri', css: 'Calibri, Candara, Segoe UI, sans-serif' },
];
const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 24];
const LINE_SPACINGS = [
  { value: '1', label: '1,0' },
  { value: '1.5', label: '1,5' },
  { value: '2', label: '2,0' },
];

export function readViewPrefs() {
  if (typeof window === 'undefined') {
    return { fontFamily: FONT_FAMILIES[0], fontSize: 12, lineSpacing: '1.5' };
  }
  const family = FONT_FAMILIES.find((f) => f.value === localStorage.getItem('editor:font')) ?? FONT_FAMILIES[0];
  const size = Number(localStorage.getItem('editor:fontSize')) || 12;
  const spacing = LINE_SPACINGS.find((s) => s.value === localStorage.getItem('editor:lineSpacing'))?.value ?? '1.5';
  return { fontFamily: family, fontSize: size, lineSpacing: spacing };
}

export type ViewPrefs = ReturnType<typeof readViewPrefs>;

/** Upload gambar ke folder gambar/ project; balikin path relatif. */
export async function uploadProjectImage(slug: string, file: File): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? 'upload:server' };
    return { ok: true, path: data.document.path };
  } catch {
    return { ok: false, error: 'server' };
  }
}

// ── Komponen kecil ───────────────────────────────────────────────────────────

function TBtn({
  editor,
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  editor: Editor;
  title: string;
  active?: (ed: Editor) => boolean;
  disabled?: (ed: Editor) => boolean;
  onClick: (ed: Editor) => void;
  children: React.ReactNode;
}) {
  const isActive = active?.(editor) ?? false;
  const isDisabled = disabled?.(editor) ?? false;
  return (
    <button
      type="button"
      disabled={isDisabled}
      title={title}
      onClick={() => onClick(editor)}
      className={`inline-flex h-7 w-7 items-center justify-center rounded text-foreground transition-colors hover:bg-muted disabled:opacity-35 ${
        isActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300' : ''
      }`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" />;

const selectClass =
  'h-7 rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none transition-colors';

// ── Ribbon utama (bar ala-Word/GDocs) ────────────────────────────────────────

export function Ribbon({
  editor,
  slug,
  filePath,
  prefs,
  setPrefs,
}: {
  editor: Editor;
  slug: string;
  filePath: string;
  prefs: ViewPrefs;
  setPrefs: (p: ViewPrefs) => void;
}) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Kualitas draf: scan + auto-bersih sampah tulisan (fase 6) ────────────
  const [qualityOpen, setQualityOpen] = useState(false);
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[] | null>(null);
  const [qualityFixed, setQualityFixed] = useState<number | null>(null);

  const openQuality = () => {
    setQualityFixed(null);
    setQualityIssues(scanQuality(normalizeCitationEscapes(editor.getMarkdown())));
    setQualityOpen(true);
  };

  const runQualityFix = () => {
    const md = normalizeCitationEscapes(editor.getMarkdown());
    const result = applyQualityFixes(md);
    setQualityFixed(result.fixed);
    if (result.fixed === 0) return;
    // emitUpdate:true → autosave + hitung kata di thesis-editor jalan sendiri.
    editor.commands.setContent(result.md, { emitUpdate: true });
    // Chip sitasi ditandai ulang — parser setContent gak kenal mark custom.
    applyCitationMarks(editor);
    setQualityIssues(scanQuality(result.md));
  };

  // ── Sitasi (fase 4): local bib + OpenAlex simpan&cite ────────────────────
  const [citeOpen, setCiteOpen] = useState(false);
  const [citeQuery, setCiteQuery] = useState('');
  const [localRefs, setLocalRefs] = useState<BibEntry[]>([]);
  const [oaResults, setOaResults] = useState<JournalCard[]>([]);
  const [citeSavingId, setCiteSavingId] = useState<string | null>(null);
  const [citeError, setCiteError] = useState<string | null>(null);

  const localKeys = new Set(localRefs.map((r) => r.key));

  const openCite = async () => {
    setCiteOpen((prev) => !prev);
    setCiteError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/bib`);
      const data = await res.json();
      if (res.ok) setLocalRefs(data.entries ?? []);
    } catch {
      // kosongkan — popover tetap bisa jalan buat OpenAlex
    }
  };

  const insertCite = (key: string) => {
    editor.chain().focus().insertContent(`[@${key}]`).run();
    applyCitationMarks(editor);
    setCiteOpen(false);
    setCiteQuery('');
    setOaResults([]);
  };

  const saveAndCite = async (paper: JournalCard) => {
    setCiteSavingId(paper.id);
    setCiteError(null);
    try {
      const res = await fetch('/api/journals/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, paper }),
      });
      const data = await res.json();
      if (!res.ok || !data?.bibKey) {
        setCiteError(t('err.citeSave'));
        return;
      }
      insertCite(data.bibKey);
    } catch {
      setCiteError(t('err.server'));
    } finally {
      setCiteSavingId(null);
    }
  };

  // OpenAlex suggestions — debounce 400ms, min 3 huruf, buang yang udah tersimpan.
  useEffect(() => {
    const query = citeQuery.trim();
    if (!citeOpen || query.length < 3) {
      setOaResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/journals/search?q=${encodeURIComponent(query)}&limit=6`);
        const data = await res.json();
        setOaResults(res.ok ? ((data.results ?? []) as JournalCard[]) : []);
      } catch {
        setOaResults([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [citeQuery, citeOpen]);

  // ── Ekspor DOCX (pandoc + citeproc) ───────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportSources, setExportSources] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportWarnings, setExportWarnings] = useState<{
    missingCitations: string[];
    unusedEntries: number;
  } | null>(null);
  const [exportConfirm, setExportConfirm] = useState<{
    style: 'apa' | 'ieee';
    out: 'docx' | 'pdf';
    missing: string[];
    unused: number;
    hasBib: boolean;
  } | null>(null);
  const [sourcesBusy, setSourcesBusy] = useState(false);

  // Cek konsistensi sitasi ↔ pustaka (semua file .md project).
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkData, setCheckData] = useState<{
    hasBib: boolean;
    bibTotal: number;
    docsScanned: number;
    files: Array<{ path: string; citations: number; missing: string[] }>;
    missing: string[];
    unused: string[];
  } | null>(null);

  const runExport = async (style: 'apa' | 'ieee', out: 'docx' | 'pdf' = 'docx') => {
    setExportBusy(true);
    setExportError(null);
    setExportResult(null);
    setExportSources(null);
    setExportWarnings(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, style, out }),
      });
      const data = await res.json();
      if (res.ok && data?.out) {
        setExportResult(data.out);
        setExportSources(Number.isFinite(Number(data?.sources)) ? Number(data.sources) : 0);
        if (data?.warnings) {
          setExportWarnings({
            missingCitations: Array.isArray(data.warnings.missingCitations)
              ? data.warnings.missingCitations
              : [],
            unusedEntries: Number(data.warnings.unusedEntries ?? 0),
          });
        }
      } else {
        setExportError(t('err.export'));
      }
    } catch {
      setExportError(t('err.server'));
    } finally {
      setExportBusy(false);
    }
  };

  // Preflight dulu: key sitasi yang tidak ada di references.bib bikin pandoc
  // menulis "(key?)" diam-diam. Kalau ada yang hilang, minta konfirmasi.
  const doExport = async (style: 'apa' | 'ieee', out: 'docx' | 'pdf' = 'docx') => {
    setExportOpen(false);
    setExportBusy(true);
    setExportError(null);
    setExportResult(null);
    setExportSources(null);
    setExportWarnings(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, style, out, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExportError(t('err.export'));
        return;
      }
      const missing = Array.isArray(data?.warnings?.missingCitations)
        ? (data.warnings.missingCitations as string[])
        : [];
      if (missing.length > 0) {
        setExportConfirm({
          style,
          out,
          missing,
          unused: Number(data?.warnings?.unusedEntries ?? 0),
          hasBib: Boolean(data?.hasBib),
        });
        return;
      }
      await runExport(style, out);
    } catch {
      setExportError(t('err.server'));
    } finally {
      setExportBusy(false);
    }
  };

  const confirmExport = () => {
    if (!exportConfirm) return;
    const job = exportConfirm;
    setExportConfirm(null);
    void runExport(job.style, job.out);
  };

  /** Unduh sources.xml (impor ke Word: References > Manage Sources > Browse). */
  const downloadSources = async () => {
    setExportOpen(false);
    setSourcesBusy(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/bib/sources`);
      if (!res.ok) {
        setExportError(t('err.sourcesNoBib'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sources.xml';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setExportError(t('err.server'));
    } finally {
      setSourcesBusy(false);
    }
  };

  const openCitationCheck = async () => {
    setExportOpen(false);
    setCheckOpen(true);
    setCheckBusy(true);
    setCheckError(null);
    setCheckData(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/citations/check`);
      const data = await res.json();
      if (!res.ok) {
        setCheckError(t('err.citeCheck'));
        return;
      }
      setCheckData(data);
    } catch {
      setCheckError(t('err.server'));
    } finally {
      setCheckBusy(false);
    }
  };

  const uploadAndInsert = async (file: File) => {
    setUploadError(null);
    const result = await uploadProjectImage(slug, file);
    if (result.ok) {
      editor.chain().focus().setImage({ src: result.path }).run();
    } else {
      setUploadError(result.error);
    }
  };

  const inTable = editor.isActive('table');
  const selStyle = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p';

  return (
    <div className="relative border-b border-border bg-card px-2 py-1">
      <div className="flex flex-wrap items-center gap-0.5">
        {/* Undo/Redo */}
        <TBtn editor={editor} title={t('toolbar.undo')} disabled={(ed) => !ed.can().undo()} onClick={(ed) => ed.chain().focus().undo().run()}>
          <Undo2 size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.redo')} disabled={(ed) => !ed.can().redo()} onClick={(ed) => ed.chain().focus().redo().run()}>
          <Redo2 size={15} />
        </TBtn>
        <Sep />

        {/* Style paragraf */}
        <select
          className={`${selectClass} pr-6`}
          value={selStyle}
          onChange={(event) => {
            const value = event.target.value;
            const chain = editor.chain().focus();
            if (value === 'p') chain.setParagraph().run();
            else if (value === 'h1') chain.toggleHeading({ level: 1 }).run();
            else if (value === 'h2') chain.toggleHeading({ level: 2 }).run();
            else if (value === 'h3') chain.toggleHeading({ level: 3 }).run();
          }}
          title={t('toolbar.heading')}
        >
          <option value="p">{t('toolbar.styleParagraph')}</option>
          <option value="h1">{t('toolbar.styleH1')}</option>
          <option value="h2">{t('toolbar.styleH2')}</option>
          <option value="h3">{t('toolbar.styleH3')}</option>
        </select>

        {/* Font family + size + line spacing (view-only) */}
        <select
          className={selectClass}
          value={prefs.fontFamily.value}
          onChange={(event) =>
            setPrefs({
              ...prefs,
              fontFamily: FONT_FAMILIES.find((f) => f.value === event.target.value) ?? FONT_FAMILIES[0],
            })
          }
          title={t('toolbar.fontFamily')}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={prefs.fontSize}
          onChange={(event) => setPrefs({ ...prefs, fontSize: Number(event.target.value) })}
          title={t('toolbar.fontSize')}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} pt
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={prefs.lineSpacing}
          onChange={(event) => setPrefs({ ...prefs, lineSpacing: event.target.value })}
          title={t('toolbar.lineSpacing')}
        >
          {LINE_SPACINGS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Sep />

        {/* Text styles */}
        <TBtn editor={editor} title={t('toolbar.bold')} active={(ed) => ed.isActive('bold')} onClick={(ed) => ed.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.italic')} active={(ed) => ed.isActive('italic')} onClick={(ed) => ed.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.underline')} active={(ed) => ed.isActive('underline')} onClick={(ed) => ed.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.strike')} active={(ed) => ed.isActive('strike')} onClick={(ed) => ed.chain().focus().toggleStrike().run()}>
          <Strikethrough size={15} />
        </TBtn>
        <Sep />

        {/* Align */}
        <TBtn editor={editor} title={t('toolbar.alignLeft')} active={(ed) => ed.isActive({ textAlign: 'left' })} onClick={(ed) => ed.chain().focus().setTextAlign('left').run()}>
          <AlignLeft size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.alignCenter')} active={(ed) => ed.isActive({ textAlign: 'center' })} onClick={(ed) => ed.chain().focus().setTextAlign('center').run()}>
          <AlignCenter size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.alignRight')} active={(ed) => ed.isActive({ textAlign: 'right' })} onClick={(ed) => ed.chain().focus().setTextAlign('right').run()}>
          <AlignRight size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.alignJustify')} active={(ed) => ed.isActive({ textAlign: 'justify' })} onClick={(ed) => ed.chain().focus().setTextAlign('justify').run()}>
          <AlignJustify size={15} />
        </TBtn>
        <Sep />

        {/* Lists + indent */}
        <TBtn editor={editor} title={t('toolbar.list')} active={(ed) => ed.isActive('bulletList')} onClick={(ed) => ed.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.orderedList')} active={(ed) => ed.isActive('orderedList')} onClick={(ed) => ed.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.taskList')} active={(ed) => ed.isActive('taskList')} onClick={(ed) => ed.chain().focus().toggleTaskList().run()}>
          <ListTodo size={15} />
        </TBtn>
        <TBtn editor={editor} title="⇤" disabled={(ed) => !ed.can().liftListItem('listItem')} onClick={(ed) => ed.chain().focus().liftListItem('listItem').run()}>
          <Outdent size={15} />
        </TBtn>
        <TBtn editor={editor} title="⇥" disabled={(ed) => !ed.can().sinkListItem('listItem')} onClick={(ed) => ed.chain().focus().sinkListItem('listItem').run()}>
          <Indent size={15} />
        </TBtn>
        <Sep />

        {/* Insert: tabel / link / gambar / hr */}
        <div className="relative">
          <TBtn editor={editor} title={t('toolbar.table')} active={() => tableMenuOpen} onClick={() => setTableMenuOpen((v) => !v)}>
            <TableIcon size={15} />
          </TBtn>
          {tableMenuOpen && (
            <div className="absolute left-0 top-8 z-40 w-44 rounded-md border border-border bg-card p-1 text-xs shadow-lg">
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => {
                  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                  setTableMenuOpen(false);
                }}
              >
                ＋ {t('toolbar.tableInsert')}
              </button>
              <div className="my-1 h-px bg-border" />
              {[
                { label: t('toolbar.rowAbove'), run: 'addRowBefore' as const, disabled: !inTable },
                { label: t('toolbar.rowBelow'), run: 'addRowAfter' as const, disabled: !inTable },
                { label: t('toolbar.colLeft'), run: 'addColumnBefore' as const, disabled: !inTable },
                { label: t('toolbar.colRight'), run: 'addColumnAfter' as const, disabled: !inTable },
                { label: t('toolbar.delRow'), run: 'deleteRow' as const, disabled: !inTable },
                { label: t('toolbar.delCol'), run: 'deleteColumn' as const, disabled: !inTable },
                { label: t('toolbar.delTable'), run: 'deleteTable' as const, disabled: !inTable },
              ].map((item) => (
                <button
                  key={item.run}
                  type="button"
                  disabled={item.disabled}
                  className="w-full rounded px-2 py-1 text-left transition-colors hover:bg-muted disabled:opacity-35"
                  onClick={() => {
                    editor.chain().focus()[item.run]().run();
                    setTableMenuOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* ── Sitasi: chip `[@key]` (bib lokal + OpenAlex simpan-cite) ── */}
        <div className="relative">
          <TBtn editor={editor} title={t('toolbar.cite')} active={() => citeOpen} onClick={() => void openCite()}>
            <BookMarked size={15} />
          </TBtn>
          {citeOpen && (
            <div className="absolute left-0 top-8 z-40 w-80 rounded-md border border-border bg-card p-2 text-xs shadow-lg">
              <div className="flex items-center gap-1.5">
                <Search size={12} className="shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  value={citeQuery}
                  onChange={(event) => setCiteQuery(event.target.value)}
                  placeholder={t('toolbar.citeSearch')}
                  className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
              <div className="mt-1 max-h-64 overflow-y-auto">
                {localRefs
                  .filter((r) =>
                    citeQuery.trim().length === 0 ||
                    `${r.key} ${r.title} ${r.authors.join(' ')}`.toLowerCase().includes(citeQuery.trim().toLowerCase()),
                  )
                  .slice(0, 12)
                  .map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      title={`${r.title}${r.year ? ` (${r.year})` : ''}`}
                      onClick={() => insertCite(r.key)}
                      className="block w-full cursor-pointer truncate rounded px-1.5 py-1 text-left transition-colors hover:bg-muted"
                    >
                      <span className="font-mono text-[10px] text-primary">[@{r.key}]</span>
                      <span className="ml-1 text-muted-foreground">{r.title || '—'}</span>
                    </button>
                  ))}

                <div className="mx-1 my-1 h-px bg-border" />
                {citeError && <p className="px-1.5 py-1 text-[10px] text-red-600">{citeError}</p>}
                {oaResults.length === 0 && (
                  <p className="px-1.5 py-1 text-[10px] text-muted-foreground">{t('toolbar.citeEmpty')}</p>
                )}
                {oaResults
                  .filter((p) => !localKeys.has(String(p.id)))
                  .slice(0, 6)
                  .map((paper) => (
                    <button
                      key={paper.id}
                      type="button"
                      disabled={citeSavingId === paper.id}
                      title={t('toolbar.citeSaveAndCite')}
                      onClick={() => void saveAndCite(paper)}
                      className="flex w-full cursor-pointer items-center gap-1 truncate rounded px-1.5 py-1 text-left transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {citeSavingId === paper.id ? (
                        <Loader2 size={11} className="shrink-0 animate-spin text-primary" />
                      ) : (
                        <BookMarked size={11} className="shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{paper.title}</span>
                      {paper.year != null && <span className="shrink-0 text-muted-foreground">· {paper.year}</span>}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        <TBtn editor={editor} title={t('toolbar.link')} onClick={() => setLinkOpen(true)}>
          <Link2 size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.image')} onClick={() => fileInputRef.current?.click()}>
          <ImagePlus size={15} />
        </TBtn>
        <TBtn editor={editor} title={t('toolbar.hr')} onClick={(ed) => ed.chain().focus().setHorizontalRule().run()}>
          <Minus size={15} />
        </TBtn>
        <Sep />
        <TBtn editor={editor} title={t('toolbar.clear')} onClick={(ed) => ed.chain().focus().clearNodes().unsetAllMarks().run()}>
          <Trash2 size={15} />
        </TBtn>
        <Sep />

        {/* ── Kualitas draf: scan + auto-bersih sampah tulisan ─── */}
        <TBtn editor={editor} title={t('quality.title')} onClick={() => openQuality()}>
          <ScanSearch size={15} />
        </TBtn>
        <Sep />

        {/* ── Ekspor Word (.docx): pandoc + citeproc, pilih gaya ─── */}
        <div className="relative">
          <TBtn
            editor={editor}
            title={t('toolbar.exportLabel')}
            active={() => exportOpen}
            disabled={() => exportBusy}
            onClick={() => setExportOpen((v) => !v)}
          >
            {exportBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          </TBtn>
          {exportOpen && (
            <div className="absolute right-0 top-8 z-40 w-40 rounded-md border border-border bg-card p-1 text-xs shadow-lg">
              <button
                type="button"
                className="w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => void doExport('apa')}
              >
                .docx — {t('toolbar.exportApa')}
              </button>
              <button
                type="button"
                className="w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => void doExport('ieee')}
              >
                .docx — {t('toolbar.exportIeee')}
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => void doExport('apa', 'pdf')}
              >
                .pdf — {t('toolbar.exportApa')}
              </button>
              <button
                type="button"
                className="w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => void doExport('ieee', 'pdf')}
              >
                .pdf — {t('toolbar.exportIeee')}
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                disabled={sourcesBusy}
                className="w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void downloadSources()}
              >
                sources.xml — {t('toolbar.exportSources')}
              </button>
              <button
                type="button"
                className="w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => void openCitationCheck()}
              >
                {t('toolbar.exportCheck')}
              </button>
            </div>
          )}
        </div>
      </div>

      {exportBusy && <p className="px-1 pb-1 text-[11px] text-muted-foreground">{t('toolbar.exportBusy')}</p>}
      {exportResult && (
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">
          <a
            href={`/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(exportResult)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {exportResult}
          </a>{' '}
          — {t('toolbar.exportDone')}
          {exportSources ? ` · ${t('toolbar.exportSourcesInDoc', { n: exportSources })}` : ''}
        </p>
      )}
      {exportWarnings && exportWarnings.missingCitations.length > 0 && (
        <p className="px-1 pb-1 text-[11px] text-red-600">
          {t('toolbar.exportMissing', {
            keys: exportWarnings.missingCitations.slice(0, 6).join(', '),
          })}
          {exportWarnings.missingCitations.length > 6 ? '…' : ''}
        </p>
      )}
      {exportWarnings && exportWarnings.unusedEntries > 0 && (
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">
          {t('toolbar.exportUnused', { n: exportWarnings.unusedEntries })}
        </p>
      )}
      {exportError && <p className="px-1 pb-1 text-[11px] text-red-600">{exportError}</p>}

      {/* Konfirmasi sebelum ekspor kalau ada key sitasi yang tidak ada di pustaka. */}
      <Modal
        open={exportConfirm !== null}
        onClose={() => setExportConfirm(null)}
        title={t('toolbar.exportConfirmTitle')}
      >
        {exportConfirm && (
          <div className="space-y-3 text-xs">
            {!exportConfirm.hasBib && (
              <p className="text-red-600">{t('toolbar.exportConfirmNoBib')}</p>
            )}
            <p className="text-muted-foreground">
              {t('toolbar.exportConfirmBody', {
                n: exportConfirm.missing.length,
                keys: exportConfirm.missing.slice(0, 6).join(', '),
              })}
              {exportConfirm.missing.length > 6 ? '…' : ''}
            </p>
            {exportConfirm.unused > 0 && (
              <p className="text-muted-foreground">
                {t('toolbar.exportConfirmUnused', { n: exportConfirm.unused })}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExportConfirm(null)}>
                {t('toolbar.exportConfirmCancel')}
              </Button>
              <Button onClick={confirmExport}>{t('toolbar.exportConfirmGo')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cek konsistensi sitasi ↔ pustaka (semua file .md project). */}
      <Modal open={checkOpen} onClose={() => setCheckOpen(false)} title={t('citeCheck.title')}>
        <div className="space-y-3 text-xs">
          {checkBusy && <p className="text-muted-foreground">{t('citeCheck.busy')}</p>}
          {checkError && <p className="text-red-600">{checkError}</p>}
          {!checkBusy && !checkError && checkData && (
            <>
              <p className="text-muted-foreground">
                {t('citeCheck.summary', {
                  docs: checkData.docsScanned,
                  bib: checkData.bibTotal,
                  files: checkData.files.length,
                })}
              </p>
              {!checkData.hasBib && (
                <p className="text-muted-foreground">{t('citeCheck.noBib')}</p>
              )}
              {checkData.hasBib && checkData.missing.length === 0 && (
                <p className="font-medium text-green-700">{t('citeCheck.noMissing')}</p>
              )}
              {checkData.missing.length > 0 && (
                <div>
                  <p className="mb-1 font-medium text-red-600">
                    {t('citeCheck.missingTitle')} ({checkData.missing.length})
                  </p>
                  <ul className="max-h-32 overflow-y-auto rounded border border-border bg-muted/40 p-2 font-mono text-[11px]">
                    {checkData.missing.map((key) => (
                      <li key={key}>{key}</li>
                    ))}
                  </ul>
                  {checkData.files.filter((file) => file.missing.length > 0).length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {checkData.files
                        .filter((file) => file.missing.length > 0)
                        .map((file) => (
                          <li key={file.path}>
                            {file.path}: {file.missing.join(', ')}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
              {checkData.hasBib && (
                <div>
                  <p className="mb-1 font-medium">
                    {t('citeCheck.unusedTitle')} ({checkData.unused.length})
                  </p>
                  {checkData.unused.length === 0 ? (
                    <p className="text-muted-foreground">{t('citeCheck.noUnused')}</p>
                  ) : (
                    <ul className="max-h-32 overflow-y-auto rounded border border-border bg-muted/40 p-2 font-mono text-[11px]">
                      {checkData.unused.map((key) => (
                        <li key={key}>{key}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {uploadError && <p className="px-1 pb-1 text-[11px] text-red-600">{t('toolbar.uploadFailed')}: {uploadError}</p>}

      {/* Dialog kualitas draf — scan + perbaikan otomatis */}
      <Modal open={qualityOpen} onClose={() => setQualityOpen(false)} title={t('quality.title')}>
        <div className="space-y-3">
          {qualityFixed !== null && (
            <p className="text-xs font-medium text-green-700">{t('quality.fixed').replace('{n}', String(qualityFixed))}</p>
          )}
          {qualityIssues === null || qualityIssues.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t('quality.noIssues')}</p>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">
                {t('quality.autoCount').replace('{n}', String(qualityIssues.filter((item) => item.fixable).length))}
                {' · '}
                {t('quality.manualCount').replace('{n}', String(qualityIssues.filter((item) => !item.fixable).length))}
              </p>
              <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                {qualityIssues.map((issue, index) => (
                  <li
                    key={`${issue.rule}-${index}`}
                    className="flex items-center gap-2 rounded-sm border-l-2 py-0.5 pl-2 text-[11px]"
                    style={{ borderColor: issue.fixable ? 'var(--accent)' : '#dc2626' }}
                  >
                    <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      {t(`quality.rule.${issue.rule}`)}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">:{issue.line}</span>
                    <span className="min-w-0 truncate text-foreground">{issue.snippet}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setQualityOpen(false)}>
                  {t('quality.close')}
                </Button>
                <Button onClick={runQualityFix}>{t('quality.autofix')}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Input file gambar */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadAndInsert(file);
          event.target.value = '';
        }}
      />

      {/* Dialog tautan */}
      {linkOpen && <LinkModal editor={editor} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

/** Modal tautan — di-mount ulang tiap kali dibuka agar nilai awal segar. */
function LinkModal({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState(() => editor.getAttributes('link').href ?? '');

  const apply = () => {
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url.trim() || '#' })
      .run();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={t('toolbar.link')}>
      <div className="space-y-4">
        <TextInput
          autoFocus
          placeholder={t('toolbar.linkPlaceholder')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              onClose();
            }}
          >
            {t('toolbar.unset')}
          </Button>
          <Button onClick={apply}>{t('toolbar.apply')}</Button>
        </div>
      </div>
    </Modal>
  );
}
