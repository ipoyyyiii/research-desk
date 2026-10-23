/** Metadata halaman depan skripsi — isi `skripsi.json` di root project. */
export type FrontMatter = {
  title: string;
  author: string;
  nim: string;
  program: string;
  faculty: string;
  institution: string;
  city: string;
  year: string;
  supervisor1: string;
  supervisor2: string;
};

export const FRONT_MATTER_KEYS = [
  'title',
  'author',
  'nim',
  'program',
  'faculty',
  'institution',
  'city',
  'year',
  'supervisor1',
  'supervisor2',
] as const satisfies ReadonlyArray<keyof FrontMatter>;

export const EMPTY_FRONT_MATTER: FrontMatter = {
  title: '',
  author: '',
  nim: '',
  program: '',
  faculty: '',
  institution: '',
  city: '',
  year: '',
  supervisor1: '',
  supervisor2: '',
};

const MAX_FIELD_LENGTH = 300;

/** Ambil hanya field yang dikenal, trim, dan batasi panjangnya. */
export function normalizeFrontMatter(input: unknown): FrontMatter {
  const record =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const result = { ...EMPTY_FRONT_MATTER };
  for (const key of FRONT_MATTER_KEYS) {
    const value = record[key];
    result[key] = typeof value === 'string' ? value.trim().slice(0, MAX_FIELD_LENGTH) : '';
  }
  return result;
}
