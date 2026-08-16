/**
 * Browser-side cache for generated `TechnicalDrawing` line geometry and
 * annotations, keyed by a caller-supplied string (model ids + their
 * Last-Modified stamps + the view id — see `getDrawingCacheKey` in
 * BimStreamer.tsx). Regenerating a drawing via `EdgeProjector` is expensive
 * on complex models; this lets a cache hit skip that entirely.
 */

const DB_NAME = "casa-rebecca-drawing-cache";
const DB_VERSION = 1;
const STORE_NAME = "drawings";

export type CachedGeometryGroup = {
  count: number;
  materialIndex: number;
  start: number;
};

export type CachedLineLayer = {
  groups?: CachedGeometryGroup[];
  layer: string;
  positions: Float32Array;
};

export type SerializedAnnotation = {
  data: unknown;
  systemKey: string;
  uuid: string;
};

export type CachedDrawingRecord = {
  annotations: SerializedAnnotation[];
  layers: CachedLineLayer[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedDrawing(
  key: string,
): Promise<CachedDrawingRecord | undefined> {
  if (typeof indexedDB === "undefined") return undefined;

  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () =>
        resolve(request.result as CachedDrawingRecord | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function putCachedDrawing(
  key: string,
  record: CachedDrawingRecord,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
