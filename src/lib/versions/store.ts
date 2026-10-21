import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError, readTextFile, safeResolve, writeTextFile } from '@/lib/workspace/files';
import { SNAPSHOT_DIR, SNAPSHOT_REASONS, type SnapshotMeta, type SnapshotReason } from './types';

// ── Store snapshot versi bab ─────────────────────────────────────────────────
//
// Riwayat disimpan sebagai FILE di dalam folder project:
//   <project>/.riwayat/<path-bab-di-encode>/<timestamp>-<hash>.md
//   <project>/.riwayat/<path-bab-di-encode>/<timestamp>-<hash>.json  (sidecar)
//
// Sidecar berisi { path, savedAt, reason, bytes, hash } supaya UI bisa daftar
// tanpa parse nama file. Semua jalur lewat guard yang sama dengan file biasa:
// traversal dicek `safeResolve`, symlink-escape dicek realpath.

/**
 * Autosave bisa nyetus banyak kali dalam hitungan detik. Selama burst yang
 * sama, isi bab yang disimpan cukup satu: versi 'sebelum edit' yang sudah ada
 * (isi sebelum burst dimulai) tetap dipakai — jadi state lama gak pernah
 * hilang, dan jumlah file gak meledak.
 */
const COALESCE_WINDOW_MS = 60_000;

const HASH_LENGTH = 6;

/** Hash pendek isi snapshot (sha256, 6 hex). */
function hashOf(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

/** Timestamp aman buat nama file: ISO-8601 tanpa milidetik, ':' diganti '-'. */
function stampOf(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

/** Folder snapshot satu bab: path bab tanpa ekstensi, '/' → '__', karakter liar → '_'. */
export function snapshotDirName(chapterPath: string): string {
  const stem = chapterPath.replace(/\.md$/i, '');
  const encoded = stem
    .replace(/\//g, '__')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return encoded === '' ? 'bab' : encoded;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/** Target wajib benar-benar di dalam root project (anti symlink-escape). */
function assertInside(baseReal: string, abs: string): void {
  const real = fs.realpathSync(abs);
  if (real !== baseReal && !real.startsWith(baseReal + path.sep)) {
    throw new WorkspaceError('PATH_OUT_OF_PROJECT');
  }
}

/** Path bab harus file .md di dalam project. */
function resolveChapter(baseReal: string, chapterPath: string): string {
  const abs = safeResolve(baseReal, chapterPath);
  if (path.extname(abs).toLowerCase() !== '.md') throw new WorkspaceError('UNSUPPORTED_TYPE');
  return abs;
}

/** Folder snapshot untuk satu bab — dibuat kalau belum ada, selalu di dalam project. */
function ensureChapterDir(baseReal: string, chapterPath: string): string {
  const root = path.join(baseReal, SNAPSHOT_DIR);
  fs.mkdirSync(root, { recursive: true });
  assertInside(baseReal, root);
  const dir = path.join(root, snapshotDirName(chapterPath));
  fs.mkdirSync(dir, { recursive: true });
  assertInside(baseReal, dir);
  return dir;
}

/** Nama file snapshot unik (detik yang sama + hash sama → suffix angka). */
function uniqueFileName(dirAbs: string, stem: string): string {
  let candidate = `${stem}.md`;
  let index = 2;
  while (fs.existsSync(path.join(dirAbs, candidate))) {
    candidate = `${stem}-${index}.md`;
    index += 1;
  }
  return candidate;
}

/** Sidecar `.json` ditulis manual (bukan lewat writeTextFile — itu khusus .md). */
async function writeSidecar(baseReal: string, meta: SnapshotMeta): Promise<void> {
  const rel = `${meta.dir}/${meta.file.replace(/\.md$/, '.json')}`;
  const abs = safeResolve(baseReal, rel);
  const parentReal = fs.realpathSync(path.dirname(abs));
  if (parentReal !== baseReal && !parentReal.startsWith(baseReal + path.sep)) {
    throw new WorkspaceError('PATH_OUT_OF_PROJECT');
  }
  try {
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) throw new WorkspaceError('PATH_OUT_OF_PROJECT');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fsp.writeFile(abs, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

/** Sidecar rusak / bukan Metadata → null (snapshot-nya diabaikan, bukan crash). */
function parseMeta(value: unknown): SnapshotMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SnapshotMeta>;
  if (typeof v.path !== 'string' || v.path === '') return null;
  if (typeof v.savedAt !== 'string' || v.savedAt === '') return null;
  if (typeof v.reason !== 'string') return null;
  if (!SNAPSHOT_REASONS.includes(v.reason as SnapshotReason)) return null;
  if (typeof v.bytes !== 'number' || !Number.isFinite(v.bytes)) return null;
  if (typeof v.hash !== 'string' || typeof v.file !== 'string' || typeof v.dir !== 'string') {
    return null;
  }
  return {
    path: v.path,
    savedAt: v.savedAt,
    reason: v.reason as SnapshotReason,
    bytes: v.bytes,
    hash: v.hash,
    file: v.file,
    dir: v.dir,
  };
}

async function readSidecar(baseReal: string, dirAbs: string, name: string): Promise<SnapshotMeta | null> {
  try {
    const abs = path.join(dirAbs, name);
    assertInside(baseReal, abs);
    const raw = await fsp.readFile(abs, 'utf8');
    return parseMeta(JSON.parse(raw));
  } catch {
    return null;
  }
}

function sortNewestFirst(metas: SnapshotMeta[]): SnapshotMeta[] {
  return metas.sort((a, b) => {
    if (a.savedAt === b.savedAt) return b.file.localeCompare(a.file);
    return a.savedAt < b.savedAt ? 1 : -1;
  });
}

/**
 * Simpan salinan isi bab sebagai snapshot baru.
 * `content` = isi bab yang disimpan sebagai cadangan (biasanya isi lama,
 * sebelum bab ditimpa).
 */
export async function saveSnapshot(
  baseReal: string,
  chapterPath: string,
  content: string,
  reason: SnapshotReason,
): Promise<SnapshotMeta> {
  const chapter = toPosix(chapterPath);
  resolveChapter(baseReal, chapter);
  const dir = ensureChapterDir(baseReal, chapter);
  const now = new Date();
  const hash = hashOf(content);
  const file = uniqueFileName(dir, `${stampOf(now)}-${hash}`);
  const meta: SnapshotMeta = {
    path: chapter,
    savedAt: now.toISOString(),
    reason,
    bytes: Buffer.byteLength(content, 'utf8'),
    hash,
    file,
    dir: `${SNAPSHOT_DIR}/${snapshotDirName(chapter)}`,
  };
  await writeTextFile(baseReal, `${meta.dir}/${file}`, content);
  await writeSidecar(baseReal, meta);
  return meta;
}

/** Daftar snapshot satu bab (terbaru dulu). */
export async function listSnapshots(baseReal: string, chapterPath: string): Promise<SnapshotMeta[]> {
  const chapter = toPosix(chapterPath);
  const dir = path.join(baseReal, SNAPSHOT_DIR, snapshotDirName(chapter));
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const metas: SnapshotMeta[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const meta = await readSidecar(baseReal, dir, entry.name);
    if (!meta) continue;
    if (meta.path !== chapter) continue; // folder dipakai dua bab → filter per path
    metas.push(meta);
  }
  return sortNewestFirst(metas);
}

/** Daftar snapshot semua bab (panel riwayat sekali ambil, laluelompok per path). */
export async function listAllSnapshots(baseReal: string): Promise<SnapshotMeta[]> {
  const root = path.join(baseReal, SNAPSHOT_DIR);
  if (!fs.existsSync(root)) return [];
  let dirs: fs.Dirent[];
  try {
    dirs = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const metas: SnapshotMeta[] = [];
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const dirAbs = path.join(root, dirent.name);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const meta = await readSidecar(baseReal, dirAbs, entry.name);
      if (meta) metas.push(meta);
    }
  }
  return sortNewestFirst(metas);
}

/** Cari metadata satu snapshot milik bab tertentu. */
async function findSnapshot(
  baseReal: string,
  chapterPath: string,
  file: string,
): Promise<SnapshotMeta | null> {
  if (path.basename(file) !== file || file === '') throw new WorkspaceError('INVALID_PATH');
  const metas = await listSnapshots(baseReal, chapterPath);
  return metas.find((meta) => meta.file === file) ?? null;
}

/** Isi snapshot (teks bab pada waktu itu). */
export async function readSnapshot(
  baseReal: string,
  chapterPath: string,
  file: string,
): Promise<string> {
  const meta = await findSnapshot(baseReal, chapterPath, file);
  if (!meta) throw new WorkspaceError('FILE_NOT_FOUND');
  const abs = safeResolve(baseReal, `${meta.dir}/${meta.file}`);
  assertInside(baseReal, abs);
  const stat = await fsp.stat(abs);
  if (!stat.isFile()) throw new WorkspaceError('FILE_NOT_FOUND');
  return fsp.readFile(abs, 'utf8');
}

async function removeSnapshotFiles(baseReal: string, meta: SnapshotMeta): Promise<void> {
  for (const name of [meta.file, meta.file.replace(/\.md$/, '.json')]) {
    const abs = safeResolve(baseReal, `${meta.dir}/${name}`);
    try {
      assertInside(baseReal, abs);
      await fsp.rm(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
}

/** Hapus satu snapshot (isi + sidecar). */
export async function deleteSnapshot(
  baseReal: string,
  chapterPath: string,
  file: string,
): Promise<void> {
  const meta = await findSnapshot(baseReal, chapterPath, file);
  if (!meta) throw new WorkspaceError('FILE_NOT_FOUND');
  await removeSnapshotFiles(baseReal, meta);
}

/** Isi bab yang ada di disk sekarang (null kalau file belum ada / kosong). */
async function readCurrentContent(baseReal: string, chapter: string): Promise<string | null> {
  try {
    const { content } = await readTextFile(baseReal, chapter);
    return content.trim() === '' ? null : content;
  } catch {
    return null;
  }
}

/**
 * Snapshot isi bab yang ada di disk sekarang (dipakai sebelum menimpa bab).
 * File belum ada / kosong → null (tak ada yang bisa disimpan).
 */
export async function snapshotCurrent(
  baseReal: string,
  chapterPath: string,
  reason: SnapshotReason,
): Promise<SnapshotMeta | null> {
  const chapter = toPosix(chapterPath);
  const content = await readCurrentContent(baseReal, chapter);
  if (content === null) return null;

  const hash = hashOf(content);
  const existing = await listSnapshots(baseReal, chapter);
  const latest = existing[0];
  if (latest && latest.hash === hash) return latest; // isi sama → sudah tersimpan

  // Burst autosave: versi 'sebelum edit' yang baru saja dibuat masih jadi
  // cadangan isi sebelum burst — jangan ditimpa, cukup pakai lagi.
  if (latest && latest.reason === 'edit' && reason === 'edit') {
    const age = Date.now() - Date.parse(latest.savedAt);
    if (Number.isFinite(age) && age < COALESCE_WINDOW_MS) return latest;
  }

  return saveSnapshot(baseReal, chapter, content, reason);
}

/**
 * Pulihkan isi snapshot ke bab. Isi bab saat ini disimpan dulu sebagai versi
 * baru (reason 'restore') supaya restore-nya sendiri bisa dibatalkan.
 */
export async function restoreSnapshot(
  baseReal: string,
  chapterPath: string,
  file: string,
): Promise<{ restored: SnapshotMeta; safety: SnapshotMeta | null }> {
  const chapter = toPosix(chapterPath);
  const meta = await findSnapshot(baseReal, chapter, file);
  if (!meta) throw new WorkspaceError('FILE_NOT_FOUND');
  const content = await readSnapshot(baseReal, chapter, file);
  // Selalu versi baru (walau isinya sama) — riwayatnya jelas: "sebelum restore".
  const current = await readCurrentContent(baseReal, chapter);
  const safety =
    current === null ? null : await saveSnapshot(baseReal, chapter, current, 'restore');
  await writeTextFile(baseReal, chapter, content);
  return { restored: meta, safety };
}
