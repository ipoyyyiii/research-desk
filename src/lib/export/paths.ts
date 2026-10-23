import fs from 'node:fs/promises';
import path from 'node:path';

/** Path absolut aman untuk file di dalam folder project (blokir `..`). */
export function resolveInside(root: string, relative: string): string | null {
  const cleaned = relative.replace(/^\/+/, '');
  const abs = path.resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** Path relatif project dengan separator POSIX (dipakai API & URL /raw). */
export function toProjectPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** Cek realpath: file/folder nyata tidak boleh keluar dari root project. */
export async function isRealInside(root: string, abs: string): Promise<boolean> {
  const real = await fs.realpath(abs).catch(() => null);
  if (!real) return false;
  return real === root || real.startsWith(root + path.sep);
}
