import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { BibEntry } from '@/lib/journals/bib';
import { buildWordSourcesXml } from './word-sources';

/**
 * Tempel data pustaka (`b:Sources`) ke DOCX hasil pandoc.
 *
 * Word/WordCraft membaca bibliography dari custom XML data store, bukan dari
 * teks daftar pustaka. Struktur yang dipakai sama dengan writer WordCraft:
 * - `customXml/itemN.xml`         → isi `<b:Sources>`
 * - `customXml/itemPropsN.xml`    → schemaRef ke vocabulary bibliography
 * - `customXml/_rels/itemN.xml.rels` → rel item → itemProps
 * - rel customXml di `_rels/.rels` → part ditemukan dari package root
 * - Override di `[Content_Types].xml`
 *
 * Pandoc tidak menulis part ini, jadi setelah pandoc selesai kita buka zip-nya,
 * tambahkan part di atas, lalu zip ulang. Kalau sudah ada `item1.xml` (mis. dari
 * reference.docx), pakai indeks berikutnya supaya tidak menimpa data lain.
 */

const REL_CUSTOM_XML =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
const REL_CUSTOM_XML_PROPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';
const CONTENT_TYPE_CUSTOM_XML =
  'application/vnd.openxmlformats-officedocument.customXml+xml';
const CONTENT_TYPE_CUSTOM_XML_PROPS =
  'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';

const MAX_ITEM_INDEX = 64;

function nextFreeIndex(zip: JSZip): number {
  for (let index = 1; index <= MAX_ITEM_INDEX; index += 1) {
    if (!zip.file(`customXml/item${index}.xml`)) return index;
  }
  throw new Error('customXml/itemN.xml sudah penuh');
}

function uniqueRelId(xml: string, base: string): string {
  let index = 1;
  let id = `${base}${index}`;
  while (xml.includes(`Id="${id}"`)) {
    index += 1;
    id = `${base}${index}`;
  }
  return id;
}

function propsXml(): string {
  const itemId = `{${randomUUID().toUpperCase()}}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    `<ds:datastoreItem ds:itemID="${itemId}" ` +
    'xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">' +
    '<ds:schemaRefs>' +
    '<ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/>' +
    '</ds:schemaRefs>' +
    '</ds:datastoreItem>'
  );
}

function itemRelsXml(propsName: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_CUSTOM_XML_PROPS}" Target="${propsName}"/>` +
    '</Relationships>'
  );
}

function addRootRelationship(xml: string, target: string): string {
  const relId = uniqueRelId(xml, 'rIdCustomXml');
  const rel = `<Relationship Id="${relId}" Type="${REL_CUSTOM_XML}" Target="${target}"/>`;
  if (xml.includes('</Relationships>')) {
    return xml.replace('</Relationships>', `${rel}</Relationships>`);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `${rel}</Relationships>`
  );
}

function addContentTypeOverrides(xml: string, itemName: string, propsName: string): string {
  const overrides =
    `<Override PartName="/${itemName}" ContentType="${CONTENT_TYPE_CUSTOM_XML}"/>` +
    `<Override PartName="/${propsName}" ContentType="${CONTENT_TYPE_CUSTOM_XML_PROPS}"/>`;
  if (xml.includes('</Types>')) return xml.replace('</Types>', `${overrides}</Types>`);
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    `${overrides}</Types>`
  );
}

/**
 * Kembalikan bytes DOCX baru yang sudah membawa sources. Kalau tidak ada entry,
 * bytes asli dikembalikan apa adanya (tanpa buka/tulis ulang zip).
 */
export async function injectDocxSources(
  docx: Buffer,
  entries: BibEntry[],
  style: 'apa' | 'ieee' = 'apa',
): Promise<{ bytes: Buffer; count: number }> {
  if (entries.length === 0) return { bytes: docx, count: 0 };

  const zip = await JSZip.loadAsync(docx);
  const index = nextFreeIndex(zip);
  const itemName = `customXml/item${index}.xml`;
  const propsName = `customXml/itemProps${index}.xml`;
  const relsName = `customXml/_rels/item${index}.xml.rels`;

  zip.file(itemName, buildWordSourcesXml(entries, style));
  zip.file(propsName, propsXml());
  zip.file(relsName, itemRelsXml(`itemProps${index}.xml`));

  const rootRelsFile = zip.file('_rels/.rels');
  const rootRels = rootRelsFile ? await rootRelsFile.async('string') : null;
  zip.file('_rels/.rels', addRootRelationship(rootRels ?? '', itemName));

  const contentTypesFile = zip.file('[Content_Types].xml');
  const contentTypes = contentTypesFile ? await contentTypesFile.async('string') : null;
  zip.file(
    '[Content_Types].xml',
    addContentTypeOverrides(contentTypes ?? '', itemName, propsName),
  );

  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { bytes, count: entries.length };
}
