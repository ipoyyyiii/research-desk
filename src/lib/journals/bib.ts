import type { JournalCard } from './types';

/** Lowercase + ASCII-sane: buang diakritik (NFKD) dan karakter non [a-z0-9]. */
function asciiSanitize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Stopword umum (Inggris + Indonesia) yang dilewati saat mencari kata judul bermakna. */
const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'on', 'in', 'and', 'for', 'to',
  'dan', 'di', 'ke', 'dari', 'pada', 'yang', 'untuk',
]);

/** Penanda "tanpa nama" yang bukan nama keluarga sungguhan. */
const PLACEHOLDER_LASTNAMES = new Set([
  'unknown', 'anonymous', 'anon', 'unnamed', 'none', 'null',
]);

/** Kata judul yang sudah disanitasi (kata kosong / tanda baca saja dibuang). */
function titleWords(title: string): string[] {
  return title
    .split(/\s+/)
    .map((word) => asciiSanitize(word))
    .filter((word) => word !== '');
}

/** Kata pertama judul apa adanya — bagian `<kata>` pada key author+tahun. */
function firstTitleWord(title: string): string {
  return titleWords(title)[0] ?? 'untitled';
}

/** Kata judul pertama yang bermakna (stopword/angka dilewati) — pengganti nama author. */
function firstMeaningfulTitleWord(title: string): string {
  const words = titleWords(title);
  return (
    words.find((word) => !TITLE_STOPWORDS.has(word) && !/^\d+$/.test(word)) ??
    words[0] ??
    'untitled'
  );
}

/**
 * Nama keluarga tidak berguna kalau kosong, cuma penanda "tanpa nama"
 * (unknown/anonymous), atau hanya inisial ("J.", "J. K."). Key dari nama seperti
 * itu — mis. `unknown2019the` — tidak bisa diketik di sitasi `[@...]` dan jelek di
 * daftar pustaka.
 */
function isUselessLastname(token: string): boolean {
  const stripped = token.replace(/[.,;]/g, '').trim();
  if (stripped === '') return true;

  const sanitized = asciiSanitize(stripped);
  if (sanitized === '' || PLACEHOLDER_LASTNAMES.has(sanitized)) return true;

  // Inisial: semua bagian (dipisah spasi/titik) cuma satu huruf, mis. "J." / "J. K.".
  const parts = token.split(/[\s.]+/).filter((part) => part !== '');
  return parts.length > 0 && parts.every((part) => part.length === 1);
}

/**
 * BibTeX key: `<lastname-tanpa-spasi><year><kata-judul-pertama>` → contoh `huisman2018peer`.
 * Bila author pertama tidak punya nama keluarga yang berguna, dipakai
 * `<kata-judul-bermakna><year>` → mis. `impact2019`, bukan `unknown2019the`.
 * Kalau bentrok dengan existingKeys → suffix a/b/c, lalu angka.
 */
export function generateBibKey(paper: JournalCard, existingKeys: string[]): string {
  const existing = new Set(existingKeys);

  const rawLastname = (paper.authors[0] ?? '').trim().split(/\s+/).pop() ?? '';
  const yearPart = paper.year != null ? String(paper.year) : '';

  // Author normal tetap author + tahun + kata judul (perilaku lama). Hanya saat
  // nama author tidak berguna kita pakai kata judul bermakna + tahun, supaya key
  // tetap pendek, gampang diketik di `[@...]`, dan tidak memuat "unknown".
  const base = isUselessLastname(rawLastname)
    ? `${firstMeaningfulTitleWord(paper.title)}${yearPart}`
    : `${asciiSanitize(rawLastname)}${yearPart}${firstTitleWord(paper.title)}`;

  const candidates: string[] = [base];
  for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']) {
    candidates.push(`${base}${suffix}`);
  }
  for (let i = 2; i <= 100; i += 1) candidates.push(`${base}${i}`);

  return candidates.find((candidate) => !existing.has(candidate)) ?? `${base}${Date.now().toString(36)}`;
}

/** Blok BibTeX:
 * @article{<key>,\n  author = ..., title, year?, journal?, doi?\n}
 */
export function bibEntry(paper: JournalCard, key: string): string {
  const fields: string[] = [];
  if (paper.authors.length > 0) {
    fields.push(`  author = {${paper.authors.join(' and ')}}`);
  }
  fields.push(`  title = {${paper.title}}`);
  if (paper.year != null) fields.push(`  year = {${paper.year}}`);
  if (paper.venue) fields.push(`  journal = {${paper.venue}}`);
  if (paper.doi) {
    // BibTeX `doi` harus DOI telanjang; pandoc/CSL menambahkan https://doi.org/ sendiri.
    const doi = paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    fields.push(`  doi = {${doi}}`);
  }
  return `@article{${key},\n${fields.join(',\n')}\n}`;
}

/** Ambil semua key yang sudah ada di isi references.bib → regex `@article\w*{([A-Za-z0-9_-]+),`. */
export function extractBibKeys(content: string): string[] {
  const re = /@article\w*\{([A-Za-z0-9_-]+),/gi;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

/** Entry ter-parse dari references.bib — buat list sitasi + chip tooltip. */
export type BibEntry = {
  key: string;
  /** Jenis entry BibTeX (article/book/…, lowercase) — buat sources.xml Word. */
  type: string | null;
  title: string;
  authors: string[];
  year: string | null;
  venue: string | null;
  doi: string | null;
};

function field(block: string, name: string): string | null {
  // Word-boundary: `title` tidak match di dalam `booktitle`.
  const re = new RegExp(`\\b${name}\\s*=\\s*\\{`, 'i');
  const match = re.exec(block);
  if (!match) return null;

  // Scan brace seimbang (field bisa punya `{...}` nested).
  let depth = 1;
  let i = match.index + match[0].length;
  const out: string[] = [];
  while (i < block.length && depth > 0) {
    const ch = block[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Parse file BibTeX (nested brace ditangani — sebagian entry berasal dari
 * sumber luar, jadi formatnya variatif). Struktur: @type{key, ...fields }
 */
export function parseBib(content: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const at = content.indexOf('@', cursor);
    if (at < 0) break;

    const brace = content.indexOf('{', at);
    const nl = content.indexOf('\n', at);
    // '@' tapi bukan awal entry (mis. di dalam teks) → lanjut cari berikutnya.
    if (brace < 0 || (nl >= 0 && nl < brace)) {
      cursor = at + 1;
      continue;
    }

    const keyStart = content.indexOf(',', brace);
    if (keyStart < 0) break;
    const key = content.slice(brace + 1, keyStart).trim();
    const type = content.slice(at + 1, brace).trim().toLowerCase() || null;

    let depth = 1;
    let end = keyStart + 1;
    while (end < content.length && depth > 0) {
      const ch = content[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      end += 1;
    }

    const block = content.slice(keyStart + 1, end > 0 ? end - 1 : undefined);
    if (key.length > 0) {
      entries.push({
        key,
        type,
        title: field(block, 'title') ?? '',
        authors: (field(block, 'author') ?? '')
          .split(/ and /i)
          .map((a) => a.trim())
          .filter(Boolean),
        year: field(block, 'year'),
        venue: field(block, 'journal') ?? field(block, 'venue') ?? field(block, 'booktitle'),
        doi: field(block, 'doi'),
      });
    }
    cursor = end;
  }

  return entries;
}
