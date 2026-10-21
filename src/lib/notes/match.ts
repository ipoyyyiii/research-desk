// Pencocokan best-effort antara berkas PDF di referensi/papers/ dan paper
// yang tersimpan di Perpustakaan. Nama PDF hasil unduhan jurnal berasal dari
// DOI (lihat route /api/journals/pdf), jadi DOI adalah kunci paling akurat.

/** Normalisasi teks buat pencocokan longgar (spasi/simbol → '-'). */
export function normalizeMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Nama berkas tanpa ekstensi. */
export function fileStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Nama berkas PDF dari DOI — sama persis dengan route /api/journals/pdf. */
export function pdfFileStem(doi: string): string {
  return doi
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim()
    .replace(/^10\.\d{4,9}\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}

export type MatchablePaper = {
  paperId: string;
  title: string;
  doi: string | null;
};

/** Kunci kandidat untuk satu paper: paperId, judul, dan turunan DOI. */
export function paperMatchKeys(paper: MatchablePaper): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    const key = normalizeMatchKey(value);
    if (key !== '') keys.add(key);
  };
  add(paper.paperId);
  add(paper.title);
  if (paper.doi) {
    add(pdfFileStem(paper.doi));
    const tail = paper.doi.split('/').slice(1).join('/');
    if (tail !== '') add(tail);
  }
  return [...keys];
}

/**
 * Cari paper library yang cocok dengan nama berkas PDF. Cocok kalau nama
 * berkas (tanpa ekstensi) sama dengan paperId, judul, atau turunan DOI.
 */
export function matchPaperByFileName(
  fileName: string,
  papers: MatchablePaper[],
): MatchablePaper | null {
  const stem = normalizeMatchKey(fileStem(fileName));
  if (stem === '') return null;
  for (const paper of papers) {
    if (paperMatchKeys(paper).includes(stem)) return paper;
  }
  return null;
}
