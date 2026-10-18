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
export function applyCitationMarks(editor: Editor, editorInitialScan?: true): boolean {
  if (editor.isDestroyed) return false;

  const citationType = editor.schema.marks.citation;
  if (!citationType) return false;

  const { doc, schema, tr } = editor.state;
  let changed = false;

  doc.descendants((node, pos) => {
    if (!node.isText || node.marks.some((m) => m.type === citationType)) return;

    const text = node.text ?? '';
    const re = /\[@([A-Za-z0-9_-]+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const chipNode = schema.text(match[0], [citationType.create({ key: match[1] })]);
      tr.replaceWith(from, to, chipNode);
      changed = true;
    }
  });

  if (changed) {
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  }

  void editorInitialScan;
  return changed;
}

/**
 * Satu-satunya keunikan file: TEKS yang moto `[@key]` di file serialize Tiptap
 * jadi `\[@key\]` (escaping kecil) → pandoc gak kenal. Normalizer menyelametkannya:
 * khusus pattern `\[@key\]` menjadi `[@key]` lagi sebelum ditulis ke file
 * (pattern lain gak disentuh — aman buat teks escape lain).
 */
export function normalizeCitationEscapes(markdown: string): string {
  return markdown.replace(/\\?\[@([A-Za-z0-9_-]+)\\?\]/g, (match, key: string) =>
    match.includes('\\') ? `[@${key}]` : match,
  );
}
