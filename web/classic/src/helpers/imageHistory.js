/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

const DB_NAME = 'new-api-image-studio-history';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const HISTORY_LIMIT = 50;

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDB = () =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    };
  });

const withStore = async (mode, callback) => {
  const db = await openDB();
  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const result = await callback(store);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
};

const listAllImageHistory = async () => {
  const records = await withStore('readonly', (store) =>
    requestToPromise(store.getAll()),
  );
  return records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
};

export const listImageHistory = async () =>
  (await listAllImageHistory()).slice(0, HISTORY_LIMIT);

const trimImageHistory = async () => {
  const staleRecords = (await listAllImageHistory()).slice(HISTORY_LIMIT);
  await Promise.all(
    staleRecords.map((record) => deleteImageHistoryRecord(record.id)),
  );
};

export const addImageHistoryRecord = async (record) => {
  const nextRecord = await withStore('readwrite', async (store) => {
    const now = Date.now();
    const nextRecord = {
      ...record,
      id: record.id || createId(),
      created_at: record.created_at || now,
    };
    await requestToPromise(store.put(nextRecord));
    return nextRecord;
  });
  await trimImageHistory();
  return nextRecord;
};

export const deleteImageHistoryRecord = async (id) =>
  withStore('readwrite', (store) => requestToPromise(store.delete(id)));

export const clearImageHistory = async () =>
  withStore('readwrite', (store) => requestToPromise(store.clear()));
