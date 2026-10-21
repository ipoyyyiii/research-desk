#!/usr/bin/env node
// Generate templates/skripsi-reference.docx — template DOCX untuk ekspor skripsi.
//
// Pandoc memakai "reference doc" untuk style (font, spasi baris) dan ukuran
// halaman (margin) hasil ekspor. Template ini meniru ketentuan umum skripsi
// Indonesia: Times New Roman 12pt, spasi baris 1.5, A4, margin atas 4cm dan
// sisi 3cm.
//
// Jalankan ulang kalau perlu ganti style:  node scripts/make-reference-docx.mjs
// Butuh: pandoc + jszip (keduanya sudah dipakai app ini).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'templates', 'skripsi-reference.docx');

const FONT = 'Times New Roman';
const FONT_TAG =
  `<w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" />`;

// 1 cm = 1440 twips / 2.54 cm = 566.93 twips
const CM = (cm) => Math.round(cm * 566.93);
const A4_W = 11906;
const A4_H = 16838;

function patchStyles(xml) {
  // Default dokumen: font + ukuran + spasi baris 1.5 tanpa jarak antarparagraf.
  let out = xml.replace(
    /<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/,
    `<w:rPrDefault><w:rPr>${FONT_TAG}<w:sz w:val="24" /><w:szCs w:val="24" /><w:lang w:val="id-ID" w:eastAsia="id-ID" w:bidi="ar-SA" /></w:rPr></w:rPrDefault>`,
  );
  out = out.replace(
    /<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/,
    `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto" /></w:pPr></w:pPrDefault>`,
  );
  // Style lain (Heading, Title, Caption, dst) ikut font Times New Roman;
  // ukuran dan tebalnya dibiarkan apa adanya.
  out = out.replace(/<w:rFonts\b[^>]*\/>/g, FONT_TAG);
  return out;
}

function patchDocument(xml) {
  const sectPr =
    `<w:sectPr>` +
    `<w:pgSz w:w="${A4_W}" w:h="${A4_H}" />` +
    `<w:pgMar w:top="${CM(4)}" w:right="${CM(3)}" w:bottom="${CM(3)}" w:left="${CM(3)}" ` +
    `w:header="${CM(1.25)}" w:footer="${CM(1.25)}" w:gutter="0" />` +
    `<w:cols w:space="708" /><w:docGrid w:linePitch="360" />` +
    `</w:sectPr>`;
  if (/<w:sectPr\s*\/>/.test(xml)) return xml.replace(/<w:sectPr\s*\/>/, sectPr);
  if (/<w:sectPr[\s\S]*?<\/w:sectPr>/.test(xml)) {
    return xml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/, sectPr);
  }
  return xml.replace('</w:body>', `${sectPr}</w:body>`);
}

const base = execFileSync('pandoc', ['--print-default-data-file', 'reference.docx'], {
  maxBuffer: 32 * 1024 * 1024,
});
const zip = await JSZip.loadAsync(base);

const styles = await zip.file('word/styles.xml').async('string');
const document = await zip.file('word/document.xml').async('string');

zip.file('word/styles.xml', patchStyles(styles));
zip.file('word/document.xml', patchDocument(document));

const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`reference docx ditulis: ${path.relative(ROOT, OUT)} (${out.length} B)`);
