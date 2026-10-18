import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { ensureServer, getAuthState } from '@/lib/opencode/service';
import { readAgentModelOverride, type ModelEntry } from '@/lib/opencode/model-pick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Model picker:
 * - GET  → daftar model per provider (Gratis / yang butuh login) + pilihan tersimpan.
 * - POST → set model utk session project ini + simpan ke settings.agentModelOverride
 *          format "providerID/modelID" (sekali set, semua session mengikuti).
 */

export type ModelGroup = { providerID: string; label: string; free: boolean; models: ModelEntry[] };

export async function GET() {
  try {
    const client = await ensureServer();
    const auth = await getAuthState();
    const models = (await client.model.list())?.data ?? [];

    const groups: ModelGroup[] = [];
    const push = (providerID: string, label: string, free: boolean, entries: ModelEntry[]) => {
      if (entries.length > 0) groups.push({ providerID, label, free, models: entries });
    };

    const seen = new Set<string>();
    for (const m of models) {
      if (!m?.providerID || !m?.id || seen.has(`${m.providerID}/${m.id}`)) continue;
      seen.add(`${m.providerID}/${m.id}`);
      const entry: ModelEntry = { providerID: m.providerID, modelID: m.id, name: m.name ?? m.id };
      if (m.providerID === 'opencode') {
        const free = groups.find((g) => g.providerID === 'opencode');
        if (free) free.models.push(entry);
        else push('opencode', 'Model gratis', true, [entry]);
      }
    }
    // Provider lain yang AKTIF (sudah login) → group sendiri.
    for (const providerID of auth.providers.filter((p) => p !== 'opencode')) {
      const entries: ModelEntry[] = [];
      for (const m of models) {
        if (m.providerID !== providerID || seen.has(`${m.providerID}/${m.id}`)) continue;
        seen.add(`${m.providerID}/${m.id}`);
        entries.push({ providerID: m.providerID, modelID: m.id, name: m.name ?? m.id });
      }
      if (entries.length > 0) push(providerID, providerID, false, entries);
    }

    const override = await readAgentModelOverride();

    return NextResponse.json({ groups, override, connected: auth.connected });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membuka daftar model';
    return NextResponse.json({ groups: [], override: null, error: message }, { status: 200 });
  }
}

type SetBody = {
  providerID?: string;
  modelID?: string;
  sessionId?: string;
};

/** Set model session + simpan preferensi app-level. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SetBody;
    const providerID = body.providerID ?? '';
    const modelID = body.modelID ?? '';
    const sessionId = body.sessionId ?? '';
    if (!providerID || !modelID) {
      return NextResponse.json({ error: 'providerID dan modelID wajib ada' }, { status: 400 });
    }

    const client = await ensureServer();

    if (sessionId) {
      await client.session.switchModel({
        sessionID: sessionId,
        model: { providerID, id: modelID },
      });
    }

    // Simpan preferensi (Upsert settings id=1).
    const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (rows.length === 0) {
      await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
    }
    await db.update(settings).set({ agentModelOverride: `${providerID}/${modelID}` }).where(eq(settings.id, 1));

    return NextResponse.json({ ok: true, override: `${providerID}/${modelID}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengganti model';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
