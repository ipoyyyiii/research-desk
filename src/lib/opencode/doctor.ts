import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { OpenCodeClient } from '@opencode/client';

/**
 * Diagnosa konektivitas AI.
 *
 * `getAuthState().connected` cuma cek provider TERDAFTAR, jadi UI bisa ngaku
 * "terhubung" padahal semua modelnya ditolak server (mis. akun ChatGPT tanpa
 * entitlement Codex, atau free tier habis). Diagnosa ini probe beneran: kirim
 * satu prompt pendek ke satu model per provider, terus baca error-nya.
 *
 * Sesi probe dibuat di folder temp, bukan folder project, jadi daftar sesi
 * user gak jadi kotor.
 */

export type DoctorStatus = 'ok' | 'free-limit' | 'not-supported' | 'no-model' | 'auth' | 'error';

export type DoctorFinding = {
  providerID: string;
  label: string;
  modelID: string;
  status: DoctorStatus;
  message: string;
};

export type DoctorReport = {
  findings: DoctorFinding[];
  checkedAt: string;
};

const LABELS: Record<string, string> = {
  opencode: 'Model gratis',
  openai: 'ChatGPT / OpenAI',
};

function classify(message: string): DoctorStatus {
  const m = message.toLowerCase();
  if (m.includes('free usage limit') || m.includes('freeusagelimiterror') || m.includes('rate limit')) {
    return 'free-limit';
  }
  if (m.includes('not supported when using codex') || m.includes('not supported with a chatgpt account')) {
    return 'not-supported';
  }
  if (m.includes('model unavailable') || m.includes('model not found')) return 'no-model';
  if (m.includes('unauthorized') || m.includes('forbidden') || m.includes('invalid api key')) return 'auth';
  return 'error';
}

async function readSessionOutcome(
  client: OpenCodeClient,
  sessionID: string,
  timeoutMs: number,
): Promise<{ ok: boolean; message: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const messages = await client.session.context({ sessionID });
      for (const message of messages) {
        if (message.type === 'assistant') {
          if (message.error?.message) return { ok: false, message: message.error.message };
          if (message.finish === 'error') {
            return { ok: false, message: 'Permintaan gagal tanpa pesan detail' };
          }
          const hasText = message.content.some(
            (part) => part.type === 'text' && part.text.trim().length > 0,
          );
          if (hasText) return { ok: true, message: 'Model menjawab normal' };
        }
        if (message.type === 'idle' && message.outcome === 'failed') {
          return { ok: false, message: message.error?.message ?? 'Permintaan gagal' };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('not found')) return { ok: false, message };
    }
  }
  return { ok: false, message: 'Model gak memberi jawaban dalam batas waktu' };
}

export async function runDoctor(
  client: OpenCodeClient,
  candidates: Array<{ providerID: string; modelID: string }>,
): Promise<DoctorReport> {
  const probeDir = path.join(os.tmpdir(), 'research-desk-ai-probe');
  await fs.mkdir(probeDir, { recursive: true });
  const findings: DoctorFinding[] = [];

  for (const candidate of candidates) {
    let sessionID: string | null = null;
    try {
      const created = await client.session.create({
        title: 'diagnosa',
        location: { directory: probeDir },
      });
      sessionID = (created as { data?: { id?: string }; id?: string }).data?.id ??
        (created as { id?: string }).id ??
        null;
      if (!sessionID) {
        findings.push({
          providerID: candidate.providerID,
          label: LABELS[candidate.providerID] ?? candidate.providerID,
          modelID: candidate.modelID,
          status: 'error',
          message: 'Gagal bikin sesi probe',
        });
        continue;
      }
      await client.session.switchModel({
        sessionID,
        model: { providerID: candidate.providerID, id: candidate.modelID },
      });
      await client.session.prompt({ sessionID, text: 'kopi' });
      const outcome = await readSessionOutcome(client, sessionID, 45_000);
      findings.push({
        providerID: candidate.providerID,
        label: LABELS[candidate.providerID] ?? candidate.providerID,
        modelID: candidate.modelID,
        status: outcome.ok ? 'ok' : classify(outcome.message),
        message: outcome.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      findings.push({
        providerID: candidate.providerID,
        label: LABELS[candidate.providerID] ?? candidate.providerID,
        modelID: candidate.modelID,
        status: classify(message),
        message,
      });
    } finally {
      if (sessionID) {
        await client.session.remove({ sessionID }).catch(() => undefined);
      }
    }
  }

  await fs.rm(probeDir, { recursive: true, force: true }).catch(() => undefined);
  return { findings, checkedAt: new Date().toISOString() };
}
