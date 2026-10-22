CREATE TABLE IF NOT EXISTS `matrix_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`paper_id` text,
	`title` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`year` integer,
	`tema` text DEFAULT '' NOT NULL,
	`metode` text DEFAULT '' NOT NULL,
	`temuan` text DEFAULT '' NOT NULL,
	`kutipan` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `matrix_rows_slug_paper_uniq` ON `matrix_rows` (`slug`,`paper_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `paper_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`paper_id` text,
	`matrix_row_id` integer,
	`note` text NOT NULL,
	`quote` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`matrix_row_id`) REFERENCES `matrix_rows`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`folder_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_opened_at` integer,
	`opencode_session_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `revision_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`chapter_path` text,
	`note` text,
	`resolved_at` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `saved_papers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`paper_id` text NOT NULL,
	`bib_key` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `saved_papers_slug_paper_uniq` ON `saved_papers` (`slug`,`paper_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`locale` text DEFAULT 'id' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`effort` text,
	`default_citation_style` text DEFAULT 'apa' NOT NULL,
	`last_project_id` integer,
	`agent_model_override` text
);
