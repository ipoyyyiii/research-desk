import type { MatrixRow } from './types';

export type MatrixMarkdownLabels = {
  /** Baris judul Markdown, mis. "## Matriks Literatur". */
  heading: string;
  paper: string;
  tema: string;
  metode: string;
  temuan: string;
  kutipan: string;
};

/** GFM: pipa di dalam sel harus di-escape, newline diganti spasi. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Identitas paper untuk kolom Paper: judul + penulis + tahun. */
export function paperCell(row: MatrixRow): string {
  const authors = row.authors.join(', ');
  const year = row.year !== null ? String(row.year) : '';
  let suffix = '';
  if (authors && year) suffix = ` — ${authors} (${year})`;
  else if (authors) suffix = ` — ${authors}`;
  else if (year) suffix = ` (${year})`;
  return `**${row.title}**${suffix}`;
}

/** Tabel GFM siap tempel ke Bab 2 (judul + header + separator + isi). */
export function buildMatrixMarkdown(rows: MatrixRow[], labels: MatrixMarkdownLabels): string {
  const header = `| ${labels.paper} | ${labels.tema} | ${labels.metode} | ${labels.temuan} | ${labels.kutipan} |`;
  const divider = '| --- | --- | --- | --- | --- |';
  const body = rows.map(
    (row) =>
      `| ${cell(paperCell(row))} | ${cell(row.tema)} | ${cell(row.metode)} | ${cell(row.temuan)} | ${cell(row.kutipan)} |`,
  );
  return [labels.heading, '', header, divider, ...body].join('\n');
}
