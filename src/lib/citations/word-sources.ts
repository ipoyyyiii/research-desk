import type { BibEntry } from '@/lib/journals/bib';

/**
 * BibTeX → sources.xml format Word (References > Manage Sources > Browse).
 * Skema: http://schemas.openxmlformats.org/officeDocument/2006/bibliography
 * Catatan jujur: impor ini menyalin entri ke master list Word; sitasi di
 * dokumen tetap harus disisipkan lewat Cite (Word tidak auto-sinkron).
 */

const SOURCE_TYPES: Record<string, string> = {
  article: 'JournalArticle',
  book: 'Book',
  inbook: 'BookSection',
  incollection: 'BookSection',
  inproceedings: 'ConferenceProceedings',
  conference: 'ConferenceProceedings',
  proceedings: 'ConferenceProceedings',
  phdthesis: 'Report',
  mastersthesis: 'Report',
  techreport: 'Report',
  report: 'Report',
  misc: 'Misc',
  online: 'InternetSite',
  electronic: 'InternetSite',
  www: 'InternetSite',
  unpublished: 'Misc',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** "Last, First M." → {last, first}; "First M. Last" → last kata jadi Last. */
function splitPersonName(raw: string): { last: string; first: string } {
  const name = raw.trim();
  const comma = name.indexOf(',');
  if (comma >= 0) {
    return {
      last: name.slice(0, comma).trim(),
      first: name.slice(comma + 1).trim(),
    };
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { last: name, first: '' };
  // Heuristik organisasi: 3+ kata tanpa inisial (mis. "World Health Organization")
  // disimpan utuh di Last, bukan dipecah jadi "Organization, W. H.".
  const hasInitial = words.some((word) => /^[A-Z]\.$/.test(word));
  if (words.length >= 3 && !hasInitial) return { last: name, first: '' };
  return { last: words[words.length - 1], first: words.slice(0, -1).join(' ') };
}

function sourceTypeFor(entry: BibEntry): string {
  const byType = entry.type ? SOURCE_TYPES[entry.type] : undefined;
  if (byType) return byType;
  return entry.venue ? 'JournalArticle' : 'Misc';
}

function authorXml(entry: BibEntry): string {
  if (entry.authors.length === 0) return '';
  const people = entry.authors
    .map(splitPersonName)
    .filter((person) => person.last.length > 0)
    .map((person) => {
      const first = person.first ? `<b:First>${escapeXml(person.first)}</b:First>` : '';
      return `          <b:Person>\n            <b:Last>${escapeXml(person.last)}</b:Last>${first ? `\n            ${first}\n          ` : ''}</b:Person>`;
    });
  if (people.length === 0) return '';
  return `    <b:Author>
      <b:Author>
        <b:NameList>
${people.join('\n')}
        </b:NameList>
      </b:Author>
    </b:Author>\n`;
}

/**
 * Bangun file sources.xml dari entry BibTeX. Tag = citation key apa adanya
 * (Word mensyaratkan unik; duplikat dilewati).
 */
export function buildWordSourcesXml(
  entries: BibEntry[],
  style: 'apa' | 'ieee' = 'apa',
): string {
  const seen = new Set<string>();
  const sources: string[] = [];

  for (const entry of entries) {
    const tag = entry.key.trim();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);

    const fields: string[] = [
      `    <b:Tag>${escapeXml(tag)}</b:Tag>`,
      `    <b:SourceType>${sourceTypeFor(entry)}</b:SourceType>`,
    ];
    const authors = authorXml(entry);
    if (authors) fields.push(authors.replace(/\n$/, ''));
    if (entry.title) fields.push(`    <b:Title>${escapeXml(entry.title)}</b:Title>`);
    if (entry.venue) fields.push(`    <b:JournalName>${escapeXml(entry.venue)}</b:JournalName>`);
    if (entry.year) fields.push(`    <b:Year>${escapeXml(entry.year)}</b:Year>`);
    if (entry.doi) fields.push(`    <b:DOI>${escapeXml(entry.doi)}</b:DOI>`);

    sources.push(`  <b:Source>\n${fields.join('\n')}\n  </b:Source>`);
  }

  // Word memakai SelectedStyle untuk pilihan gaya di Manage Sources; WordCraft
  // membaca StyleName. Dua-duanya disamakan dengan gaya ekspor.
  const meta =
    style === 'ieee'
      ? { selected: '\\IEEE2006OfficeOnline.xsl', name: 'IEEE' }
      : { selected: '\\APASixthEditionOfficeOnline.xsl', name: 'APA' };

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" ' +
    'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" ' +
    `SelectedStyle="${meta.selected}" StyleName="${meta.name}" Version="6">\n` +
    `${sources.join('\n')}\n` +
    '</b:Sources>\n'
  );
}
