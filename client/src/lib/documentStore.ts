import type { ScanDocument } from "./scanTypes";

const DB_NAME = "paperless-local-library";
const DB_VERSION = 1;
const STORE_NAME = "documents";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("title", "title");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local document storage."));
    request.onblocked = () => reject(new Error("Paperless storage is busy in another tab. Close the other tab and retry."));
  });
}

export async function listDocuments(): Promise<ScanDocument[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as ScanDocument[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error("Could not read the local library."));
    });
  } finally {
    db.close();
  }
}

export async function saveDocument(document: ScanDocument): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(document);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not save this document."));
    });
  } finally {
    db.close();
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not remove this document."));
    });
  } finally {
    db.close();
  }
}
