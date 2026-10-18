/** Ekstensi berkas biner yang dirender PREVIEW di tab tengah (bukan editor teks). */
export function isPreviewBinary(path: string): boolean {
  return /\.(pdf|png|jpe?g|svg|webp|gif)$/i.test(path);
}

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}
