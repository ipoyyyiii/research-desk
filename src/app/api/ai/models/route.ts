import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { ensureServer, getAuthState } from '@/lib/opencode/service';
import { readAgentModelOverride, type ModelEntry } from '@/lib/opencode/model-pick';
import { sortVariants } from '@/lib/ai/effort';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Model picker:
 * - GET  → daftar model per provider (Gratis / yang butuh login) + pilihan tersimpan.
 * - POST → set model utk session project ini + simpan ke settings.agentModelOverride
 *          format "providerID/modelID" (sekali set, semua session mengikuti).
 */

/** Entry model utk UI — plus daftar variant effort ASLI dari server OpenCode. */
export type ModelsEntry = ModelEntry & { variants: string[] };

export type ModelGroup = { providerID: string; label: string; free: boolean; models: ModelsEntry[] };

export async function GET() {
  try {
    const client = await ensureServer();
    const auth = await getAuthState();
    const models = (await client.model.list())?.data ?? [];

    const groups: ModelGroup[] = [];
    const push = (providerID: string, label: string, free: boolean, entries: ModelsEntry[]) => {
      if (entries.length > 0) groups.push({ providerID, label, free, models: entries });
    };

    // Group 1: model gratis provider 'opencode' (selalu ada, gak butuh login).
    const freeEntries: ModelsEntry[] = [];
    const freeSeen = new Set<string>();
    for (const m of models) {
      if (m?.providerID !== 'opencode' || !m?.id || freeSeen.has(m.id)) continue;
      freeSeen.add(m.id);
      freeEntries.push({
        providerID: 'opencode',
        modelID: m.id,
        name: m.name ?? m.id,
        variants: sortVariants((m.variants ?? []).map((v) => v.id)),
      });
    }
    push('opencode', 'Model gratis', true, freeEntries);

    // Group per provider lain yang sudah login (mis. openai/ChatGPT).
    for (const providerID of auth.providers.filter((p) => p !== 'opencode')) {
      const entries: ModelsEntry[] = [];
      const groupSeen = new Set<string>();
      for (const m of models) {
        if (m?.providerID !== providerID || !m?.id || groupSeen.has(m.id)) continue;
        groupSeen.add(m.id);
        entries.push({
          providerID,
          modelID: m.id,
          name: m.name ?? m.id,
          variants: sortVariants((m.variants ?? []).map((v) => v.id)),
        });
      }
      const label = providerID === 'openai' ? 'ChatGPT / OpenAI' : providerID;
      push(providerID, label, false, entries);
    }

    const overrideRaw = await readAgentModelOverride();

    // Override dipasangkan juga dgn variant model-nya (lookup dari groups) —
    // UI (composer/settings) nggak perlu fetch ulang buat tau batas effort.
    const override: ModelsEntry | null = overrideRaw
      ? {
          ...overrideRaw,
          variants:
            groups
              .flatMap((group) => group.models)
              .find((entry) => entry.providerID === overrideRaw.providerID && entry.modelID === overrideRaw.modelID)
              ?.variants ?? [],
        }
      : null;

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
