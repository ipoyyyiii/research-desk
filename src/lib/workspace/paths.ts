import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

export type FolderGuardResult = { ok: true; folderPath: string } | { ok: false; error: string };

/**
 * Normalisasi path folder project + guard:
 * - dukung `~`
 * - WAJIB di dalam home directory (anti path-traversal ke luar)
 * - verifikasi realpath (anti symlink-escape)
 */
export function normalizeAndGuardFolder(input: string): FolderGuardResult {
  if (!input || !input.trim()) {
    return { ok: false, error: 'Path folder kosong' };
  }

  const expanded = input.startsWith('~') ? path.join(HOME, input.slice(1)) : input;
  const resolved = path.resolve(expanded);

  if (resolved !== HOME && !resolved.startsWith(HOME + path.sep)) {
    return { ok: false, error: 'Folder harus di dalam home directory (~)' };
  }

  try {
    let real: string;
    try {
      real = fs.realpathSync(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Folder belum ada — boleh dibuat nanti oleh ensureProjectDirectory,
        // yang tetap verifikasi realpath ulang setelah mkdir.
        return { ok: true, folderPath: resolved };
      }
      return { ok: false, error: 'Folder tidak dapat dibaca' };
    }
    if (real !== HOME && !real.startsWith(HOME + path.sep)) {
      return { ok: false, error: 'Folder melewati symlink ke luar home directory' };
    }
    return { ok: true, folderPath: real };
  } catch {
    return { ok: false, error: 'Folder tidak dapat dibaca' };
  }
}

/** Buat folder project kalau belum ada, verifikasi realpath di dalam home. */
export function ensureProjectDirectory(resolvedPath: string): string {
  fs.mkdirSync(resolvedPath, { recursive: true });
  const real = fs.realpathSync(resolvedPath);
  if (real !== HOME && !real.startsWith(HOME + path.sep)) {
    throw new Error('Folder melewati symlink ke luar home directory');
  }
  return real;
}

/** Struktur subfolder baku project (sesuai planning.md §3.3). */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'project'
  );
}
