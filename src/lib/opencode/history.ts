import type { OpenCodeClient } from '@opencode/client';

/**
 * Riwayat chat persisten + token meter.
 *
 * Sumber kebenaran buat dua route (/api/ai/messages & /api/ai/usage):
 * buildHistory() baca context session (`client.session.context`) lalu map
 * jadi bentuk panel chat. Mapping tahan-banting (optional chaining +
 * fallback) karena bentuk payload bisa beda-beda antar versi service.
 */

export type HistoryToolEvent = {
  id: string;
  title: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
};

export type HistoryMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolEvents: HistoryToolEvent[];
  modelID?: string;
  providerID?: string;
  /** Token per turn assistant; null kalau service gak ngasih data (jangan nipu). */
  tokens?: { input: number; output: number } | null;
  createdAt: number;
};

export type BuiltHistory = {
  messages: HistoryMessage[];
  /** Sum token semua pesan assistant di session ini; null kalau belum ada data. */
  tokens: { input: number; output: number } | null;
};

/** Item mentah dari context — sengaja longgar biar gak crash kalau shape geser. */
type RawItem = {
  id?: string;
  type?: string;
  time?: { created?: number };
  text?: string;
  content?: unknown;
  data?: { text?: unknown };
  model?: { id?: string; providerID?: string };
  tokens?: { input?: number; output?: number };
};

/** Teks user utk display: buang dossier otomatis, tunjuk perintah user aja. */
export function userDisplayText(raw: string): string {
  if (!raw) return '';
  const marker = '[PERINTAH USER]';
  const idx = raw.indexOf(marker);
  if (idx >= 0) return raw.slice(idx + marker.length).trim();
  return raw.trim();
}

/**
 * Mapping judul/detail tool event.
 * Rule dibangun agar mirip toolTitle di agent-view (sana: state.title →
 * filePath → description → pattern → 'Aksi agent'; file itu gak boleh
 * disentuh jadi rule serupa di-duplikat di sini).
 */
function toolLabel(name: string, stateInput: unknown): { title: string; detail?: string } {
  const input = (stateInput ?? {}) as {
    path?: string;
    filePath?: string;
    file?: string;
    command?: string;
    code?: string;
    pattern?: string;
    query?: string;
    url?: string;
    description?: string;
    questions?: unknown;
  };
  const filePath = input.path ?? input.filePath ?? input.file ?? '';
  const base = filePath ? filePath.split('/').pop() ?? filePath : '';

  switch (name) {
    case 'read':
      return { title: base ? `Baca ${base}` : 'Baca file', detail: filePath || undefined };
    case 'grep':
    case 'list':
      return { title: 'Cari', detail: input.pattern || input.query || undefined };
    case 'glob':
      return { title: 'Cari file', detail: input.pattern || undefined };
    case 'write':
      return { title: base ? `Tulis ${base}` : 'Tulis file', detail: filePath || undefined };
    case 'edit':
      return { title: base ? `Ubah ${base}` : 'Ubah file', detail: filePath || undefined };
    case 'execute':
    case 'run': {
      const first = String(input.command ?? input.code ?? '')
        .split('\n')[0]
        .trim();
      const shown = first.length > 48 ? `${first.slice(0, 48)}…` : first;
      return { title: first ? `Jalankan ${shown}` : 'Jalankan perintah', detail: first || undefined };
    }
    case 'permission':
      return { title: 'Minta izin', detail: input.description || undefined };
    case 'question': {
      // Pertanyaan interaktif ke user — ambil pertanyaan pertamanya.
      const q = Array.isArray(input.questions) ? input.questions[0] : null;
      const question = q && typeof q === 'object' ? (q as { question?: unknown }).question : null;
      const text = typeof question === 'string' ? question : input.description || '';
      return { title: 'Pertanyaan agent', detail: text || undefined };
    }
    default: {
      // Tool belum dikenal → nama tool dibaca manusiawi + cuplikan input relevan.
      const detail = input.description || input.pattern || input.query || input.url || base || undefined;
      const title = name ? `${name[0].toUpperCase()}${name.slice(1)}` : 'Aksi agent';
      return { title, detail };
    }
  }
}

function toolStatus(stateStatus: unknown): HistoryToolEvent['status'] {
  const status = String(stateStatus ?? '');
  if (status === 'completed') return 'done';
  if (status === 'error' || status === 'failed') return 'error';
  return 'running';
}

/** Gabung semua part teks (type 'text' saja) — reasoning/tool gak ikut. */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    const p = part as { type?: unknown; text?: unknown };
    if (p?.type === 'text' && typeof p.text === 'string' && p.text) parts.push(p.text);
  }
  return parts.join('\n\n');
}

/** Full text mentah: bisa di top-level, di content, atau di data.text. */
function fullTextOf(item: RawItem): string {
  if (typeof item.text === 'string' && item.text) return item.text;
  const joined = textOfContent(item.content);
  if (joined) return joined;
  if (typeof item.data?.text === 'string') return item.data.text;
  return '';
}

/** Token top-level belanja assistant; null kalau gak utuh. */
function tokensOf(item: RawItem): { input: number; output: number } | null {
  const t = item.tokens;
  if (t && typeof t.input === 'number' && typeof t.output === 'number') {
    return { input: t.input, output: t.output };
  }
  return null;
}

/**
 * Note investigasi token (hasil probe service v2.0.32 + types SDK):
 * type 'assistant' (SessionMessageAssistant) punya field top-level
 * `tokens?: TokenUsageInfo` = { input, output, reasoning, cache:{read,write} }
 * (types.d.ts ~baris 3307/64). Pesan in-flight bisa gak punya tokens → null.
 */
function mapItem(item: RawItem, index: number): HistoryMessage | null {
  const type = item?.type;
  // Type aneh (model-switched, compaction, pathway lain) dibuang — gak ada nilai UI.
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return null;

  const toolEvents: HistoryToolEvent[] = [];
  if (type === 'assistant' && Array.isArray(item.content)) {
    item.content.forEach((part, i) => {
      const p = part as { type?: unknown; id?: unknown; name?: unknown; state?: unknown };
      if (p?.type !== 'tool') return;
      const state = (p.state ?? {}) as { status?: unknown; input?: unknown };
      const label = toolLabel(typeof p.name === 'string' ? p.name : '', state.input);
      toolEvents.push({
        id: typeof p.id === 'string' && p.id ? p.id : `${item.id ?? 'evt'}#${i}`,
        title: label.title,
        detail: label.detail,
        status: toolStatus(state.status),
      });
    });
  }

  // Pesan sakit/kosong dibuang biar gak ada bubble hampa di UI.
  const text = type === 'user' ? userDisplayText(fullTextOf(item)) : fullTextOf(item);
  if (type === 'user' && !text) return null;
  if (type === 'system' && !text) return null;
  if (type === 'assistant' && !text && toolEvents.length === 0) return null;

  const model = item.model;
  return {
    id: item.id ?? `msg-${index}`,
    role: type,
    text,
    toolEvents,
    modelID: model?.id && typeof model.id === 'string' ? model.id : undefined,
    providerID: model?.providerID && typeof model.providerID === 'string' ? model.providerID : undefined,
    tokens: type === 'assistant' ? tokensOf(item) : null,
    createdAt: item.time?.created ?? 0,
  };
}

/** Baca context session → pesan utk UI + sum token. Dipakai messages & usage. */
export async function buildHistory(client: OpenCodeClient, sessionId: string): Promise<BuiltHistory> {
  // SDK balikin array langsung (sudah diuji); fallback { data } biar tahan versi beda.
  const res = (await client.session.context({ sessionID: sessionId })) as unknown;
  const items: RawItem[] = Array.isArray(res)
    ? (res as RawItem[])
    : Array.isArray((res as { data?: unknown })?.data)
      ? ((res as { data: RawItem[] }).data)
      : [];

  const messages: HistoryMessage[] = [];
  let input = 0;
  let output = 0;
  let hasTokens = false;
  items.forEach((item, index) => {
    const mapped = mapItem(item, index);
    if (!mapped) return;
    if (mapped.tokens) {
      input += mapped.tokens.input;
      output += mapped.tokens.output;
      hasTokens = true;
    }
    messages.push(mapped);
  });

  return { messages, tokens: hasTokens ? { input, output } : null };
}
