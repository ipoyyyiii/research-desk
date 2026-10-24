/**
 * Ambil gambar-gambar dari sebuah laporan markdown.
 *
 * Laporan statistik menyisipkan grafik sebagai `![alt](gambar/x.png)` diikuti
 * baris caption `**Gambar 4.1** Judul`. Fungsi ini memisahkan keduanya supaya
 * satu gambar bisa dipindah ke bab dengan nomor baru (mengikuti bab tujuan).
 */

export type MarkdownFigure = {
  /** Urutan gambar di dalam file (0-based). */
  index: number;
  /** Alt text markdown (dipakai kalau caption tidak ada). */
  alt: string;
  /** Path gambar (relatif terhadap folder project). */
  path: string;
  /** Caption tanpa nomor ("Histogram sebaran y"), kalau ada. */
  caption: string;
  /** Blok gambar asli + caption, siap ditempel. */
  markdown: string;
};

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const CAPTION_PATTERN = /^\s*\*\*Gambar\s+\d+(?:\.\d+)?\*\*\s*(.+?)\s*$/i;

export function extractFigures(markdown: string): MarkdownFigure[] {
  const lines = markdown.split(/\r?\n/);
  const figures: MarkdownFigure[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(IMAGE_PATTERN);
    if (!match) continue;
    // `match` bisa berisi beberapa gambar dalam satu baris; ambil yang pertama.
    const single = lines[i].match(/!\[([^\]]*)\]\(([^)\s]+)\)/);
    if (!single) continue;

    // Caption: baris berikutnya (boleh dipisah satu baris kosong).
    let caption = '';
    let endLine = i;
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j += 1) {
      const found = lines[j].match(CAPTION_PATTERN);
      if (found) {
        caption = found[1].trim();
        endLine = j;
        break;
      }
      if (lines[j].trim() !== '') break;
    }

    figures.push({
      index: figures.length,
      alt: single[1].trim(),
      path: single[2].trim(),
      caption,
      markdown: lines.slice(i, endLine + 1).join('\n'),
    });
    i = endLine;
  }

  return figures;
}
