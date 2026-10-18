import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  folderPath: text('folder_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastOpenedAt: integer('last_opened_at', { mode: 'timestamp' }),
});

// Baris tunggal (id = 1) — preferensi app-level.
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locale: text('locale').notNull().default('id'), // 'id' | 'en'
  theme: text('theme').notNull().default('system'), // 'light' | 'dark' | 'system'
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
