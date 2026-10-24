/**
 * Ambil tabel-tabel GFM dari sebuah markdown.
 *
 * Laporan hasil analisis (dari scripts/uji-statistik.py) isinya banyak tabel
 * markdown. User biasanya cuma mau satu tabel tertentu yang masuk ke bab,
 * jadi tabelnya dipisah-pisah dulu, lengkap sama judulnya.
 */

export type MarkdownTable = {
  /** Urutan tabel di dalam file (0-based). */
  index: number;
  /** Judul tabel — heading terdekat di atasnya, atau baris teks sebelum tabel. */
  caption: string;
  /** Isi baris header. */
  header: string[];
  /** Isi baris data. */
  rows: string[][];
  /** Tabel markdown utuh, siap disisipkan. */
  markdown: string;
};

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

export function extractTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim().startsWith('|') || i + 1 >= lines.length || !isSeparator(lines[i + 1])) {
      i += 1;
      continue;
    }
    const header = splitRow(line);
    const body: string[][] = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      body.push(splitRow(lines[j]));
      j += 1;
    }

    // Judul tabel: caption eksplisit dulu, lalu heading seksi, lalu kosong.
    // Sengaja TIDAK memungut baris prosa acak: catatan seperti "statistik
    // dihitung pairwise" bukan judul tabel dan bikin caption salah di bab.
    let caption = '';
    for (let k = i - 1; k >= 0 && k >= i - 3; k -= 1) {
      const candidate = lines[k].trim();
      if (!candidate) continue;
      const explicit = candidate.match(/^\*\*Tabel\s+[0-9]+(?:\.[0-9]+)*\.?\*\*\s*(.*)$/i);
      if (explicit) {
        caption = explicit[1].trim();
        break;
      }
      const bold = candidate.match(/^\*\*([^*]{3,80})\*\*$/);
      if (bold) {
        caption = bold[1].trim();
        break;
      }
      break; // ketemu teks biasa lebih dekat daripada heading -> jangan pungut
    }
    if (!caption) {
      for (let k = i - 1; k >= 0 && k >= i - 6; k -= 1) {
        const heading = lines[k].trim().match(/^#{1,6}\s+(.*)$/);
        if (heading) {
          caption = heading[1].trim();
          break;
        }
      }
    }
    // Nomor bagian dari laporan ("4. Korelasi Pearson") bukan bagian dari
    // judul tabel — dibuang, soalnya tabelnya sendiri udah dikasih nomor.
    caption = caption.replace(/^\d+[.)]\s*/, '').trim();

    const markdownBlock = lines.slice(i, j).join('\n');
    tables.push({ index: tables.length, caption, header, rows: body, markdown: markdownBlock });
    i = j;
  }

  return tables;
}

/** Nomor bab dari nama file (bab1-... → 1) atau heading "# BAB I" → 1. */
export function chapterNumber(chapterPath: string, content: string): number | null {
  const fromName = chapterPath.match(/bab\s*(\d+)/i);
  if (fromName) return Number(fromName[1]);
  const fromHeading = content.match(/^#\s*BAB\s+([IVXLCDM]+|\d+)/im);
  if (!fromHeading) return null;
  const raw = fromHeading[1].toUpperCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  const roman: Record<string, number> = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  };
  return roman[raw] ?? null;
}
