import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';
import { getAuthState } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/connect — mulai alur "Sign in with ChatGPT".
 * Menjalankan `opencode auth login openai --method chatgpt-token-sharing` di server
 * (headless), menangkap URL otorisasi, mengembalikan ke UI.
 * GET /api/ai/connect — status: { running, url, done }
 */

const g = globalThis as unknown as {
  __rdOcConnect?: { proc: ReturnType<typeof spawn>; url: string | null; done: boolean };
};

function stripAnsi(text: string): string {
  // oxox ANSI CSI + karakter box
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/[\u2500-\u257f\u2580-\u259f]/g, '');
}

function extractAuthUrl(text: string): string | null {
  const match = text.match(/https:\/\/auth\.openai\.com\S+/);
  return match ? match[0] : null;
}

export async function POST() {
  try {
    const status = await getAuthState();
    if (status.connected) {
      return NextResponse.json({ running: false, url: null, done: true });
    }
  } catch {
    // tetap lanjut — status kemungkinan gagal krn service; auth flow tetap jalan
  }

  if (g.__rdOcConnect?.proc && !g.__rdOcConnect.done) {
    return NextResponse.json({ running: true, url: g.__rdOcConnect.url, done: false });
  }

  return new Promise<Response>((resolve) => {
    const proc = spawn('opencode', ['auth', 'login', 'openai', '--method', 'chatgpt-token-sharing'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: { proc: ReturnType<typeof spawn>; url: string | null; done: boolean } = {
      proc,
      url: null,
      done: false,
    };
    g.__rdOcConnect = entry;

    const onData = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      const found = extractAuthUrl(text);
      if (found) entry.url = found;
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', () => {
      entry.done = true;
    });
    proc.on('exit', () => {
      entry.done = true;
    });

    // Kasih waktu CLI nyetak URL (biasanya instan).
    setTimeout(() => {
      resolve(
        NextResponse.json(
          { started: true, running: true, url: entry.url },
          { status: 202 },
        ),
      );
    }, 1_200);
  });
}

export async function GET() {
  const entry = g.__rdOcConnect;
  if (!entry) return NextResponse.json({ running: false, url: null, done: true });
  try {
    const { connected } = await getAuthState();
    if (connected) {
      try {
        entry.proc.kill();
      } catch {
        // sudah exit
      }
      entry.done = true;
      return NextResponse.json({ running: false, url: entry.url, done: true, connected: true });
    }
  } catch {
    // status gagal → belum terhubung
  }
  return NextResponse.json({ running: !entry.done, url: entry.url, done: entry.done, connected: false });
}
