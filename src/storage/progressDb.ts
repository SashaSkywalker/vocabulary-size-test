import type { ProgressState } from '../lib/progress';

const DB_NAME = 'lexicon-marathon';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const PROGRESS_KEY = 'progress';

let dbPromise: Promise<IDBDatabase> | undefined;

export function resetProgressDbConnection() {
  dbPromise = undefined;
}

export async function loadProgress(): Promise<ProgressState | undefined> {
  const db = await openProgressDb();
  return requestToPromise<ProgressState | undefined>(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(PROGRESS_KEY));
}

export async function saveProgress(progress: ProgressState): Promise<void> {
  const db = await openProgressDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(progress, PROGRESS_KEY);
  await transactionToPromise(transaction);
}

export async function clearProgress(): Promise<void> {
  const db = await openProgressDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(PROGRESS_KEY);
  await transactionToPromise(transaction);
}

function openProgressDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
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

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
