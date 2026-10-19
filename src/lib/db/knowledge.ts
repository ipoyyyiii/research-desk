import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Helper "Basis Pengetahuan" (tabel knowledge_files).
 *
 * Tabel fisik dibuat idempotent (CREATE TABLE IF NOT EXISTS) memakai driver
 * raw better-sqlite3 yang sama dengan src/lib/db/index.ts (file data/app.db).
 * `drizzle-kit push` DILARANG untuk tabel ini — schema drizzle-nya hanya
 * definisi tipe di schema.ts, sumber kebenaran DDL ada di sini.
 *
 * Jangan di-import dari file client (React) — semua akses hanya lewat route
 * API dengan `export const runtime = 'nodejs'`.
 */

export type KnowledgeItem = {
  /** Path relatif folder project, pemisah '/'. */
  path: string;
  /** Unix ms saat file didaftarkan. */
  addedAt: number;
  /** File masih ada di disk? (divek via existsSync saat list) */
  exists: boolean;
};

export type KnowledgeMutationResult = {
  items: KnowledgeItem[];
  /** Path yang benar-benar baru masuk tabel (gak duplikat). */
  added: string[];
};

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS knowledge_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(project_id, path)
)`;

const dataDir = path.join(process.cwd(), 'data');

/** Koneksi raw singleton (WAL) ke file data/app.db yang sama. */
let handle: InstanceType<typeof Database> | null = null;
function conn(): InstanceType<typeof Database> {
  if (!handle) {
    fs.mkdirSync(dataDir, { recursive: true });
    handle = new Database(path.join(dataDir, 'app.db'));
    handle.pragma('journal_mode = WAL');
  }
  return handle;
}

/** Dipanggil idempotent oleh tiap handler route knowledge sebelum beroperasi. */
export function ensureKnowledgeSchema(): void {
  conn().exec(TABLE_SQL);
}

type KnowledgeRow = { path: string; added_at: number };

/** Baris DB → item UI; `exists` dicatat dari disk (resolve absolute folder project). */
function toItem(projectId: number, folderPath: string, row: KnowledgeRow): KnowledgeItem {
  let exists = false;
  try {
    exists = fs.statSync(path.resolve(folderPath, row.path)).isFile();
  } catch {
    exists = false; // hilang / race — tampil sebagai "missing" di UI
  }
  return { path: row.path, addedAt: row.added_at, exists };
}

function selectAll(projectId: number, folderPath: string): KnowledgeItem[] {
  const rows = conn()
    .prepare('SELECT path, added_at FROM knowledge_files WHERE project_id = ? ORDER BY added_at DESC, path ASC')
    .all(projectId) as KnowledgeRow[];
  return rows.map((row) => toItem(projectId, folderPath, row));
}

/** List baris pengetahuan project + status ada/tidaknya file di disk. */
export function listKnowledge(projectId: number, folderPath: string): KnowledgeItem[] {
  return selectAll(projectId, folderPath);
}

/**
 * Insert-or-ignore daftar path (relatif folder project — SUDAH divalidasi
 * di-head-nya dan mengarah ke file yang ada di disk oleh route).
 */
export function addKnowledge(
  projectId: number,
  folderPath: string,
  paths: string[],
): KnowledgeMutationResult {
  const sqlite = conn();

  // Path mana yang benar-benar belum terdaftar (buat label `${added} di UI`).
  const existing = new Set(
    (sqlite.prepare('SELECT path FROM knowledge_files WHERE project_id = ?').all(projectId) as Array<{ path: string }>).map(
      (row) => row.path,
    ),
  );
  const added = paths.filter((p) => !existing.has(p));

  const insert = sqlite.prepare(
    'INSERT OR IGNORE INTO knowledge_files (project_id, path, added_at) VALUES (?, ?, ?)',
  );
  const run = sqlite.transaction((list: string[]) => {
    for (const p of list) insert.run(projectId, p, Date.now());
  });
  run(paths);

  return { items: selectAll(projectId, folderPath), added };
}

/** Hapus baris (file di disk gak disentuh). true = ada baris yang hilang. */
export function removeKnowledge(projectId: number, relPath: string): boolean {
  const info = conn()
    .prepare('DELETE FROM knowledge_files WHERE project_id = ? AND path = ?')
    .run(projectId, relPath);
  return info.changes > 0;
}
