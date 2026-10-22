import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OpenCode, type OpenCodeClient } from '@opencode/client';

/**
 * Service layer OpenCode utk app Vibe Research.
 *
 * OpenCode menjalankan "background service" satu per mesin (opencode serve --service)
 * dan menulis discovery-nya ke ~/.local/state/opencode/service.json:
 *   { url, password, pid, version, id }
 * App cukup membaca file itu + Basic auth (user:"opencode", pass:password).
 * Kalau service belum jalan → app spawn-nya sendiri (loopback), lalu baca ulang.
 *
 * Bonus strategis: service ini SATU dgn data milik CLI `opencode` user —
 * session, riwayat, dan auth semua nyatu.
 */

type ServiceRef = { url: string; password: string; pid?: number };

const PROCESS_NAME_USER = 'opencode';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Baca service discovery terakhir yang masih hidup. */
export function readServiceDiscovery(): ServiceRef | null {
  try {
    const dir = path.join(os.homedir(), '.local', 'state', 'opencode');
    const names = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('service.') && f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a));
    for (const name of names) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as {
        url?: string;
        password?: string;
        pid?: number;
      };
      if (!raw.url || !raw.password) continue;
      if (raw.pid && !isAlive(raw.pid)) continue;
      return { url: raw.url.replace('localhost', '127.0.0.1'), password: raw.password, pid: raw.pid };
    }
  } catch {
    // belum ada / belum siap
  }
  return null;
}

function makeClient(svc: ServiceRef): OpenCodeClient {
  const basic = Buffer.from(`${PROCESS_NAME_USER}:${svc.password}`).toString('base64');
  return OpenCode.make({ baseUrl: svc.url, headers: { authorization: `Basic ${basic}` } });
}

export class OpenCodeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type OcStore = {
  client: OpenCodeClient | null;
  starting: Promise<OpenCodeClient> | null;
};

const g = globalThis as unknown as { __rdOc?: OcStore };

function store(): OcStore {
  g.__rdOc ??= { client: null, starting: null };
  return g.__rdOc;
}

async function probe(client: OpenCodeClient, timeoutMs: number): Promise<OpenCodeClient | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.server.info();
      return client;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

/** Client SDK siap pakai — pakai service background existing, spawn kalau belum ada. */
export function ensureServer(): Promise<OpenCodeClient> {
  const s = store();
  if (s.client) return Promise.resolve(s.client);
  if (s.starting) return s.starting;

  s.starting = (async () => {
    // 1) Service yang sudah ada (beserta service milik CLI user)?
    let svcRef = readServiceDiscovery();
    if (svcRef) {
      const client = await probe(makeClient(svcRef), 5_000);
      if (client) {
        s.client = client;
        return client;
      }
      svcRef = null;
    }

    // 2) Belum ada → spawn sendiri (service mode: menulis discovery sendiri).
    spawn('opencode', ['serve', '--service'], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env },
    }).unref();

    // Tunggu file discovery muncul + port siap.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const ref = readServiceDiscovery();
      if (ref) {
        const client = await probe(makeClient(ref), 5_000);
        if (client) {
          s.client = client;
          return client;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new OpenCodeError('SERVICE_TIMEOUT', 'Service OpenCode tidak bisa dihidupkan');
  })();

  s.starting.catch(() => {
    s.starting = null;
  });
  return s.starting;
}

/** Status auth: provider selain "opencode" internal (mis. chatgpt) tersambung? */
export async function getAuthState(): Promise<{ connected: boolean; providers: string[] }> {
  const client = await ensureServer();
  try {
    const res = await client.provider.list();
    const data = Array.isArray(res?.data) ? res.data : [];
    const providers = data
      .map((p) => p.id ?? p.name)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const connected = providers.some((id) => id !== 'opencode');
    return { connected, providers };
  } catch {
    return { connected: false, providers: [] };
  }
}
