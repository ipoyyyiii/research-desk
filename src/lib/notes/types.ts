// Kontrak bersama antara route API /api/projects/<slug>/notes* dan UI
// (panel Matriks + preview PDF di tab tengah).

/** Cara catatan ditangkap. */
export const NOTE_SOURCES = ['manual', 'matrix'] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

export type PaperNote = {
  id: number;
  slug: string;
  /** paperId library (saved_papers) — null kalau catatan lepas. */
  paperId: string | null;
  /** Baris matriks pemilik catatan — null kalau catatan nempel ke paper doang. */
  matrixRowId: number | null;
  note: string;
  quote: string | null;
  source: NoteSource;
  createdAt: string;
};

/** Bentuk baris mentah dari DB. */
export type PaperNoteRecord = {
  id: number;
  slug: string;
  paperId: string | null;
  matrixRowId: number | null;
  note: string;
  quote: string | null;
  source: string;
  createdAt: Date;
};

export function parseNoteSource(raw: string): NoteSource {
  return raw === 'matrix' ? 'matrix' : 'manual';
}

/** Baris DB → kontrak API (createdAt jadi ISO string). */
export function toPaperNote(row: PaperNoteRecord): PaperNote {
  return {
    id: row.id,
    slug: row.slug,
    paperId: row.paperId,
    matrixRowId: row.matrixRowId,
    note: row.note,
    quote: row.quote,
    source: parseNoteSource(row.source),
    createdAt: row.createdAt.toISOString(),
  };
}

/** JSON dari API → PaperNote; nilai aneh dilewati (balik null). */
export function parsePaperNoteJson(value: unknown): PaperNote | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<PaperNote>;
  if (typeof v.id !== 'number' || typeof v.note !== 'string') return null;
  return {
    id: v.id,
    slug: typeof v.slug === 'string' ? v.slug : '',
    paperId: typeof v.paperId === 'string' ? v.paperId : null,
    matrixRowId: typeof v.matrixRowId === 'number' ? v.matrixRowId : null,
    note: v.note,
    quote: typeof v.quote === 'string' ? v.quote : null,
    source: parseNoteSource(typeof v.source === 'string' ? v.source : 'manual'),
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };
}
