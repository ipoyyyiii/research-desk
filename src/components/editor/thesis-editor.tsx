'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  TextQuote,
  Table as TableIcon,
  BookMarked,
  Sparkles,
} from 'lucide-react';
import { useT } from '@/lib/preferences';

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 800;

export function ThesisEditor({ slug, filePath }: { slug: string; filePath: string }) {
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
          setLoadError(data.error ?? 'Gagal membuka file');
          return;
        }
        setMarkdown(data.content ?? '');
      } catch {
        if (!cancelled) setLoadError('Gagal terhubung ke server');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, filePath]);

  if (loadError) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-red-600">{loadError}</div>;
  }
  if (markdown === null) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-400">…</div>;
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ markedOptions: { gfm: true } }),
      Image,
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
    },
    onUpdate: ({ editor }) => {
      setStatus('dirty');
      setWords(countWords(editor));
      scheduleSave();
    },
  });

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
      <FixedToolbar editor={editor} />
      <SelectionBubbleMenu editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="paper-wrap mx-auto my-6 max-w-[820px] rounded-lg bg-white px-12 py-10 shadow-sm ring-1 ring-neutral-200/70 dark:bg-neutral-900 dark:ring-neutral-800">
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-neutral-200 px-4 text-[11px] text-neutral-500 dark:border-neutral-800">
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

/** Tombol toolbar dipakai di fixed bar + bubble menu. */
function ToolbarButtons({ editor }: { editor: Editor }) {
  const t = useT();
  const btn = (active: boolean) =>
    `bubble-btn ${active ? 'is-active' : ''}`;

  const disabledPhase = (hint: string) => ({ disabled: true, title: hint });

  return (
    <>
      <button type="button" className={btn(editor.isActive('bold'))} title={t('toolbar.bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('italic'))} title={t('toolbar.italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('strike'))} title={t('toolbar.strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={14} />
      </button>
      <span className="bubble-sep" />
      <button
        type="button"
        className={btn(editor.isActive('heading', { level: 2 }))}
        title={`${t('toolbar.heading')} 2`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={14} />
      </button>
      <button
        type="button"
        className={btn(editor.isActive('heading', { level: 3 }))}
        title={`${t('toolbar.heading')} 3`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={14} />
      </button>
      <span className="bubble-sep" />
      <button type="button" className={btn(editor.isActive('bulletList'))} title={t('toolbar.list')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('orderedList'))} title="1." onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} />
      </button>
      <button type="button" className={btn(editor.isActive('blockquote'))} title="❝" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <TextQuote size={14} />
      </button>
      <button
        type="button"
        className={btn(false)}
        title={t('toolbar.table')}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon size={14} />
      </button>
      <span className="bubble-sep" />
      <button type="button" className="bubble-btn" {...disabledPhase(t('toolbar.citeHint'))} title={`${t('toolbar.cite')} · ${t('toolbar.citeHint')}`}>
        <BookMarked size={14} />
      </button>
      <button type="button" className="bubble-btn" {...disabledPhase(t('toolbar.askHint'))} title={`${t('toolbar.ask')} · ${t('toolbar.askHint')}`}>
        <Sparkles size={14} />
      </button>
    </>
  );
}

function FixedToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-center border-b border-neutral-200 bg-white/60 px-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="bubble !shadow-none">
        <ToolbarButtons editor={editor} />
      </div>
    </div>
  );
}

/** Bubble menu muncul saat seleksi teks (ala Word). */
export function SelectionBubbleMenu({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu editor={editor} className="bubble">
      <ToolbarButtons editor={editor} />
    </BubbleMenu>
  );
}
