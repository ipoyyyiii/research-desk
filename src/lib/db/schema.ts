import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  folderPath: text('folder_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastOpenedAt: integer('last_opened_at', { mode: 'timestamp' }),
  // Session agent aktif project ini — dipakai multi-sesi (picker + slash menu).
  // null = belum ada binding; fall back ke session lokal terbaru.
  opencodeSessionId: text('opencode_session_id'),
});

// Baris tunggal (id = 1) — preferensi app-level.
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locale: text('locale').notNull().default('id'), // 'id' | 'en'
  theme: text('theme').notNull().default('system'), // 'light' | 'dark' | 'system'
  effort: text('effort'), // null/'auto' = bawaan model; string variant ASLI dari server OpenCode (src/lib/ai/effort.ts)
  defaultCitationStyle: text('default_citation_style').notNull().default('apa'),
  lastProjectId: integer('last_project_id'),
  agentModelOverride: text('agent_model_override'),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// Paper jurnal yang disimpan user per project (1 baris per (slug, paperId)).
export const savedPapers = sqliteTable('saved_papers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  paperId: text('paper_id').notNull(),
  bibKey: text('bib_key').notNull(),
  data: text('data').notNull(), // JSON.stringify(JournalCard)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  slugPaperUniq: unique('saved_papers_slug_paper_uniq').on(table.slug, table.paperId),
}));

export type SavedPaper = typeof savedPapers.$inferSelect;
export type NewSavedPaper = typeof savedPapers.$inferInsert;

// Baris matriks literatur (Bab 2) per project. Satu baris = satu paper yang
// dianalisis; kolom tema/metode/temuan/kutipan diisi user manual.
// paperId = paperId library (saved_papers); null = baris manual (judul diketik).
// Unik (slug, paperId) — paperId NULL gak bisa diAndai unik di SQLite, jadi
// duplikasi paperId dicek di level aplikasi (route POST /matrix).
export const matrixRows = sqliteTable('matrix_rows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  paperId: text('paper_id'),
  title: text('title').notNull(),
  authors: text('authors').notNull().default('[]'), // JSON string array
  year: integer('year'),
  tema: text('tema').notNull().default(''),
  metode: text('metode').notNull().default(''),
  temuan: text('temuan').notNull().default(''),
  kutipan: text('kutipan').notNull().default(''),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  slugPaperUniq: unique('matrix_rows_slug_paper_uniq').on(table.slug, table.paperId),
}));

export type MatrixRowRecord = typeof matrixRows.$inferSelect;
export type NewMatrixRow = typeof matrixRows.$inferInsert;

// Catatan ringan dari paper (anotasi PDF versi txt). Satu catatan bisa
// nempel ke paper library (paperId), ke baris matriks (matrixRowId), atau
// keduanya. paperId NULL = catatan bebas (mis. file PDF lepas).
// matrixRowId NULL = catatan Attached ke paper doang (dibaca di preview PDF).
// source = cara penangkapan: 'manual' | 'matrix'.
export const paperNotes = sqliteTable('paper_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  paperId: text('paper_id'),
  matrixRowId: integer('matrix_row_id').references(() => matrixRows.id, { onDelete: 'set null' }),
  note: text('note').notNull(),
  quote: text('quote'),
  source: text('source').notNull().default('manual'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type PaperNoteRecord = typeof paperNotes.$inferSelect;
export type NewPaperNote = typeof paperNotes.$inferInsert;
