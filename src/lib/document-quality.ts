/**
 * Kualitas draf: scan + auto-bersih file bab dari "sampah" yang bikin
 * hasil ekspor ketauan gak profesional (basa-basi agent, daftar pustaka
 * nyelip, catatan kutip, judul bab bentukan aneh).
 * Pure string — gak ada import, biar gampang dites via node/bundle.
 */

export type QualityRule = 'filler' | 'noteQuote' | 'bibSection' | 'midDot' | 'titleSplit' | 'ellipsis';

export type QualityIssue = {
  rule: QualityRule;
  line: number; // 1-based
  snippet: string;
  fixable: boolean;
};

// Kata basa-basi/sampah khas chat agent — cok kesel.
const FILLER = /\b(?:yuuhu+|wkwk+[a-z]*|ckck+|lol+|cok|test123|asdf+|lorem ipsum|placeholder|TODO|FIXME|XXX)\b/gi;

function isFence(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

/** Kompres whitespace sisa operasi (dobel spasi + spasi ganda). */
function tidy(text: string): string {
  return text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/** Scan file md → daftar temuan (baris 1-based). Blok kode di-skip. */
export function scanQuality(md: string): QualityIssue[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const issues: QualityIssue[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const text = heading[2];
      if (text.includes('·')) {
        issues.push({ rule: 'midDot', line: i + 1, snippet: line.trim(), fixable: true });
      }
      // Judul bab nangkeung kalimat body (artefak agen: "# BAB I · Pendahuluan Skripsi ini membahas …")
      if (/\b(?:Skripsi ini|Penelitian ini)\b/.test(text)) {
        issues.push({ rule: 'titleSplit', line: i + 1, snippet: line.trim(), fixable: true });
      }
      // Daftar pustaka nyelip di file bab — bikin rusak saat ekspor (dobel dgn citeproc).
      if (/^(?:Daftar\s*Pustaka|Bibliography)$/i.test(text.trim())) {
        issues.push({ rule: 'bibSection', line: i + 1, snippet: line.trim(), fixable: true });
      }
    }

    // Catatan metadata agent ("> **Catatan sumber:** …") nyangkut di badan dokumen.
    if (/^>\s*(?:\*\*)?Catatan\b/i.test(line)) {
      issues.push({ rule: 'noteQuote', line: i + 1, snippet: line.trim(), fixable: true });
    }

    FILLER.lastIndex = 0;
    if (FILLER.test(line)) {
      issues.push({ rule: 'filler', line: i + 1, snippet: line.trim(), fixable: true });
    }

    // Kalimat gantung "…" / "..." → butuh human isi (fix abis).
    if (line.includes('…') || /(^|\s)\.{3}(?:\s|$)/.test(line)) {
      issues.push({ rule: 'ellipsis', line: i + 1, snippet: line.trim(), fixable: false });
    }
  }

  return issues;
}

/**
 * Auto-perbaiki temuan yang aman: basa-basi, catatan kutip, daftar pustaka,
 * pemisah "·", plus split judul bab yang nangkeung kalimat body.
 * Balikin { md, fixed } — fixed = jumlah berkas baris diberesin.
 */
export function applyQualityFixes(md: string): { md: string; fixed: number } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let fixed = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isFence(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    // 1) Bass heading "Daftar Pustaka" + isinya (sitasi bernomor/catatan/kosong) dibuang sampe konten lain.
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading && /^(?:Daftar\s*Pustaka|Bibliography)$/i.test(heading[2].trim())) {
      fixed++;
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next.trim() === '' || /^\[\d+\]/.test(next.trim()) || /^\d+\.\s/.test(next.trim()) || /^>/.test(next)) {
          j++;
          continue;
        }
        break;
      }
      i = j - 1; // loop utama bakal maju ke j
      continue;
    }

    // 2) Heading split: judul bab dipisah dari kalimat body/ellipsis-nya.
    if (heading) {
      const text = heading[2];
      const splitMatch = /\b(?:Skripsi ini|Penelitian ini)\b/.exec(text);
      if (splitMatch) {
        const titlePart = tidy(text.slice(0, splitMatch.index).replace(/·/g, ' '));
        const bodyPart = tidy(text.slice(splitMatch.index).replace(FILLER, ' '));
        out.push(`${heading[1]} ${titlePart}`);
        if (bodyPart.length > 0) out.push('', bodyPart);
        fixed++;
        continue;
      }
      if (text.includes('·')) {
        out.push(`${heading[1]} ${tidy(text.replace(/·/g, ' '))}`);
        fixed++;
        continue;
      }
    }

    // 3) Catatan kutip dibuang maning.
    if (/^>\s*(?:\*\*)?Catatan\b/i.test(line)) {
      fixed++;
      continue;
    }

    // 4) Basa-basi standalone → bersihin token-nya.
    if (/\b(?:yuuhu+|wkwk+[a-z]*|ckck+|lol+|cok|test123|asdf+|lorem ipsum|placeholder|TODO|FIXME|XXX)\b/i.test(line)) {
      const cleaned = tidy(line.replace(FILLER, ''));
      if (cleaned.length === 0) continue; // baris murni basa-basi → dibuang
      out.push(cleaned);
      fixed++;
      continue;
    }

    out.push(line);
  }

  const result = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return { md: `${result}\n`, fixed };
}
