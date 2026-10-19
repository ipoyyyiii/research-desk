#!/usr/bin/env node
/**
 * Bangun pack font WordCraft di data/wordcraft-fonts/:
 * - copy font metric-compatible Word (apt: croscore/crosextra/liberation2)
 * - unduh Google Docs populer (latin subset .woff2) dari CDN fontsource
 * - Gelasio (metric Georgia) dari repo google/fonts (variable TTF)
 * Output: manifest.json {version, generated, fonts:[{file,bytes,family,group}]}
 * Idempoten: file yang sudah ada dengan ukuran != 0 di-skip unduhannya.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const OUT = path.join(process.cwd(), "data", "wordcraft-fonts");
fs.mkdirSync(OUT, { recursive: true });

const manifest = { version: 1, generated: new Date().toISOString(), fonts: [] };

function fetchBuf(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchBuf(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function add(file, family, group, url) {
  const dest = path.join(OUT, file);
  let buf = null;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    buf = fs.readFileSync(dest);
  } else {
    try {
      buf = await fetchBuf(url);
    } catch (e) {
      return { file, family, ok: false, why: String(e.message || e) };
    }
    if (buf.length < 200) return { file, family, ok: false, why: 'too small (' + buf.length + 'B)' };
    const sig = buf.subarray(0, 4).toString('latin1');
    if (!['wOF2', 'wOFF', '\x00\x01\x00\x00', 'ttcf', 'OTTO'].includes(sig)) {
      return { file, family, ok: false, why: 'bad signature ' + JSON.stringify(sig) };
    }
    fs.writeFileSync(dest, buf);
  }
  manifest.fonts.push({ file, bytes: buf.length, family, group });
  return { file, family, ok: true };
}

// ---------- 1) Font metric Word dari apt (copy TTF lokal) ----------
const APT = [
  '/usr/share/fonts/truetype/crosextra', // Carlito, Caladea
  '/usr/share/fonts/truetype/near-black'
];
const SRC = [
  '/usr/share/fonts/truetype/crosextra',
  '/usr/share/fonts/truetype/liberation',
  '/usr/share/fonts/truetype/croscore'
];
let copied = 0;
for (const dir of SRC) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ttf') || f.startsWith('.')) continue;
    fs.copyFileSync(path.join(dir, f), path.join(OUT, f));
    copied++;
  }
}
// daftarkan yang di-copy ke manifest dengan family dari fc
const fcOut = '';
for (const f of manifest.fonts) { /* nothing */ }

// amankan family: pakai pemetaan manual nama file -> family
const FAMILY_BY_FILE = (f) => {
  if (f.startsWith('Carlito')) return 'Carlito';
  if (f.startsWith('Caladea')) return 'Caladea';
  if (f.startsWith('LiberationSans')) return 'Liberation Sans';
  if (f.startsWith('LiberationSerif')) return 'Liberation Serif';
  if (f.startsWith('LiberationMono')) return 'Liberation Mono';
  if (f.startsWith('Tinos')) return 'Tinos';
  if (f.startsWith('Arimo')) return 'Arimo';
  if (f.startsWith('Cousine')) return 'Cousine';
  return f.replace(/[-_.].*$/, '');
};

const localFiles = fs.readdirSync(OUT).filter((f) => f.endsWith('.ttf'));
for (const f of localFiles) {
  manifest.fonts.push({ file: f, bytes: fs.statSync(path.join(OUT, f)).size, family: FAMILY_BY_FILE(f), group: 'word-metric' });
}

// ---------- 2) Gelasio (metric Georgia) via google/fonts repo ----------
const gh = (p) => 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/' + p;
const GITUH = [
  ['gelasio/Gelasio[wght].ttf', 'Gelasio'],
  ['gelasio/Gelasio-Italic[wght].ttf', 'Gelasio-Italic']
];

// ---------- 3) Google Docs populer via fontsource CDN ----------
const fs_ = (id) => 'https://cdn.jsdelivr.net/fontsource/fonts/' + id + '@latest/latin-400-normal.woff2';
const fs700 = (id) => 'https://cdn.jsdelivr.net/fontsource/fonts/' + id + '@latest/latin-700-normal.woff2';
const fs400i = (id) => 'https://cdn.jsdelivr.net/fontsource/fonts/' + id + '@latest/latin-400-italic.woff2';
const fs700i = (id) => 'https://cdn.jsdelivr.net/fontsource/fonts/' + id + '@latest/latin-700-italic.woff2';

const SANS = ['open-sans', 'lato', 'montserrat', 'poppins', 'roboto', 'raleway', 'nunito', 'nunito-sans', 'work-sans', 'mulish', 'rubik', 'fira-sans', 'barlow', 'dm-sans', 'manrope', 'cabin', 'karla', 'quicksand', 'josefin-sans', 'oswald', 'pt-sans', 'heebo', 'titillium-web', 'exo-2', 'space-grotesk', 'sora', 'ibm-plex-sans', 'public-sans', 'plus-jakarta-sans', 'outfit', 'figtree', 'urbanist', 'jost', 'overpass', 'inter-tight'];
const SERIF = ['merriweather', 'playfair-display', 'lora', 'pt-serif', 'libre-baskerville', 'crimson-text', 'eb-garamond', 'cormorant-garamond', 'bitter', 'literata', 'spectral', 'vollkorn', 'alegreya', 'frank-ruhl-libre', 'zilla-slab', 'arvo', 'cardo', 'neuton', 'domine', 'bree-serif'];
const MONO = ['roboto-mono', 'ibm-plex-mono', 'source-code-pro', 'space-mono', 'inconsolata', 'fira-mono'];
const DISPLAY = ['dancing-script', 'pacifico', 'caveat', 'indie-flower', 'lobster', 'great-vibes', 'bangers', 'anton', 'righteous', 'comfortaa', 'orbitron', 'fredoka', 'baloo-2', 'kaushan-script', 'shadows-into-light', 'patrick-hand', 'amatic-sc', 'abril-fatface', 'alfa-slab-one', 'cinzel', 'permanent-marker'];

const jobs = [];
function famName(id) {
  return id.split('-').join(' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// gelasio dulu (variable)
for (const [p, fam] of GITUH) {
  const file = p.replace(/[^/]+\//, '').replace(/\[/g, '(').replace(/\]/g, ')');
  const url = gh(p);
  jobs.push(add(file, famName(fam.replace('-Italic', '').toLowerCase()) + (fam.includes('Italic') ? ' Italic' : ''), 'word-metric', url).catch((e) => ({ file, ok: false, why: String(e) })));
}

const bundles = [
  ['docs-sans', SANS],
  ['docs-serif', SERIF],
  ['docs-mono', MONO],
  ['docs-display', DISPLAY]
];
for (const [group, ids] of bundles) {
  for (const id of ids) {
    const fam = famName(id);
    const stem = id.replace(/-?\?/, '');
    jobs.push(add(stem + '-latin-400-normal.woff2', fam, group, fs_(stem)).catch(() => ({ ok: false })));
    jobs.push(add(stem + '-latin-700-normal.woff2', fam, group, fs700(stem)).catch(() => ({ ok: false })));
    jobs.push(add(stem + '-latin-400-italic.woff2', fam, group, fs400i(stem)).catch(() => ({ ok: false })));
    jobs.push(add(stem + '-latin-700-italic.woff2', fam, group, fs700i(stem)).catch(() => ({ ok: false })));
  }
}

const r = await Promise.all(jobs);
const bad = r.filter((x) => x && x.ok === false);
const good = r.filter((x) => x && x.ok);

// re-derive manifest dari disk agar konsisten (semua beneran ada)
const diskSizes = {};
for (const f of fs.readdirSync(OUT)) diskSizes[f] = fs.statSync(path.join(OUT, f)).size;
manifest.fonts = manifest.fonts
  .filter((e) => diskSizes[e.file])
  .map((e) => ({ ...e, bytes: diskSizes[e.file] }));
manifest.fonts.sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// tanpa duplikat file
const seen = new Set();
manifest.fonts = manifest.fonts.filter((e) => (seen.has(e.file) ? false : seen.add(e.file)));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

const totalMB = (Object.values(diskSizes).reduce((a, b) => a + b, 0) / 1048576).toFixed(1);
console.log('copied-apt:', copied);
console.log('manifest-entries:', manifest.fonts.length, 'files-on-disk:', Object.keys(diskSizes).length, 'total-mb:', totalMB);
console.log('failed:', bad.length);
for (const b of bad.slice(0, 12)) console.log('  x', b.file, b.why || '');
