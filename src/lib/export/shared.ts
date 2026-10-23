import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

const exec = promisify(execFile);

export const STYLE_CSL: Record<string, string> = {
  apa: 'apa.csl',
  ieee: 'ieee.csl',
};

export async function resolveProjectFolder(slug: string): Promise<string | null> {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0]?.folderPath ?? null;
}

/** Tool PDF lokal: weasyprint dulu, fallback wkhtmltopdf. Null kalau tidak ada. */
export async function findPdfTool(): Promise<'weasyprint' | 'wkhtmltopdf' | null> {
  for (const tool of ['weasyprint', 'wkhtmltopdf'] as const) {
    const ok = await exec('sh', ['-c', `command -v ${tool}`])
      .then(() => true)
      .catch(() => false);
    if (ok) return tool;
  }
  return null;
}
