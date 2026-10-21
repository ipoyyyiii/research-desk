'use client';

import { Mark, mergeAttributes, type Editor } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      setCitation: (key: string) => ReturnType;
      unsetCitation: () => ReturnType;
    };
  }
}

/**
 * Mark sitasi: teks `[@key]` di dokumen dirender chip navy kecil.
 * - Markdown: mark ini "invisibel" (renderMarkdown balik children apa adanya);
 *   karakter `[@key]` hidup di teks — jadi file .md utuh buat pandoc --citeproc.
 * - File/agent menulis `[@key]` mentah → `applyCitationMarks` mengubahnya jadi
 *   chip setiap konten di-set ulang.
 */

export const CitationMark = Mark.create({
  name: 'citation',

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-citation-key'),
        renderHTML: (attributes: { key?: string | null }) => {
          if (!attributes.key) return {};
          return { 'data-citation-key': attributes.key };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-citation-key]' }];
  },

  renderHTML({ mark }: { mark: { attrs: { key?: string | null } } }) {
    return [
      'span',
      mergeAttributes({
        'data-citation-key': mark.attrs.key,
        'data-bibkey': mark.attrs.key,
        class: 'cite-chip',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCitation:
        (key: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { key }),
      unsetCitation:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  // Serializer markdown resmi @tiptap/markdown (v3): open '' + close ''
  // → hasil = konten teks apa adanya (akan di-HASIL-kan `[@key]`, lalu
  // dinormalisasi di autosave — lihat normalizeCitationEscapes).
  renderMarkdown(_node, helpers) {
    return helpers.renderChildren(_node);
  },
});

/**
 * Scan teks `[@key]` → replace dengan node teks sama panjang + CitationMark.
 * Posisi gak bergeser (panjang sama) → aman dipanggil berulang & loop.
 * Dipanggil setiap: onCreate + konten di-set ulang (loader file / agent edit).
 * Return: true kalau ada perubahan (dipakai autosave menyusul).
 */
/** Satu bracket sitasi: `[@a]`, `[@a, p. 5]`, `[@a; @b]`, `[-@a]`. */
const CITATION_RANGE = /\[[^[\]]*@[^[\]]*\]/g;
const FIRST_KEY = /-?@([A-Za-z0-9_][A-Za-z0-9_:.-]*)/;

export function applyCitationMarks(editor: Editor, editorInitialScan?: true): boolean {
  if (editor.isDestroyed) return false;

  const citationType = editor.schema.marks.citation;
  if (!citationType) return false;

  const { doc, schema, tr } = editor.state;
  type Edit = { from: number; to: number; parts: ReturnType<typeof schema.text>[] };
  const edits: Edit[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || node.marks.some((m) => m.type === citationType)) return;

    const text = node.text ?? '';
    // Bersihkan backslash sisa serializer sekaligus (chip di bawah gak di-escape).
    const cleaned = normalizeCitationEscapes(text);
    const ranges = [...cleaned.matchAll(CITATION_RANGE)];
    if (cleaned === text && ranges.length === 0) return;

    const parts: ReturnType<typeof schema.text>[] = [];
    let cursor = 0;
    for (const range of ranges) {
      const index = range.index ?? 0;
      if (index > cursor) {
        parts.push(schema.text(cleaned.slice(cursor, index), node.marks));
      }
      const key = FIRST_KEY.exec(range[0])?.[1] ?? null;
      parts.push(schema.text(range[0], [...node.marks, citationType.create({ key })]));
      cursor = index + range[0].length;
    }
    if (cursor < cleaned.length) {
      parts.push(schema.text(cleaned.slice(cursor), node.marks));
    }
    edits.push({ from: pos, to: pos + text.length, parts });
  });

  if (edits.length === 0) return false;

  // Dari belakang biar posisi edit sebelumnya gak geser.
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    tr.replaceWith(edit.from, edit.to, edit.parts);
  }
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);

  void editorInitialScan;
  return true;
}

/**
 * Tiptap markdown menulis bracket sitasi sebagai `\[@key\]`. Normalizer
 * mengembalikannya jadi `[@key]` — termasuk locator (`[@key, p. 5]`),
 * multi-cite (`[@a; @b]`), dan backslash yang sempat menumpuk dari save lama.
 * Hanya bracket yang mengandung `@` yang disentuh; teks/link lain aman.
 */
export function normalizeCitationEscapes(markdown: string): string {
  return markdown.replace(/\\*\[([^[\]]*@[^[\]]*?)\\*\]/g, (_match, inner: string) => `[${inner}]`);
}
