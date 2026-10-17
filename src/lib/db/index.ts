import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, 'app.db'));
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export { schema };
