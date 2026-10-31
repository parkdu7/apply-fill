// 계정 보관함 암호화: 마스터 비밀번호 → PBKDF2(SHA-256, 60만 회) → AES-GCM 256.
// 비밀번호는 암호문으로만 chrome.storage.local에 저장하고, 푼 키는 chrome.storage.session(메모리, 확장 페이지만)에 둔다.
// 계정은 정확한 origin(https://example.com)에만 묶인다: 다른 도메인에서는 절대 꺼내지 않는다.
// 이 파일은 순수 함수만 있어서 Node(webcrypto)로도 테스트한다.

export interface Sealed {
  iv: string;
  ct: string;
}

export interface VaultAccount {
  id: string;
  /** 정확한 origin. 이 주소의 페이지(프레임)에서만 쓴다 */
  origin: string;
  username: string;
  label?: string;
  secret: Sealed;
  addedAt: string;
}

export interface VaultData {
  version: 1;
  salt: string;
  iterations: number;
  /** 마스터 비밀번호 확인용 */
  verifier: Sealed;
  accounts: VaultAccount[];
}

export const ITERATIONS = 600_000;
export const AUTO_LOCK_MIN = 30;
const VERIFY_TEXT = 'careerlog-vault-v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 세션에 넣어 두려고 꺼낼 수 있는 키로 만든다 (storage.session은 디스크에 쓰지 않는다) */
export async function deriveKey(master: string, salt: Uint8Array<ArrayBuffer>, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(master), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, text: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function open(key: CryptoKey, s: Sealed): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, key, unb64(s.ct));
  return dec.decode(pt);
}

export async function exportKey(key: CryptoKey): Promise<string> {
  return b64(await crypto.subtle.exportKey('raw', key));
}

export function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function createVault(master: string, iterations = ITERATIONS): Promise<{ data: VaultData; key: CryptoKey }> {
  if (master.length < 8) throw new Error('마스터 비밀번호는 8자 이상으로 정해 주세요');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(master, salt, iterations);
  return { data: { version: 1, salt: b64(salt), iterations, verifier: await seal(key, VERIFY_TEXT), accounts: [] }, key };
}

/** 마스터 비밀번호가 맞으면 키, 틀리면 undefined */
export async function unlockVault(data: VaultData, master: string): Promise<CryptoKey | undefined> {
  const key = await deriveKey(master, unb64(data.salt), data.iterations);
  try {
    return (await open(key, data.verifier)) === VERIFY_TEXT ? key : undefined;
  } catch {
    return undefined;
  }
}

/** "https://www.Example.com/login?x" → "https://www.example.com". http(s)만 받는다 */
export function normalizeOrigin(url: string): string {
  const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('http(s) 주소만 저장할 수 있어요');
  return u.origin.toLowerCase();
}

export async function addAccount(data: VaultData, key: CryptoKey, a: { origin: string; username: string; password: string; label?: string }): Promise<VaultAccount> {
  const origin = normalizeOrigin(a.origin);
  const acc: VaultAccount = {
    id: crypto.randomUUID(),
    origin,
    username: a.username,
    label: a.label,
    secret: await seal(key, a.password),
    addedAt: new Date().toISOString(),
  };
  data.accounts = [...data.accounts.filter((x) => !(x.origin === origin && x.username === a.username)), acc];
  return acc;
}

/** 이 프레임 origin에 묶인 계정 (정확히 같은 origin만. 하위 도메인·http/https 차이도 다른 사이트로 본다) */
export function accountFor(data: VaultData, frameOrigin: string): VaultAccount | undefined {
  let origin: string;
  try {
    origin = normalizeOrigin(frameOrigin);
  } catch {
    return undefined;
  }
  return data.accounts.find((a) => a.origin === origin);
}
