// 프로필(profile.json) 읽기/쓰기. 지원서에 넣는 값의 유일한 출처다.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SENSITIVE_LABEL, looksSensitiveValue } from './dom/safety.js';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Segment = string | number;

export interface ProfileUpdate {
  path: string;
  value: string | number | boolean;
}

export function parsePath(p: string): Segment[] {
  const out: Segment[] = [];
  for (const part of p.split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part.trim());
    if (!m) throw new Error(`경로 형식이 이상해요: ${p}`);
    if (m[1]) out.push(/^\d+$/.test(m[1]) ? Number(m[1]) : m[1]);
    for (const idx of m[2].match(/\d+/g) ?? []) out.push(Number(idx));
  }
  if (!out.length) throw new Error('빈 경로');
  return out;
}

function setAt(root: { [k: string]: Json }, segs: Segment[], value: Json): void {
  let node: Json = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const nextIsIndex = typeof segs[i + 1] === 'number';
    const container = node as Record<string | number, Json>;
    if (container[seg] === undefined || container[seg] === null || typeof container[seg] !== 'object') {
      container[seg] = nextIsIndex ? [] : {};
    }
    node = container[seg];
  }
  (node as Record<string | number, Json>)[segs[segs.length - 1]] = value;
}

/** 빈 값("", [], {})을 뺀 사본과, 비어 있는 항목 경로 목록 */
function prune(node: Json, at: string, missing: string[]): Json | undefined {
  if (node === '' || node === null) {
    missing.push(at);
    return undefined;
  }
  if (Array.isArray(node)) {
    const items = node.map((v, i) => prune(v, `${at}[${i}]`, missing)).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof node === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_')) continue; // "_설명" 같은 메모 키
      const p = prune(v, at ? `${at}.${k}` : k, missing);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return node;
}

export class ProfileStore {
  constructor(
    private readonly file: string,
    private readonly example: string,
  ) {}

  get path(): string {
    return this.file;
  }

  /** 없으면 예시 파일을 복사해서 만든다 */
  async read(): Promise<{ data: { [k: string]: Json }; created: boolean }> {
    let created = false;
    if (!existsSync(this.file)) {
      await mkdir(path.dirname(this.file), { recursive: true });
      await copyFile(this.example, this.file);
      created = true;
    }
    const data = JSON.parse(await readFile(this.file, 'utf8')) as { [k: string]: Json };
    return { data, created };
  }

  async view(): Promise<{ filled: Json; missing: string[]; created: boolean }> {
    const { data, created } = await this.read();
    const missing: string[] = [];
    const filled = prune(data, '', missing) ?? {};
    return { filled, missing, created };
  }

  async update(updates: ProfileUpdate[]): Promise<{ saved: string[]; rejected: { path: string; reason: string }[] }> {
    const { data } = await this.read();
    const saved: string[] = [];
    const rejected: { path: string; reason: string }[] = [];
    for (const u of updates) {
      let segs: Segment[];
      try {
        segs = parsePath(u.path);
      } catch (e) {
        rejected.push({ path: u.path, reason: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (segs.some((s) => typeof s === 'string' && SENSITIVE_LABEL.test(s))) {
        rejected.push({ path: u.path, reason: '민감정보 항목은 저장하지 않아요' });
        continue;
      }
      if (typeof u.value === 'string' && looksSensitiveValue(u.value, u.path)) {
        rejected.push({ path: u.path, reason: '주민번호·카드번호 형식의 값은 저장하지 않아요' });
        continue;
      }
      setAt(data, segs, u.value);
      saved.push(u.path);
    }
    if (saved.length) {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await rename(tmp, this.file);
    }
    return { saved, rejected };
  }
}
