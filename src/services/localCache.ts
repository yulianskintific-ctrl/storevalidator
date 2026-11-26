import type { CapturedEvidence, StoreRecord } from '../types/store';

const DB_NAME = 'store-location-validation';
const DB_VERSION = 1;
const STORES = 'stores';
const PENDING = 'pending';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES)) db.createObjectStore(STORES, { keyPath: 'customer_id' });
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'customer_id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = action(db.transaction(storeName, mode).objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const localCache = {
  async getStores(): Promise<StoreRecord[]> { return (await request<StoreRecord[]>(STORES, 'readonly', s => s.getAll())) ?? []; },
  async replaceStores(stores: StoreRecord[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES, 'readwrite'); const s = tx.objectStore(STORES); s.clear(); stores.forEach(row => s.put(row));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  },
  async getPending(): Promise<Array<{ customer_id: string; evidence: CapturedEvidence }>> {
    return (await request<Array<{ customer_id: string; evidence: CapturedEvidence }>>(PENDING, 'readonly', s => s.getAll())) ?? [];
  },
  async putPending(customer_id: string, evidence: CapturedEvidence): Promise<void> { await request(PENDING, 'readwrite', s => s.put({ customer_id, evidence })); },
  async removePending(customer_id: string): Promise<void> { await request(PENDING, 'readwrite', s => s.delete(customer_id)); },
};
