// Kontrak bersama antara route API /api/projects/<slug>/matrix* dan panel Matriks.

export type MatrixRow = {
  id: number;
  slug: string;
  /** paperId library (saved_papers) — null kalau baris dibuat manual. */
  paperId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  tema: string;
  metode: string;
  temuan: string;
  kutipan: string;
  position: number;
  createdAt: string;
};

/** Kolom teks yang bisa diedit user di tabel matriks. */
export const MATRIX_FIELDS = ['tema', 'metode', 'temuan', 'kutipan'] as const;
export type MatrixField = (typeof MATRIX_FIELDS)[number];

/** Bentuk baris mentah dari DB (authors masih JSON string). */
export type MatrixRowRecord = {
  id: number;
  slug: string;
  paperId: string | null;
  title: string;
  authors: string;
  year: number | null;
  tema: string;
  metode: string;
  temuan: string;
  kutipan: string;
  position: number;
  createdAt: Date;
};

/**
 * authors disimpan sebagai JSON string array. Data yang bukan JSON (mis. teks
 * polos "Santoso, Lee") fallback dipecah per koma biar tetep terbaca.
 */
export function parseAuthors(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== '',
        );
      }
    } catch {
      // bukan JSON valid → treat sebagai teks polos
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function stringifyAuthors(authors: string[]): string {
  return JSON.stringify(authors.map((item) => item.trim()).filter((item) => item !== ''));
}

/** Baris DB → kontrak API (authors dipecah, createdAt jadi ISO string). */
export function toMatrixRow(row: MatrixRowRecord): MatrixRow {
  return {
    id: row.id,
    slug: row.slug,
    paperId: row.paperId,
    title: row.title,
    authors: parseAuthors(row.authors),
    year: row.year,
    tema: row.tema,
    metode: row.metode,
    temuan: row.temuan,
    kutipan: row.kutipan,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}
