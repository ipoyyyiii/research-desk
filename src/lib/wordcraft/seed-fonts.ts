/**
 * Tanam (seed) pack font ke IndexedDB `wordcraft` — database yang DIBACA
 * WordCraft-web saat startup (`web/font_store.rs`: DB_NAME "wordcraft",
 * STORE "fonts", key = nama file, value = bytes font TTF/OTF/WOFF/WOFF2).
 * Origin sama dengan iframe Word, jadi DB bisa dibuka dari dokumen app.
 *
 * WordCraft membaca SEMUA entry di store setiap boot (load_all), jadi font
 * yang ditanam langsung masuk daftar Font di dalam Word. Gagal apa pun
 * di-log lalu dilewati: seeder tidak pernah membuat tab Word macet.
 */
export type FontPackEntry = { file: string; bytes: number; family: string; group: string };
export type FontPack = { version: number; generated: string; fonts: FontPackEntry[] };
export type SeedResult = { added: number; skipped: number; total: number };

const DB_NAME = 'wordcraft';
const STORE = 'fonts';
const FLAG_PREFIX = 'rd.wordcraft.fontpack.v';
const MANIFEST_CACHE = 'rd.wordcraft.manifest';

/** Buka DB tanpa memaksa versi (DB-nya milik app; store dibuat kalau belum ada). */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    req.onblocked = () => reject(new Error('idb blocked'));
  });
}

function getKeys(db: IDBDatabase): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result.filter((k): k is string => typeof k === 'string')));
    req.onerror = () => reject(req.error ?? new Error('idb keys failed'));
  });
}

function putFont(db: IDBDatabase, key: string, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb put failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb aborted'));
  });
}

/** Seeding penuh; null = dilewati (cache terkini, server kosong, atau IDB gagal). */
export async function seedWordcraftFonts(): Promise<SeedResult | null> {
  if (typeof indexedDB === 'undefined') return null;

  // Cepat: pack versi ini sudah ditanam → aman skip (flag dihapus bareng site data,
  // jadi kalau user bersihin storage, flag juga hilang → seeding jalan lagi).
  const manifestRaw =
    typeof localStorage !== 'undefined' ? localStorage.getItem(MANIFEST_CACHE) : null;
  if (manifestRaw && typeof localStorage !== 'undefined') {
    try {
      const cached = JSON.parse(manifestRaw) as FontPack;
      if (cached.version && localStorage.getItem(FLAG_PREFIX + cached.version) === '1') {
        // Tetap pastikan DB masih ada font-nya (kalau cache site dibersihkan
        // sebagian, seeding ulang murah — fetch manifest baru).
        const db = await openDb();
        try {
          const keys = await getKeys(db);
          if (cached.fonts.every((f: FontPackEntry) => keys.has(f.file))) return null;
        } finally {
          db.close();
        }
      }
    } catch {
      // manifest cache rusak → lanjut fetch ulang
    }
  }

  // 1. Manifest dari server
  let pack: FontPack;
  try {
    const res = await fetch('/api/wordcraft/fonts/pack', { cache: 'no-store' });
    if (!res.ok) return null;
    pack = (await res.json()) as FontPack;
    if (!pack || !Array.isArray(pack.fonts) || pack.fonts.length === 0) return null;
  } catch {
    return null;
  }

  // 2. Kunci yang sudah ada di DB
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    console.warn('[wordcraft-fonts] IndexedDB gagal dibuka:', e);
    return null;
  }
  let missing: FontPackEntry[];
  try {
    const keys = await getKeys(db);
    missing = pack.fonts.filter((f) => !keys.has(f.file));
  } catch (e) {
    console.warn('[wordcraft-fonts] gagal baca keys:', e);
    db.close();
    return null;
  }

  // 3. Tanam yang kurang: fetch bytes → put. Batch kecil biar jaringan rapi.
  let added = 0;
  let skipped = 0;
  const BATCH = 8;
  const okFlag =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(FLAG_PREFIX + pack.version) === '1';
  if (okFlag && missing.length === 0) {
    db.close();
    return null;
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (f) => {
        try {
          const res = await fetch(`/api/wordcraft/fonts/file/${encodeURIComponent(f.file)}`, {
            cache: 'force-cache',
          });
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          await putFont(db, f.file, bytes);
          added++;
        } catch (e) {
          skipped++;
          console.warn(`[wordcraft-fonts] lewati ${f.file}:`, e);
        }
      }),
    );
  }
  db.close();

  // 4. Simpan manifest di cache + tandai versi ditanam.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MANIFEST_CACHE, JSON.stringify(pack));
      localStorage.setItem(FLAG_PREFIX + pack.version, '1');
    }
  } catch {
    // quota penuh → tak apa; seeding tetap sudah jalan di DB
  }
  return { added, skipped, total: pack.fonts.length };
}
