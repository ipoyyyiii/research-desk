/**
 * Preferensi editor per file .md.
 *
 * File .md bisa dibuka di tab Word (WordCraft) atau di editor teks. Tanpa
 * preferensi, klik file selalu membuka Word — padahal penulis yang sedang
 * merapikan markdown ingin langsung ke editor teks. Di sini pilihan terakhir
 * user diingat per path, jadi klik berikutnya langsung ke editor yang sama.
 */

export type EditorKind = 'word' | 'text';

const STORAGE_KEY = 'vibe-research:editor-pref';
const MAX_ENTRIES = 300;

type PrefMap = Record<string, EditorKind>;

function readMap(): PrefMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const map: PrefMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === 'word' || value === 'text') map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

export function readEditorPref(path: string): EditorKind {
  return readMap()[path] ?? 'word';
}

export function writeEditorPref(path: string, kind: EditorKind): void {
  if (typeof window === 'undefined') return;
  try {
    const map = readMap();
    map[path] = kind;
    const entries = Object.entries(map);
    const trimmed = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(-MAX_ENTRIES)) : map;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage penuh/diblokir: preferensi opsional, jangan ganggu alur buka file.
  }
}
