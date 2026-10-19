/**
 * Level kerja ("effort") untuk model AI — sumber kebenaran: **variants** dari
 * server OpenCode (client.model.list() → m.variants). Tiap model punya daftar
 * variant miliknya sendiri (mis. flash → ["low","high","max"], beam/gpt-6 →
 * sampai "max", sebagian model bisa tanpa variant sama sekali). Nggak ada lagi
 * cap keyword buatan — UI mengikuti persis apa yang server laporkan.
 *
 * Variant dikirim asli ke session via client.session.switchModel({ variant })
 * (perilaku OpenCode). Nilai disimpan global di settings.effort sebagai string
 * variant apa adanya; null / 'auto' = bawaan model, nggak ngirim variant.
 */

/** Urutan kanonik tingkat effort buat sortir display (server biasanya sudah urut). */
export const VARIANT_RANK: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

/** Key i18n label per variant; variant tak dikenal ditampilkan apa adanya. */
export const VARIANT_LABEL_KEYS: Record<string, string> = {
  none: 'settings.effortNone',
  minimal: 'settings.effortMinimal',
  low: 'settings.effortLow',
  medium: 'settings.effortMedium',
  high: 'settings.effortHigh',
  xhigh: 'settings.effortXHigh',
  max: 'settings.effortMax',
};

/** Sortir id variant (id tak dikenal ditumpuk di belakang, tetap tampil). */
export function sortVariants(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (VARIANT_RANK[a] ?? 99) - (VARIANT_RANK[b] ?? 99));
}

/** Nilai effort yang valid disimpan/kirim: token variant pendek (≤24 char). */
export function isEffortValue(value: string): boolean {
  return /^[a-z0-9_-]{1,24}$/i.test(value);
}
