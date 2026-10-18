/**
 * Outline bab: hitung kata + judul per file .md (tanpa deps).
 * Gak parse heading di dalam file — skripsi gak tuh: satu file = satu bab,
 * jadi "outline bab" = daftar berkas dokumen/*.md + hitungan katanya.
 */

/** Hitungan kata kasar (abaikan markdown syntax di panjang — cukup buat target). */
export function countMarkdownWords(markdown: string): number {
  // Buang blok kode & tag html inline biar angka gak meleset jauh.
  const body = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*?\]\([^)]*?\)/g, ' ');
  const matches = body.match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu);
  return matches ? matches.length : 0;
}

/** Judul bab: heading `#` pertama; kalau gak ada, judul file dipakai pemanggil. */
export function firstHeading(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}
