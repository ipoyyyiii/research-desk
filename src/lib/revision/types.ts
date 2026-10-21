// Kontrak bersama antara route API /api/projects/<slug>/revisions dan panel
// "Loop Revisi Dosen" (komentar dosen → checklist → selesai).

/** Status item revisi: belum → sedang dikerjakan → selesai. */
export const REVISION_STATUSES = ['todo', 'doing', 'done'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export type RevisionItem = {
  id: number;
  slug: string;
  /** Isi komentar dosen. */
  text: string;
  status: RevisionStatus;
  /** Path relatif file bab di dalam project; null = belum ditautkan. */
  chapterPath: string | null;
  /** Catatan singkat cara komentar ditutup; null = belum ada. */
  note: string | null;
  /** ISO string kapan item ditandai selesai; null = belum selesai. */
  resolvedAt: string | null;
  position: number;
  createdAt: string;
};

/** Bentuk baris mentah dari DB. */
export type RevisionItemRecord = {
  id: number;
  slug: string;
  text: string;
  status: string;
  chapterPath: string | null;
  note: string | null;
  resolvedAt: Date | null;
  position: number;
  createdAt: Date;
};

/** Batas aman biar satu paste gak membanjiri DB. */
export const MAX_REVISION_ITEMS = 200;
export const MAX_REVISION_TEXT = 2000;
export const MAX_REVISION_NOTE = 2000;
export const MAX_REVISION_RAW = MAX_REVISION_ITEMS * MAX_REVISION_TEXT;

export function parseRevisionStatus(raw: unknown): RevisionStatus {
  return raw === 'doing' || raw === 'done' ? raw : 'todo';
}

/** Baris DB → kontrak API (tanggal jadi ISO string). */
export function toRevisionItem(row: RevisionItemRecord): RevisionItem {
  return {
    id: row.id,
    slug: row.slug,
    text: row.text,
    status: parseRevisionStatus(row.status),
    chapterPath: row.chapterPath,
    note: row.note,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

/** JSON dari API → RevisionItem; nilai aneh dilewati (balik null). */
export function parseRevisionItemJson(value: unknown): RevisionItem | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<RevisionItem>;
  if (typeof v.id !== 'number' || typeof v.text !== 'string') return null;
  return {
    id: v.id,
    slug: typeof v.slug === 'string' ? v.slug : '',
    text: v.text,
    status: parseRevisionStatus(v.status),
    chapterPath: typeof v.chapterPath === 'string' ? v.chapterPath : null,
    note: typeof v.note === 'string' ? v.note : null,
    resolvedAt: typeof v.resolvedAt === 'string' ? v.resolvedAt : null,
    position: typeof v.position === 'number' ? v.position : 0,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };
}

/**
 * Komentar mentah → item individual. Aturan: blok yang dipisah baris kosong
 * dipecah lebih dulu; kalau hasilnya cuma satu blok, dipecah per baris.
 * Item kosong dibuang, jumlah dibatasi MAX_REVISION_ITEMS, tiap item dipotong
 * maksimal MAX_REVISION_TEXT karakter. Dipakai server DAN client supaya
 * hasilnya sama.
 */
export function parseRevisionRaw(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  const blocks = trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '');
  const parts = blocks.length > 1 ? blocks : trimmed.split('\n');
  const items: string[] = [];
  for (const part of parts) {
    const clean = part.trim();
    if (clean === '') continue;
    items.push(clean.slice(0, MAX_REVISION_TEXT));
    if (items.length >= MAX_REVISION_ITEMS) break;
  }
  return items;
}

/** Path bab harus relatif & stay di dalam project — tolak absolute/naik folder. */
export function normalizeChapterPath(raw: string): string | null {
  const cleaned = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (cleaned === '') return null;
  if (cleaned.startsWith('/')) return null;
  if (cleaned.split('/').some((part) => part === '' || part === '..' || part === '.')) return null;
  return cleaned;
}
