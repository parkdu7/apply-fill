// 파일 보관함 (IndexedDB, 이 확장 안에만 저장). 졸업증명서·성적증명서·자격증 사본·포트폴리오 등.
// 파일 내용은 확장 밖(호스트·LLM)으로 나가지 않는다. LLM은 이름·종류·크기·발급일만 본다.
import type { VaultFile } from './protocol';

const DB = 'careerlog';
const STORE = 'files';

export interface StoredFile extends VaultFile {
  data: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export const meta = ({ data: _data, ...m }: StoredFile): VaultFile => m;

export async function listFiles(): Promise<VaultFile[]> {
  const all = await tx<StoredFile[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFile[]>);
  return all.map(meta).sort((a, b) => a.kind.localeCompare(b.kind) || b.addedAt.localeCompare(a.addedAt));
}

export function getFile(id: string): Promise<StoredFile | undefined> {
  return tx<StoredFile | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredFile | undefined>);
}

export async function addFile(file: File, kind: string, issued?: string): Promise<VaultFile> {
  const rec: StoredFile = {
    id: crypto.randomUUID(),
    name: file.name,
    kind: kind || '기타',
    size: file.size,
    type: file.type || 'application/octet-stream',
    issued: issued || undefined,
    addedAt: new Date().toISOString(),
    data: file,
  };
  await tx('readwrite', (s) => s.put(rec));
  return meta(rec);
}

export async function removeFile(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** content script로 보낼 형태 (runtime 메시지는 JSON이라 base64) */
export async function filePayload(f: StoredFile): Promise<{ name: string; type: string; size: number; issued?: string; lastModified: number; b64: string }> {
  const bytes = new Uint8Array(await f.data.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: f.name, type: f.type, size: f.size, issued: f.issued, lastModified: Date.parse(f.addedAt) || Date.now(), b64: btoa(bin) };
}
