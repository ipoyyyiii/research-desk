import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';
import { getAuthState } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Alur "Sign in with ChatGPT" — DUA mode biar tahan-banting (apalagi user SSH):
 *
 * - mode "device" (chatgpt-headless): CLI nyetak KODE + URL statis
 *   (auth.openai.com/codex/device) → user buka di browser laptop sendiri,
 *   ketik kode. GAK butuh port forwarding — CLI polling token dari server.
 * - mode "link" (chatgpt-token-sharing): OAuth redirect ke 127.0.0.1:<port-acak>
 *   di mesin server. Normalnya butuh port forwarding VS Code; dipakai kalau
 *   user buka app dari browser mesin yang sama.
 */

const METHOD_FLAGS: Record<'device' | 'link', string[]> = {
  device: ['--method', 'chatgpt-headless'],
  link: ['--method', 'chatgpt-token-sharing'],
};

type ConnectEntry = {
  proc: ReturnType<typeof spawn> | null;
  method: 'device' | 'link';
  url: string | null;
  code: string | null;
  callbackPort: string | null;
  done: boolean;
};

const g = globalThis as unknown as { __rdOcConnect?: ConnectEntry };

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/[\u2500-\u257f\u2580-\u259f]/g, '');
}

function parseOutput(text: string, entry: ConnectEntry): void {
  const clean = stripAnsi(text);

  // Mode device: "Enter code: 36JL-LJYQD" + URL statis
  const codeMatch = clean.match(/Enter code:\s*([A-Za-z0-9-]{8,16})/);
  if (codeMatch) entry.code = codeMatch[1];
  const deviceUrl = clean.match(/https:\/\/auth\.openai\.com\/codex\/device/);
  if (deviceUrl) entry.url = deviceUrl[0];

  // Mode link: URL authorize penuh + callback port dari redirect_uri
  const linkUrl = clean.match(/https:\/\/auth\.openai\.com\/api\/accounts\/authorize\S+/);
  if (linkUrl) {
    entry.url = linkUrl[0];
    const portMatch = linkUrl[0].match(/redirect_uri=.*127\.0\.0\.1%3A(\d+)/);
    if (portMatch) entry.callbackPort = portMatch[1];
  }
}

function snapshot(entry: ConnectEntry | undefined) {
  if (!entry) {
    return { running: false, method: null, url: null, code: null, callbackPort: null, done: true };
  }
  return {
    running: !entry.done,
    method: entry.method,
    url: entry.url,
    code: entry.code,
    callbackPort: entry.callbackPort,
    done: entry.done,
  };
}

function startEntry(method: 'device' | 'link'): ConnectEntry {
  const proc = spawn('opencode', ['auth', 'login', 'openai', ...METHOD_FLAGS[method]], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entry: ConnectEntry = { proc, method, url: null, code: null, callbackPort: null, done: false };

  const onData = (chunk: Buffer) => parseOutput(chunk.toString(), entry);
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', () => {
    entry.done = true;
  });
  proc.on('exit', () => {
    entry.done = true;
  });

  g.__rdOcConnect = entry;
  return entry;
}

function killEntry(entry: ConnectEntry | undefined): void {
  if (!entry?.proc) return;
  try {
    entry.proc.kill();
  } catch {
    // sudah exit
  }
  entry.done = true;
}

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const method = (params.get('method') === 'link' ? 'link' : 'device') as 'device' | 'link';
  const restart = params.get('restart') === '1';

  // Sudah tersambung? tak perlu apa-apa.
  try {
    const status = await getAuthState();
    if (status.connected) {
      return NextResponse.json({ ...snapshot(undefined), connected: true });
    }
  } catch {
    // lanjut — status mungkin gagal; flow auth jalan terus
  }

  const current = g.__rdOcConnect;
  if (current && !current.done) {
    const sameMethod = current.method === method;
    if (sameMethod && !restart) {
      return NextResponse.json({ ...snapshot(current), connected: false });
    }
    killEntry(current);
  }

  const entry = startEntry(method);

  // Kasih waktu CLI nyetak URL/kode (biasanya instan, tapi siklonik).
  await new Promise((r) => setTimeout(r, 1_400));
  return NextResponse.json({ ...snapshot(entry), connected: false }, { status: 202 });
}

export async function GET() {
  const entry = g.__rdOcConnect;
  try {
    const { connected } = await getAuthState();
    if (connected) {
      killEntry(entry);
      return NextResponse.json({ ...snapshot(entry), connected: true });
    }
  } catch {
    // status gagal → belum terhubung
  }

  // Entry usang yang sudah selesai tapi gagal → pindih otomatis biar gak mentok.
  const snap = snapshot(entry);
  return NextResponse.json({ ...snap, connected: false });
}
