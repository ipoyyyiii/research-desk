import JSZip from 'jszip';

/**
 * Ekstraksi anotasi dari file .docx: komentar pembimbing dan track changes.
 *
 * Word menyimpan komentar di `word/comments.xml` (isi + penulis + tanggal) dan
 * menandai teks yang dikomentari di `word/document.xml` dengan pasangan
 * `commentRangeStart` / `commentRangeEnd`. Perubahan yang dilacak ada di
 * elemen `w:ins` (penambahan) dan `w:del` (penghapusan).
 *
 * Tidak pakai parser XML baru — cukup tokenizer posisi supaya teks yang
 * dikomentari bisa diambil persis (dan biar gak nambah dependency).
 */

export type DocxComment = {
  id: string;
  author: string;
  date: string | null;
  /** Isi komentar. */
  text: string;
  /** Teks dokumen yang dikomentari (kalau rentangnya ketemu). */
  quote: string | null;
};

export type DocxTrackChange = {
  kind: 'insert' | 'delete';
  author: string;
  date: string | null;
  text: string;
};

export type DocxAnnotations = {
  comments: DocxComment[];
  trackChanges: DocxTrackChange[];
};

const MAX_QUOTE = 500;
const MAX_ITEMS = 400;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function attr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : '';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

type TextRun = { at: number; text: string };
type Range = { start: number; end: number };

/** Semua `w:t` / `w:delText` beserta posisinya di XML. */
function collectRuns(xml: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /<w:(t|delText)\b[^>]*>([\s\S]*?)<\/w:\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const text = decodeXml(match[2]);
    if (text) runs.push({ at: match.index, text });
  }
  return runs;
}

/** Rentang teks yang dikomentari, per id komentar. */
function collectCommentRanges(xml: string): Map<string, Range> {
  const starts = new Map<string, number>();
  const ranges = new Map<string, Range>();
  const pattern = /<w:commentRange(Start|End)\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const id = attr(match[2], 'w:id');
    if (!id) continue;
    if (match[1] === 'Start') {
      starts.set(id, match.index);
    } else {
      const start = starts.get(id);
      if (start !== undefined) {
        ranges.set(id, { start, end: match.index });
        starts.delete(id);
      }
    }
  }
  return ranges;
}

function textBetween(runs: TextRun[], range: Range): string {
  return normalize(
    runs
      .filter((run) => run.at > range.start && run.at < range.end)
      .map((run) => run.text)
      .join(' '),
  ).slice(0, MAX_QUOTE);
}

/**
 * Baca komentar + track changes dari byte .docx.
 * Melempar error kalau file bukan DOCX / zip rusak.
 */
export async function extractDocxAnnotations(bytes: Buffer): Promise<DocxAnnotations> {
  const zip = await JSZip.loadAsync(bytes);

  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Bukan file .docx yang valid');
  const documentXml = await documentFile.async('string');
  const runs = collectRuns(documentXml);
  const ranges = collectCommentRanges(documentXml);

  const comments: DocxComment[] = [];
  const commentsFile = zip.file('word/comments.xml');
  if (commentsFile) {
    const commentsXml = await commentsFile.async('string');
    const pattern = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(commentsXml)) !== null && comments.length < MAX_ITEMS) {
      const id = attr(match[1], 'w:id');
      const body = match[2];
      const text = normalize(
        Array.from(body.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
          .map((m) => decodeXml(m[1]))
          .join(' '),
      );
      if (!text) continue;
      const range = ranges.get(id);
      comments.push({
        id,
        author: normalize(attr(match[1], 'w:author')) || 'Tanpa nama',
        date: attr(match[1], 'w:date') || null,
        text,
        quote: range ? textBetween(runs, range) || null : null,
      });
    }
  }

  const trackChanges: DocxTrackChange[] = [];
  const changePattern = /<w:(ins|del)\b([^>]*)>([\s\S]*?)<\/w:\1>/g;
  let change: RegExpExecArray | null;
  while ((change = changePattern.exec(documentXml)) !== null && trackChanges.length < MAX_ITEMS) {
    const kind = change[1] === 'ins' ? 'insert' : 'delete';
    const body = change[3];
    const text = normalize(
      Array.from(body.matchAll(/<w:(?:t|delText)\b[^>]*>([\s\S]*?)<\/w:(?:t|delText)>/g))
        .map((m) => decodeXml(m[1]))
        .join(' '),
    );
    if (!text) continue;
    trackChanges.push({
      kind,
      author: normalize(attr(change[2], 'w:author')) || 'Tanpa nama',
      date: attr(change[2], 'w:date') || null,
      text: text.slice(0, MAX_QUOTE),
    });
  }

  return { comments, trackChanges };
}
