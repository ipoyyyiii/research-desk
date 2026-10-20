/**
 * Tanam (seed) pack font ke IndexedDB `wordcraft` — database yang DIBACA
 * WordCraft-web saat startup (`web/font_store.rs`: DB_NAME "wordcraft",
 * STORE "fonts", key = nama file, value = bytes font TTF/OTF/WOFF/WOFF2).
 * Origin sama dengan iframe Word, jadi DB bisa dibuka dari dokumen app.
 *
 * WordCraft membaca SEMUA entry di store setiap boot (load_all), jadi font
 * yang ditanam langsung masuk daftar Font di dalam Word. Gagal apa pun
 * di-log lalu dilewati: seeder tidak pernah membuat tab Word macet.
 *
 * Migrasi versi: manifest selalu di-fetch (manifestnya kecil) dan dibandingkan
 * dengan flag versi terakhir yang ditanam → kalau server punya versi lebih
 * baru, yang kurang ditambah dan yang sudah dihapus dari manifest dibersihkan
 * dari DB (hanya entry yang TERBUKTI dulu berasal dari pack — yang ada di
 * cache manifest sebelumnya — supaya font yang di-upload manual user via
 * "Add Font…" di dalam WordCraft tidak ikut terhapus).
 */
export type FontPackEntry = { file: string; bytes: number; family: string; group: string };
export type FontPack = { version: number; generated: string; fonts: FontPackEntry[] };
export type SeedResult = { added: number; skipped: number; pruned: number; total: number; fail?: boolean };

const DB_NAME = 'wordcraft';
const STORE = 'fonts';
const FLAG = 'rd.wordcraft.fontpack.seeded';
const MANIFEST_CACHE = 'rd.wordcraft.manifest';
// Flag versi lama (per-versi) — dibaca cuma buat fallback siklus first-run lama.
const LEGACY_FLAG_PREFIX = 'rd.wordcraft.fontpack.v';

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

function deleteFont(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb aborted'));
  });
}

function readCachedPack(): FontPack | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MANIFEST_CACHE);
    if (!raw) return null;
    const cached = JSON.parse(raw) as FontPack;
    return cached && cached.version && Array.isArray(cached.fonts) ? cached : null;
  } catch {
    return null;
  }
}

/** Seeding penuh; null = dilewati (cache terkini & tersinkron, server kosong, atau IDB gagal). */
export async function seedWordcraftFonts(): Promise<SeedResult | null> {
  if (typeof indexedDB === 'undefined') return null;

  // 1. Manifest dari server — selalu, karena biaya kecil dan ini kunci
  //    migrasi versi (flag lama dulu bikin pack baru gak pernah kecontek).
  let pack: FontPack;
  try {
    const res = await fetch('/api/wordcraft/fonts/pack', { cache: 'no-store' });
    if (!res.ok) return { added: 0, skipped: 0, pruned: 0, total: 0, fail: true };
    pack = (await res.json()) as FontPack;
    if (!pack || !Array.isArray(pack.fonts) || pack.fonts.length === 0) {
      return { added: 0, skipped: 0, pruned: 0, total: 0, fail: true };
    }
  } catch {
    return { added: 0, skipped: 0, pruned: 0, total: 0, fail: true };
  }

  const seededVersion =
    typeof localStorage !== 'undefined'
      ? (() => {
          const v = localStorage.getItem(FLAG);
          if (v) return Number(v);
          // Fallback siklus lama: flag per-versi. Versi muncul berurutan,
          // jadi cukup manakah versi tersubut yang pernah ke-tandai — flag
          // v1/v2 berarti versi pack dulu sudah ditanam ke DB.
          let seeded = false;
          try {
            for (let i = 0; i < pack.version; i++) {
              if (localStorage.getItem(LEGACY_FLAG_PREFIX + i) === '1') seeded = true;
            }
          } catch {
            /* abaikan */
          }
          return seeded ? pack.version - 1 : -1;
        })()
      : -1;

  // 2. Kunci DB + hitung yang kurang & yang sudah usang.
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    console.warn('[wordcraft-fonts] IndexedDB gagal dibuka:', e);
    return { added: 0, skipped: 0, pruned: 0, total: 0, fail: true };
  }

  let keys: Set<string>;
  try {
    keys = await getKeys(db);
  } catch (e) {
    console.warn('[wordcraft-fonts] gagal baca keys:', e);
    db.close();
    return { added: 0, skipped: 0, pruned: 0, total: 0, fail: true };
  }

  const packFiles = new Set(pack.fonts.map((f: FontPackEntry) => f.file));
  const missing = pack.fonts.filter((f: FontPackEntry) => !keys.has(f.file));

  // 3. Bersih-bersih usang: hanya key yang TERBUKTI dulu berasal dari pack
  //    (cepat-cache manifest sebelumnya), supaya upload-manual user gak terhapus.
  const stale: string[] = [];
  const cached = readCachedPack();
  if (cached) {
    const prevFiles = new Set(cached.fonts.map((f: FontPackEntry) => f.file));
    for (const k of keys) {
      if (!packFiles.has(k) && prevFiles.has(k)) stale.push(k);
    }
  }

  const fastPathVersionOk = seededVersion === pack.version;
  if (fastPathVersionOk && missing.length === 0 && stale.length === 0) {
    db.close();
    return null;
  }

  // 4. Tanam yang kurang: fetch bytes → put. Batch kecil biar jaringan rapi.
  let added = 0;
  let skipped = 0;
  if (missing.length > 0) {
    const BATCH = 8;
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
  }

  // 5. Hapus paket lama yang sudah digantikan.
  let pruned = 0;
  for (const key of stale) {
    try {
      await deleteFont(db, key);
      pruned++;
    } catch (e) {
      console.warn(`[wordcraft-fonts] gak bisa hapus ${key}:`, e);
    }
  }
  db.close();

  // 6. Simpan manifest baru + tandai versi ter-tanam.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MANIFEST_CACHE, JSON.stringify(pack));
      localStorage.setItem(FLAG, String(pack.version));
    }
  } catch {
    // quota penuh → tak apa; seeding tetap sudah jalan di DB
  }
  return { added, skipped, pruned, total: pack.fonts.length };
}
