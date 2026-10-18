'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import {
  Bold,
  Italic,
  Strikethrough,
  Underline as UnderlineIcon,
  TextQuote,
  BookMarked,
  Sparkles,
} from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Ribbon, readViewPrefs, uploadProjectImage, type ViewPrefs } from './ribbon';

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 800;

/** Spasi baris pilihan user → multiplier CSS di kertas (tampilan saja). */
const SPACING_CSS: Record<string, string> = {
  '1': '1.45',
  '1.5': '1.9',
  '2': '2.35',
};

export function ThesisEditor({ slug, filePath }: { slug: string; filePath: string }) {
  const t = useT();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(filePath)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(t('err.openFile'));
          return;
        }
        setMarkdown(data.content ?? '');
      } catch {
        if (!cancelled) setLoadError(t('err.server'));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, filePath, t]);

  if (loadError) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-red-600">{loadError}</div>;
  }
  if (markdown === null) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">…</div>;
  }
  return <EditorSurface slug={slug} filePath={filePath} initialMarkdown={markdown} />;
}

function EditorSurface({
  slug,
  filePath,
  initialMarkdown,
}: {
  slug: string;
  filePath: string;
  initialMarkdown: string;
}) {
  const t = useT();
  const [status, setStatus] = useState<SaveStatus>('clean');
  const [words, setWords] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Prefs tampilan (font/ukuran/spasi) — ke server gak ikut disimpan (md = konten).
  const [prefs, setPrefsState] = useState<ViewPrefs>(() => readViewPrefs());
  const setPrefs = useCallback((p: ViewPrefs) => {
    setPrefsState(p);
    localStorage.setItem('editor:font', p.fontFamily.value);
    localStorage.setItem('editor:fontSize', String(p.fontSize));
    localStorage.setItem('editor:lineSpacing', p.lineSpacing);
  }, []);

  // Dipanggil editorProps.handlePaste / handleDrop — disetel setelah editor siap.
  const insertRef = useRef<((files: File[]) => void) | null>(null);

  const editor = useEditor({
    // Wajib utk Next.js SSR — cegah hydration mismatch (editor dirender client-side)
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Markdown.configure({ markedOptions: { gfm: true } }),
      // Override render: src relatif di .md (gambar/x.png) → URL raw API utk tampilan;
      // keluaran markdown tetap path relatif.
      createMappedImage(slug),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: t('editor.startTyping') }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: 'tiptap paper outline-none',
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        insertRef.current?.(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        insertRef.current?.(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      setStatus('dirty');
      setWords(countWords(editor));
      scheduleSave();
    },
  });

  // Handler upload + sisip gambar (dipakai paste & drag-drop).
  useEffect(() => {
    if (!editor) return;
    insertRef.current = async (files: File[]) => {
      for (const file of files) {
        const result = await uploadProjectImage(slug, file);
        if (!result.ok) setImgError(result.error === 'server' || result.error === 'upload:server' ? t('err.server') : result.error);
        if (result.ok) {
          editor.chain().focus().setImage({ src: result.path }).run();
        } else {
          setImgError(result.error);
        }
      }
    };
    return () => {
      insertRef.current = null;
    };
  }, [editor, slug, t]);

  // Agent mengubah file → refetch (hidup: file yang sama, gak lagi berhas edit)
  useEffect(() => {
    const onAgentChange = (event: Event) => {
      const detail = (event as CustomEvent<{ file?: string }>).detail;
      const changed = detail?.file ?? '';
      if (!changed) return;
      // event server biasanya path absolut; cocokkan ekornya
      if (!changed.endsWith(filePath)) return;
      if (status !== 'clean') return; // user lagi ngetik → jangan timpah
      let cancelled = false;
      const refetch = async () => {
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(filePath)}`,
          );
          const data = await res.json();
          if (cancelled || !res.ok || !editor) return;
          const md = (data.content ?? '') as string;
          const current = editor.getMarkdown();
          if (md === current) return;
          editor.commands.setContent(md, { emitUpdate: false });
          setStatus('clean');
          setWords(countWords(editor));
        } catch {
          // diamkan — autosave nanti
        }
      };
      void refetch();
      return () => {
        cancelled = true;
      };
    };
    window.addEventListener('workspace:agent-change', onAgentChange);
    return () => window.removeEventListener('workspace:agent-change', onAgentChange);
  }, [editor, slug, filePath, status]);

  const save = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const md = editor.getMarkdown();
    setStatus('saving');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePathRef.current, content: md }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setStatus('clean');
      setLastSavedAt(new Date());
    } catch {
      setStatus('error');
    }
  }, [editor, slug]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [save]);

  // ⌘S / Ctrl+S = simpan sekarang
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (timerRef.current) clearTimeout(timerRef.current);
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  useEffect(() => {
    if (editor) setWords(countWords(editor));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Ribbon editor={editor} slug={slug} prefs={prefs} setPrefs={setPrefs} />
      {imgError && (
        <p className="shrink-0 bg-red-50 px-3 py-1 text-[11px] text-red-600 dark:bg-red-950/40">
          {t('toolbar.uploadFailed')}: {imgError}
        </p>
      )}
      <SelectionBubbleMenu editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="paper-wrap mx-auto my-6 max-w-[820px] rounded-lg bg-card px-12 py-10 text-card-foreground shadow-sm ring-1 ring-border"
          style={{
            fontFamily: prefs.fontFamily.css,
            fontSize: `${prefs.fontSize}pt`,
            lineHeight: SPACING_CSS[prefs.lineSpacing] ?? '1.9',
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground">
        <span>
          {words} {t('editor.words')}
        </span>
        <SaveStatusLabel status={status} lastSavedAt={lastSavedAt} />
      </footer>
    </div>
  );
}

function SaveStatusLabel({ status, lastSavedAt }: { status: SaveStatus; lastSavedAt: Date | null }) {
  const t = useT();
  if (status === 'saving') return <span className="text-amber-600">{t('editor.saving')}</span>;
  if (status === 'error') return <span className="text-red-600">{t('editor.saveFailed')}</span>;
  if (status === 'dirty') return <span>{t('editor.unsaved')}</span>;
  return (
    <span>
      {t('editor.saved')}
      {lastSavedAt ? ` · ${lastSavedAt.toLocaleTimeString()}` : ''}
    </span>
  );
}

function countWords(editor: Editor): number {
  const text = editor.state.doc.textContent;
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Bubble menu ringan saat seleksi teks (ribbon sudah menangani sisanya). */
function SelectionBubbleMenu({ editor }: { editor: Editor }) {
  const t = useT();
  const btn = (active: boolean) => `bubble-btn ${active ? 'is-active' : ''}`;
  const disabledPhase = (hint: string) => ({ disabled: true, title: hint });

  return (
    <BubbleMenu editor={editor} className="bubble">
      <button type="button" className={btn(editor.isActive('bold'))} title={t('toolbar.bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('italic'))} title={t('toolbar.italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('underline'))} title={t('toolbar.underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('strike'))} title={t('toolbar.strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={14} />
      </button>
      <span className="bubble-sep" />
      <button type="button" className={btn(editor.isActive('blockquote'))} title="❝" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <TextQuote size={14} />
      </button>
      <span className="bubble-sep" />
      <button type="button" className="bubble-btn" {...disabledPhase(t('toolbar.citeHint'))} title={`${t('toolbar.cite')} · ${t('toolbar.citeHint')}`}>
        <BookMarked size={14} />
      </button>
      <button type="button" className="bubble-btn" {...disabledPhase(t('toolbar.askHint'))} title={`${t('toolbar.ask')} · ${t('toolbar.askHint')}`}>
        <Sparkles size={14} />
      </button>
    </BubbleMenu>
  );
}

/** Extension Image dengan mapping src → URL raw API (tampilan), .md tetap relatif. */
function createMappedImage(slug: string) {
  return Image.extend({
    renderHTML({ node, HTMLAttributes }) {
      const src: string = (HTMLAttributes.src as string) ?? (node.attrs.src as string) ?? '';
      // Path relatif workspace (gambar/xxx.png) → serve via raw API.
      if (src && !/^(https?:\/\/|data:|blob:|\/)/i.test(src)) {
        return [
          'img',
          {
            ...HTMLAttributes,
            src: `/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(src)}`,
            'data-workspace-src': src,
          },
        ];
      }
      return ['img', HTMLAttributes];
    },
  });
}
