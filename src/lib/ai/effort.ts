/**
 * Level kerja ("effort") untuk model AI — menu Settings.
 *
 * Catatan jujur: plumbing sampling ke provider masih waktu yang akan datang;
 * nilai disimpen & ditampilkan dulu. mapping di bawah ini keyword-based
 * best-effort sebagai batas tampilan UI, bukan kontrak resmi provider.
 */

export type EffortLevel = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Semua level urut (auto, low, medium, high, xhigh, max). */
export const EFFORT_LEVELS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[];

/** Cek string dari storage/payload valid sebagai EffortLevel. */
export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Cap maksimal effort untuk sebuah model (keyword-based, best-effort):
 * - 'flash'/'fast'/'free'/'mini' → cap medium (model cepat/murah).
 * - keluarga premium (gpt-5, o3, opus, sonnet, gemini-2, glm-4/5) → cap max.
 * - deepseek non-flash → high; selain itu (unknown/provider lokal) → high
 *   default ('xhigh' memang belum dijanjikan provider lokal).
 */
export function maxModelEffort(modelId: string): EffortLevel {
  const id = modelId.toLowerCase();
  if (id.includes('flash') || id.includes('fast') || id.includes('free') || id.includes('mini')) return 'medium';
  if (
    id.includes('gpt-5') ||
    id.includes('o3') ||
    id.includes('opus') ||
    id.includes('sonnet') ||
    id.includes('gemini-2') ||
    id.includes('glm-4') ||
    id.includes('glm-5')
  ) {
    return 'max';
  }
  if (id.includes('deepseek')) return 'high';
  return 'high';
}
