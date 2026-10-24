import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { writeBinaryFile, writeTextFile } from '@/lib/workspace/files';
import { workspaceError } from '@/lib/workspace/api-error';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Buat template instrumen penelitian:
 * - `data/instrumen-respon.csv` — kolom `responden,P1..Pn` yang siap diisi
 *   (atau ditimpa hasil ekspor Google Forms setelah kolomnya disamakan)
 * - `dokumen/instrumen-penelitian.md` — lembar instrumen untuk dilampirkan
 *
 * Kolom item harus konsisten supaya `uji-statistik.py --items P1,P2,...`
 * bisa menghitung validitas per butir dan reliabilitas.
 */

const bodySchema = z.object({
  /** Jumlah butir (2–60). */
  items: z.number().int().min(2).max(60).optional(),
  /** Skala Likert maksimum (4–7, default 5). */
  scale: z.number().int().min(2).max(10).optional(),
  /** Judul instrumen (muncul di lembar instrumen). */
  title: z.string().max(200).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    const project = rows[0];
    if (!project) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }
    const count = parsed.data.items ?? 10;
    const scale = parsed.data.scale ?? 5;
    const title = (parsed.data.title ?? 'Instrumen Penelitian').trim() || 'Instrumen Penelitian';
    const codes = Array.from({ length: count }, (_, index) => `P${index + 1}`);

    const csv = ['responden,' + codes.join(',')].join('\n') + '\n';
    const header = ['Kode', 'Pernyataan', ...Array.from({ length: scale }, (_, i) => String(i + 1))];
    const md = [
      `# ${title}`,
      '',
      'Petunjuk: beri tanda centang pada salah satu kolom skor sesuai tingkat persetujuan.',
      `Skala: 1 – ${scale} (1 = sangat tidak setuju, ${scale} = sangat setuju).`,
      '',
      `| ${header.join(' | ')} |`,
      `|${header.map(() => '---').join('|')}|`,
      ...codes.map((code) => `| ${code} |  | ${Array.from({ length: scale }, () => ' ').join(' | ')} |`),
      '',
      '## Catatan pengolahan',
      '',
      `- Isi jawaban di \`data/instrumen-respon.csv\` (kolom ${codes.join(', ')}).`,
      '- Hitung validitas tiap butir + reliabilitas:',
      '',
      '```bash',
      `.venv/bin/python scripts/uji-statistik.py --data data/instrumen-respon.csv --items ${codes.join(',')} --out hasil/validitas-instrumen.md`,
      '```',
      '',
      '- Butir dengan r-hitung < r-tabel direvisi atau dibuang sebelum analisis lanjutan.',
    ].join('\n');

    await writeBinaryFile(project.folderPath, 'data/instrumen-respon.csv', Buffer.from(csv, 'utf8').toString('base64'));
    await writeTextFile(project.folderPath, 'dokumen/instrumen-penelitian.md', md);

    return NextResponse.json(
      { ok: true, csv: 'data/instrumen-respon.csv', md: 'dokumen/instrumen-penelitian.md', items: codes },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error) return workspaceError(error, 'Gagal membuat template instrumen');
    console.error('[api/projects/instrument-template] POST gagal:', error);
    return NextResponse.json({ error: 'Gagal membuat template instrumen' }, { status: 500 });
  }
}
