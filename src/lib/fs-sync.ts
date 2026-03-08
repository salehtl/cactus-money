import type { DbClient } from "../db/client.ts";
import { exportJSON } from "./export.ts";

const DIR_HANDLE_KEY = "budget-app-dir-handle";
let dirHandle: FileSystemDirectoryHandle | null = null;

export function isFileSystemAccessSupported(): boolean {
  return "showDirectoryPicker" in window;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    dirHandle = handle;
    // Persist in IndexedDB
    await saveHandleToIDB(handle);
    return handle;
  } catch {
    return null;
  }
}

export async function getStoredDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (dirHandle) return dirHandle;
  const handle = await loadHandleFromIDB();
  if (handle) {
    // Verify permission
    const perm = await (handle as any).queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      dirHandle = handle;
      return handle;
    }
    // Try to re-request
    try {
      const reqPerm = await (handle as any).requestPermission({ mode: "readwrite" });
      if (reqPerm === "granted") {
        dirHandle = handle;
        return handle;
      }
    } catch {
      // User denied
    }
  }
  return null;
}

export async function autoExport(db: DbClient): Promise<boolean> {
  const handle = await getStoredDirectory();
  if (!handle) return false;

  try {
    const json = await exportJSON(db);
    const fileHandle = await handle.getFileHandle("budget-backup.json", {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

// IndexedDB helpers for persisting the directory handle
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("budget-app-fs", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("handles");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandleToIDB(handle: FileSystemDirectoryHandle) {
  const idb = await openIDB();
  const tx = idb.transaction("handles", "readwrite");
  tx.objectStore("handles").put(handle, DIR_HANDLE_KEY);
  idb.close();
}

async function loadHandleFromIDB(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const idb = await openIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction("handles", "readonly");
      const req = tx.objectStore("handles").get(DIR_HANDLE_KEY);
      req.onsuccess = () => {
        resolve(req.result ?? null);
        idb.close();
      };
      req.onerror = () => {
        resolve(null);
        idb.close();
      };
    });
  } catch {
    return null;
  }
}
