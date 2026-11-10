// Phase P7: the research documents of this browser, kept in IndexedDB. Only what Supervisor extracted is stored
// (text with page numbers, sections and findings), never the original file, and nothing is sent to the account:
// thesis_paths keeps its 5 MB limit for the thesis itself. One computer per student is assumed, as elsewhere.

import type { Analysis, DocMeta } from './docAnalysis';
import type { DeepAnalysis } from './deepAnalysis';

export type DocStatus = 'ready' | 'no_text' | 'failed';
export type SourceDoc = Analysis & {
  id: string;
  /** The account the document was added for, or "guest" before signing in. */
  owner: string;
  fileName: string;
  kind: 'pdf' | 'docx';
  fileBytes: number;
  pages: number;
  importedAt: string;
  status: DocStatus;
  statusNote?: string;
  /** The student confirmed they may use this document for their research. */
  permission: { confirmedAt: string };
  /** Details the student corrected. They replace the detected ones. */
  corrected?: DocMeta;
  /** Phase P8: the AI-assisted analysis, kept until the student runs it again. Older records have none. */
  deep?: DeepAnalysis;
};

/** The details the AI analysis used. When they change, the analysis is marked as out of date. */
export const metaKeyOf = (d: SourceDoc) => JSON.stringify(effectiveMeta(d));

export const MAX_DOCS = 40;
export const MAX_TOTAL_CHARS = 25_000_000;
const DB = 'supervisor-sources';
const STORE = 'docs';

export const effectiveMeta = (d: SourceDoc): DocMeta => ({ ...d.meta, ...Object.fromEntries(Object.entries(d.corrected ?? {}).filter(([, v]) => v !== undefined && v !== '')) });

/** Kept in memory when the browser has no IndexedDB (a private window, for example). The page says so. */
const memory = new Map<string, SourceDoc>();
let available: boolean | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('owner', 'owner');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  available = !!db;
  if (!db) throw new Error('no_indexeddb');
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('store_failed'));
    };
  });
}

export const storeIsPersistent = () => available !== false;

export async function listDocs(owner?: string): Promise<SourceDoc[]> {
  let all: SourceDoc[];
  try {
    all = await run('readonly', (s) => s.getAll() as IDBRequest<SourceDoc[]>);
  } catch {
    all = [...memory.values()];
  }
  return all.filter((d) => !owner || d.owner === owner).sort((a, b) => (a.importedAt < b.importedAt ? -1 : 1));
}

export class StoreFullError extends Error {}

/** Saves a document. When the browser refuses (storage full), nothing is saved and the caller is told. */
export async function saveDoc(d: SourceDoc): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(d));
  } catch (e) {
    if ((e as Error)?.message === 'no_indexeddb') {
      memory.set(d.id, d);
      return;
    }
    if ((e as DOMException)?.name === 'QuotaExceededError') throw new StoreFullError('full');
    throw e;
  }
}

export async function deleteDoc(id: string): Promise<void> {
  memory.delete(id);
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {}
}

/** Bytes used and allowed for this site, when the browser says. */
export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage, quota: e?.quota };
  } catch {
    return {};
  }
}
