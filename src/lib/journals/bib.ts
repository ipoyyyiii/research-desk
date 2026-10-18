import type { JournalCard } from './types';

/** Lowercase + ASCII-sane: buang diakritik (NFKD) dan karakter non [a-z0-9]. */
function asciiSanitize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * BibTeX key: `<lastname-tanpa-spasi><year><kata-judul-pertama>` → contoh `huisman2018peer`.
 * Kalau bentrok dengan existingKeys → suffix a/b/c, lalu angka.
 */
export function generateBibKey(paper: JournalCard, existingKeys: string[]): string {
  const existing = new Set(existingKeys);

  const rawLastname = (paper.authors[0] ?? '').trim().split(/\s+/).pop() ?? 'unknown';
  const lastname = asciiSanitize(rawLastname) || 'unknown';
  const yearPart = paper.year != null ? String(paper.year) : '';
  const firstWord =
    paper.title
      .split(/\s+/)
      .map((word) => asciiSanitize(word))
      .find((word) => word !== '') ?? 'untitled';

  const base = `${lastname}${yearPart}${firstWord}`;

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
  if (paper.doi) fields.push(`  doi = {${paper.doi}}`);
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
