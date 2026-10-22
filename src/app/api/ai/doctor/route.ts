import { NextResponse } from 'next/server';
import { ensureServer, getAuthState } from '@/lib/opencode/service';
import { readAgentModelOverride } from '@/lib/opencode/model-pick';
import { runDoctor } from '@/lib/opencode/doctor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET → diagnosa konektivitas AI.
 *
 * Provider "terdaftar" ≠ model "bisa dipakai". Endpoint ini probe beneran
 * (satu model per provider) lalu kelasifikasi error-nya, biar user tahu
 * harus logout/login ulang, ganti key, atau nunggu kuota free habis.
 */
export async function GET() {
  try {
    const client = await ensureServer();
    const auth = await getAuthState();
    const models = (await client.model.list())?.data ?? [];
    const override = await readAgentModelOverride().catch(() => null);

    // Satu kandidat per provider. Model yang DIPILIH user didahulukan supaya
    // diagnosa menguji provider yang memang dipakai, bukan model katalog pertama.
    const candidates: Array<{ providerID: string; modelID: string }> = [];
    const seen = new Set<string>();
    if (override) {
      candidates.push({ providerID: override.providerID, modelID: override.modelID });
      seen.add(override.providerID);
    }
    // Semua model tiap provider — dipakai buat nyari yang ternyata bisa dipakai.
    const alternatives: Record<string, string[]> = {};
    for (const model of models) {
      if (!model?.providerID || !model?.id) continue;
      const list = (alternatives[model.providerID] ??= []);
      if (!list.includes(model.id)) list.push(model.id);
      if (seen.has(model.providerID)) continue;
      seen.add(model.providerID);
      candidates.push({ providerID: model.providerID, modelID: model.id });
    }

    const report = await runDoctor(client, candidates, alternatives);
    return NextResponse.json({ ...report, connected: auth.connected, providers: auth.providers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Diagnosa gagal';
    return NextResponse.json({ error: message, findings: [] }, { status: 500 });
  }
}
