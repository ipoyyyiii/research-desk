import type { OpenCodeClient } from '@opencode/client';

/**
 * Daftar sesi agent untuk satu directory project + pemilihan sesi aktif.
 *
 * Sumber kebenaran = server OpenCode (client.session.list by directory) —
 * pola sama dengan route /api/ai/session & /messages (data[0] = paling baru).
 * Dipakai picker multi-sesi (strip Sessions di panel + slash menu composer).
 */

/** Bentuk ringkas khusus picker UI — title boleh kosong, UI jatuh ke id. */
export type SessionSummary = {
  id: string;
  title: string;
  /** Epoch ms (SessionInfo.time.created); 0 kalau server gak kasih. */
  timeCreated: number;
};

/**
 * List sesi per directory (order desc = paling mutakhir duluan, biar urutan
 * server dipertahankan — route lain sudah mengandalkan itu). Mapping
 * tahan-banting: bentuk payload yang geser tidak bikin crash.
 */
export async function listSessions(
  client: OpenCodeClient,
  directory: string,
): Promise<SessionSummary[]> {
  const res = (await client.session.list({ directory, order: 'desc' })) as unknown;
  const data: unknown[] = Array.isArray(res)
    ? res
    : Array.isArray((res as { data?: unknown[] })?.data)
      ? (res as { data: unknown[] }).data
      : [];

  const items: SessionSummary[] = [];
  for (const raw of data) {
    const item = (raw ?? {}) as {
      id?: unknown;
      title?: unknown;
      time?: { created?: unknown };
    };
    if (typeof item.id !== 'string' || item.id.length === 0) continue;
    items.push({
      id: item.id,
      title: typeof item.title === 'string' ? item.title : '',
      timeCreated: typeof item.time?.created === 'number' ? item.time.created : 0,
    });
  }
  return items;
}

/**
 * Session aktif = binding tersimpan (projects.opencode_session_id) kalau masih
 * ada di daftar server (session bisa dihapus/arsip di luar app); kalau tidak →
 * paling mutakhir directory, atau null (belum ada sesi sama sekali).
 */
export function pickActiveSessionId(
  sessions: SessionSummary[],
  boundId: string | null,
): string | null {
  if (boundId && sessions.some((item) => item.id === boundId)) return boundId;
  return sessions[0]?.id ?? null;
}
