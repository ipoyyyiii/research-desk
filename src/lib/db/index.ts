import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/**
 * Satu-satunya pintu ke SQLite app (`data/app.db`).
 *
 * Skema dibuat otomatis dari folder `drizzle/` saat pertama kali dipakai, jadi
 * hasil `git clone` langsung jalan tanpa langkah migrasi manual. SQL migrasi
 * idempotent (`CREATE TABLE IF NOT EXISTS`), jadi database lama yang tabelnya
 * sudah ada juga aman.
 */

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, 'app.db'));
sqlite.pragma('journal_mode = WAL');

const database = drizzle(sqlite, { schema });

const migrationsFolder = path.join(process.cwd(), 'drizzle');
if (fs.existsSync(migrationsFolder)) {
  try {
    migrate(database, { migrationsFolder });
  } catch (error) {
    // App jangan mati total kalau migrasi gagal (mis. folder read-only):
    // query berikutnya bakal gagal dengan pesan yang lebih spesifik.
    console.error('[db] migrasi gagal:', error);
  }
}

export const db = database;
export { schema };
