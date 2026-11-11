// Minimal key/value persistence: IndexedDB when available, localStorage otherwise.

const DB_NAME = 'mi-land-access';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const LS_PREFIX = 'mila:';

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (db) {
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      });
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.warn('Could not persist', key, err);
  }
}

/** Synchronous small settings (theme, basemap, layer toggles) live in localStorage. */
export function prefGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + 'pref:' + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function prefSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(LS_PREFIX + 'pref:' + key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
