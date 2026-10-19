import { eq } from 'drizzle-orm';
import type { OpenCodeClient } from '@opencode/client';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { getAuthState } from '@/lib/opencode/service';

/**
 * Aturan pemilihan model agent (satu kejujuran, dua pikingan):
 * 1. `settings.agentModelOverride` di-set user lewat model picker → MENANG.
 * 2. Tanpa override: auto ChatGPT kalau provider openai tersambung.
 * 3. Selain itu: default service (model gratis).
 */

export type ModelEntry = { providerID: string; modelID: string; name: string };

export async function readAgentModelOverride(): Promise<ModelEntry | null> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    const raw = rows[0]?.agentModelOverride;
    if (!raw || typeof raw !== 'string') return null;
    const [providerID, ...rest] = raw.split('/');
    const modelID = rest.join('/');
    if (!providerID || !modelID) return null;
    return { providerID, modelID, name: modelID };
  } catch {
    return null;
  }
}

/** Terapkan model (plus variant effort optional) yang benar ke session —
 * tanpa error kalau server ribet. variant = id variant ASLI dari model
 * (effort ala OpenCode); null/undefined = biarkan bawaan. */
export async function applyModelToSession(
  client: OpenCodeClient,
  sessionId: string,
  variant?: string | null,
): Promise<string | null> {
  try {
    const current = await client.session.get({ sessionID: sessionId });
    const applied = current?.model as { providerID?: string; id?: string; variant?: string } | undefined;

    let desired: ModelEntry | null = await readAgentModelOverride();
    if (!desired) {
      const auth = await getAuthState();
      if (auth.connected) {
        try {
          const models = (await client.model.list())?.data ?? [];
          const openaiModel = models.find((m) => m.providerID === 'openai');
          if (openaiModel?.id) {
            desired = { providerID: 'openai', modelID: openaiModel.id, name: openaiModel.name ?? openaiModel.id };
          }
        } catch {
          return null;
        }
      }
    }
    if (!desired) return null;

    // Skip RPC cuma kalau model DAN variant-nya udah pas.
    if (
      applied?.providerID === desired.providerID &&
      applied?.id === desired.modelID &&
      (variant ? applied.variant === variant : true)
    ) {
      return `${desired.providerID}/${desired.modelID}`;
    }
    await client.session.switchModel({
      sessionID: sessionId,
      model: { providerID: desired.providerID, id: desired.modelID, ...(variant ? { variant } : {}) },
    });
    return `${desired.providerID}/${desired.modelID}`;
  } catch {
    return null;
  }
}
