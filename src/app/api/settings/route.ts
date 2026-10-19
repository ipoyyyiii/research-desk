import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
// effort divalidasi regex inline di patchSchema (variant ASLI model, src/lib/ai/effort.ts)

export const dynamic = 'force-dynamic';

/** Ambil baris settings tunggal (id=1); bikin default kalau belum ada. */
async function getOrCreateSettings() {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (rows.length > 0) return rows[0];
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return row;
}

export async function GET() {
  try {
    const row = await getOrCreateSettings();
    return NextResponse.json({ settings: row });
  } catch (error) {
    console.error('[api/settings] GET gagal:', error);
    return NextResponse.json({ error: 'Gagal membuka pengaturan' }, { status: 500 });
  }
}

const patchSchema = z.object({
  locale: z.enum(['id', 'en']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  effort: z
    .string()
    .regex(/^[a-z0-9_-]{1,24}$/i, 'effort tidak valid') // variant ASLI dari model (src/lib/ai/effort.ts)
    .nullable()
    .optional(), // null = bawaan model
  defaultCitationStyle: z.string().min(2).max(40).optional(),
  lastProjectId: z.number().int().optional(),
  agentModelOverride: z.string().min(1).max(200).nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Data tidak valid', details: parsed.error.issues },
        { status: 400 },
      );
    }
    await getOrCreateSettings();
    const updates = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });
    }
    const [row] = await db.update(settings).set(updates).where(eq(settings.id, 1)).returning();
    return NextResponse.json({ settings: row });
  } catch (error) {
    console.error('[api/settings] PATCH gagal:', error);
    return NextResponse.json({ error: 'Gagal menyimpan pengaturan' }, { status: 500 });
  }
}
