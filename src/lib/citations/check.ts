/**
 * Cek konsistensi sitasi `[@key]` di markdown vs daftar pustaka (references.bib).
 * Dipakai dua tempat: warning saat ekspor + dialog "cek konsistensi".
 */

const BRACKET = /\[([^[\]]+)\]/g;
/**
 * Key di dalam bracket sitasi — dukung `[@key]`, `[@key, p. 5]`, `[@a; @b]`,
 * dan suppress `-@key`. Key tanpa spasi.
 */
const CITE_KEY = /-?@([A-Za-z0-9_][A-Za-z0-9_:.-]*)/g;

/** Semua citation key yang muncul (unik, urut kemunculan pertama). */
export function extractCitationKeys(markdown: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let bracket: RegExpExecArray | null;
  while ((bracket = BRACKET.exec(markdown)) !== null) {
    const inner = bracket[1];
    if (!inner.includes('@')) continue;
    let cite: RegExpExecArray | null;
    CITE_KEY.lastIndex = 0;
    while ((cite = CITE_KEY.exec(inner)) !== null) {
      const key = cite[1];
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

export type CitationCheckResult = {
  /** Key yang dikutip di teks (unik). */
  cited: string[];
  /** Dikutip tapi tidak ada di daftar pustaka. */
  missing: string[];
  /** Ada di pustaka tapi tidak pernah dikutip. */
  unused: string[];
};

export function checkCitations(markdown: string, bibKeys: string[]): CitationCheckResult {
  const cited = extractCitationKeys(markdown);
  const bibSet = new Set(bibKeys);
  const citedSet = new Set(cited);
  return {
    cited,
    missing: cited.filter((key) => !bibSet.has(key)),
    unused: bibKeys.filter((key) => !citedSet.has(key)),
  };
}
