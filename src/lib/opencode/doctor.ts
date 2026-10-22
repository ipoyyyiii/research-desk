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
  /** Model lain di provider ini yang ternyata bisa dipakai (kalau ketemu). */
  workingModel?: string;
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

async function probeModel(
  client: OpenCodeClient,
  probeDir: string,
  providerID: string,
  modelID: string,
  timeoutMs = 35_000,
): Promise<{ ok: boolean; message: string }> {
  let sessionID: string | null = null;
  try {
    const created = await client.session.create({
      title: 'diagnosa',
      location: { directory: probeDir },
    });
    sessionID = (created as { data?: { id?: string }; id?: string }).data?.id ??
      (created as { id?: string }).id ??
      null;
    if (!sessionID) return { ok: false, message: 'Gagal bikin sesi probe' };
    await client.session.switchModel({
      sessionID,
      model: { providerID, id: modelID },
    });
    await client.session.prompt({ sessionID, text: 'kopi' });
    return await readSessionOutcome(client, sessionID, timeoutMs);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (sessionID) {
      await client.session.remove({ sessionID }).catch(() => undefined);
    }
  }
}

export async function runDoctor(
  client: OpenCodeClient,
  candidates: Array<{ providerID: string; modelID: string }>,
  alternatives: Record<string, string[]> = {},
): Promise<DoctorReport> {
  const probeDir = path.join(os.tmpdir(), 'research-desk-ai-probe');
  await fs.mkdir(probeDir, { recursive: true });
  const findings: DoctorFinding[] = [];

  const probedProviders = new Set<string>();
  for (const candidate of candidates) {
    // Probe pertama sebuah provider boleh lama: provider gratis harus spawn
    // proses dulu, call pertama bisa makan ~1 menit.
    const firstProbe = !probedProviders.has(candidate.providerID);
    probedProviders.add(candidate.providerID);
    const outcome = await probeModel(
      client,
      probeDir,
      candidate.providerID,
      candidate.modelID,
      firstProbe ? 90_000 : 35_000,
    );
    const status = outcome.ok ? 'ok' : classify(outcome.message);
    const finding: DoctorFinding = {
      providerID: candidate.providerID,
      label: LABELS[candidate.providerID] ?? candidate.providerID,
      modelID: candidate.modelID,
      status,
      message: outcome.message,
    };

    // Model yang ditolak ≠ semua model di provider itu ditolak. Coba beberapa
    // model lain sampai ketemu yang bisa dipakai, biar user bisa langsung
    // pindah ke model itu. Katalog ChatGPT urutannya panjang dan model yang
    // kepakai bisa ada di urutan mana saja.
    if (status === 'not-supported' || status === 'no-model') {
      for (const modelID of (alternatives[candidate.providerID] ?? []).slice(0, 10)) {
        if (modelID === candidate.modelID) continue;
        const alt = await probeModel(client, probeDir, candidate.providerID, modelID);
        if (alt.ok) {
          finding.workingModel = modelID;
          break;
        }
      }
    }

    findings.push(finding);
  }

  await fs.rm(probeDir, { recursive: true, force: true }).catch(() => undefined);
  return { findings, checkedAt: new Date().toISOString() };
}
