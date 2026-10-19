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

// File pengetahuan (pane Basis Pengetahuan di panel agent) — 1 baris per
// (project_id, path). DDL fisiknya dibuat idempotent lewat src/lib/db/knowledge.ts
// (drizzle-kit push DILARANG); definisi drizzle ini sekadar tipe terinferensi.
export const knowledgeFiles = sqliteTable('knowledge_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull(),
  path: text('path').notNull(),
  addedAt: integer('added_at').notNull(),
}, (table) => ({
  projectPathUniq: unique('knowledge_files_project_path_uniq').on(table.projectId, table.path),
}));

export type KnowledgeFile = typeof knowledgeFiles.$inferSelect;
export type NewKnowledgeFile = typeof knowledgeFiles.$inferInsert;
