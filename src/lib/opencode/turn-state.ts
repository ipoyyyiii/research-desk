/**
 * Status "ngetik" (busy) punya dua sumber: event SSE dari service, dan
 * kenyataan di server. Event SSE bisa kelewat (EventSource reconnect, stream
 * putus, event datang sebelum listener siap). Kalau cuma andalkan event itu,
 * indikator "Ngetik..." nyangkut selamanya.
 *
 * Modul ini berisi satu fungsi murni yang memutuskan "turn ini sudah selesai
 * belum?" dari riwayat server. Dipakai watchdog di UI, dan diuji terpisah.
 */

export type TurnMessage = {
  role: 'user' | 'assistant' | 'system';
  /** Balasan assistant yang sudah selesai (punya `time.completed`). */
  finished?: boolean;
  createdAt?: number;
  toolEvents?: Array<{ status?: string }>;
};

export type TurnDecision = 'done' | 'running' | 'unknown';

/**
 * - `done`    → ada balasan assistant SELESAI yang dibuat setelah turn dimulai
 *               → turn sudah selesai, indikator ngetik boleh dimatikan.
 * - `running` → ada balasan assistant dari turn ini yang BELUM selesai
 *               → agent masih kerja, biarkan.
 * - `unknown` → belum ada jejak balasan untuk turn ini (model masih mikir,
 *               provider lambat, atau model free harus nyalain proses dulu)
 *               → jangan simpulkan apa-apa.
 */
export function turnFinished(messages: TurnMessage[], turnStartedAt: number): TurnDecision {
  const mine = messages.filter(
    (message) => message.role === 'assistant' && (message.createdAt ?? 0) >= turnStartedAt,
  );
  if (mine.length === 0) return 'unknown';

  const last = mine[mine.length - 1];
  const hasRunningTool = (last.toolEvents ?? []).some((event) => event.status === 'running');
  if (hasRunningTool) return 'running';
  return last.finished ? 'done' : 'running';
}
