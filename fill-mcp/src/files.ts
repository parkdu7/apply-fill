// 파일 보관함 (첨부할 증명서·포트폴리오).
// - 확장 모드: 확장의 IndexedDB (ExtFiles, ext-host.ts). 파일 내용은 확장 안에서만 오간다
// - Playwright 모드: data/files/index.json + 파일들 (DiskFiles). `node dist/index.js --add-file <경로> --kind 졸업증명서 --issued 2025-09-01`
// LLM은 이름·종류·크기·발급일만 본다.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AttachOutcome, VaultFile } from './bridge.js';
import type { FilePayload } from './dom/files.js';
import type { FrameRef } from './transport.js';

export interface FileSource {
  list(): Promise<VaultFile[]>;
  /** frame 안의 localKey 칸에 보관함 파일을 붙인다 */
  attach(frame: FrameRef, localKey: string, fileId: string): Promise<AttachOutcome>;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
  '.hwp': 'application/x-hwp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
};

interface DiskEntry extends VaultFile {
  file: string;
}

export class DiskFiles implements FileSource {
  constructor(private readonly dir: string) {}

  private index(): DiskEntry[] {
    const f = path.join(this.dir, 'index.json');
    if (!existsSync(f)) return [];
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as DiskEntry[];
    } catch {
      return [];
    }
  }

  async list(): Promise<VaultFile[]> {
    return this.index().map(({ file: _f, ...m }) => m);
  }

  add(src: string, kind: string, issued?: string): VaultFile {
    mkdirSync(this.dir, { recursive: true });
    const id = randomUUID();
    const name = path.basename(src);
    const file = `${id}${path.extname(name)}`;
    copyFileSync(src, path.join(this.dir, file));
    const entry: DiskEntry = {
      id,
      name,
      kind,
      size: statSync(src).size,
      type: MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      issued,
      addedAt: new Date().toISOString(),
      file,
    };
    writeFileSync(path.join(this.dir, 'index.json'), `${JSON.stringify([...this.index(), entry], null, 2)}\n`);
    const { file: _f, ...meta } = entry;
    return meta;
  }

  async attach(frame: FrameRef, localKey: string, fileId: string): Promise<AttachOutcome> {
    const e = this.index().find((x) => x.id === fileId);
    if (!e) return { ok: false, message: '보관함에 그 파일이 없어요' };
    const payload: FilePayload = {
      name: e.name,
      type: e.type,
      size: e.size,
      issued: e.issued,
      lastModified: Date.parse(e.addedAt) || Date.now(),
      b64: readFileSync(path.join(this.dir, e.file)).toString('base64'),
    };
    return frame.call<AttachOutcome>('attachFile', localKey, payload);
  }
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 파일 지정: id, 종류, 이름 순으로 찾는다. 여러 개면 고를 수 있게 돌려준다 */
export function pickFile(files: VaultFile[], ref: string): { file?: VaultFile; error?: string } {
  const byId = files.find((f) => f.id === ref) ?? (ref.length >= 8 ? files.find((f) => f.id.startsWith(ref)) : undefined);
  if (byId) return { file: byId };
  const r = norm(ref);
  for (const by of [(f: VaultFile) => norm(f.kind) === r, (f: VaultFile) => norm(f.name) === r, (f: VaultFile) => norm(f.name).includes(r) || norm(f.kind).includes(r)]) {
    const hits = files.filter(by);
    if (hits.length === 1) return { file: hits[0] };
    if (hits.length > 1) return { error: `"${ref}"에 맞는 파일이 여러 개예요: ${hits.map((f) => `${f.id.slice(0, 8)} ${f.name}`).join(', ')} — id로 보내 주세요` };
  }
  return { error: `보관함에 "${ref}" 파일이 없어요` };
}

/** 업로드 칸 라벨에 맞는 보관함 파일 (하나만 맞을 때만. 자동 첨부용) */
export function fileForLabel(files: VaultFile[], label: string): VaultFile | undefined {
  const l = norm(label);
  const hits = files.filter((f) => {
    const k = norm(f.kind);
    return k.length >= 2 && l.length >= 3 && (l.includes(k) || k.includes(l));
  });
  return hits.length === 1 ? hits[0] : undefined;
}
