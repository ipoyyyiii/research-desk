import fs from 'node:fs/promises';
import path from 'node:path';
import { uniqueNodeName } from './files';

/**
 * Pasang skrip `uji-statistik.py` ke `<project>/scripts/` — hanya saat user
 * minta (clean start: tidak ada folder otomatis). Sumber: assets/templates di app.
 */
export async function installStatsTemplate(
  baseReal: string,
): Promise<{ path: string; name: string }> {
  const dir = path.join(baseReal, 'scripts');
  await fs.mkdir(dir, { recursive: true });

  const source = path.join(process.cwd(), 'assets', 'templates', 'uji-statistik.py');
  const content = await fs.readFile(source, 'utf8');

  const name = uniqueNodeName(dir, 'uji-statistik.py');
  await fs.writeFile(path.join(dir, name), content, { mode: 0o644 });
  return { path: `scripts/${name}`, name };
}
