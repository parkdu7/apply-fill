// 파일 첨부: 보관함 파일을 업로드 칸(input[type=file])에 DataTransfer로 넣는다.
// 넣기 전에 칸의 accept(형식), 주변 안내문의 크기 제한("10MB 이하")·발급일 제한("3개월 이내")을 확인한다.
// 이미 파일이 있는 칸은 덮어쓰지 않는다. 넣은 뒤 페이지에 보이는 파일 이름을 다시 읽어 확인한다.
import { clean, sleep } from './util.js';

export interface FilePayload {
  name: string;
  type: string;
  size: number;
  /** 발급일 YYYY-MM-DD (보관함에 적어 둔 경우) */
  issued?: string;
  lastModified: number;
  b64: string;
}

export interface AttachResult {
  ok: boolean;
  /** 페이지에 보이는 파일 이름 */
  shown?: string;
  message?: string;
}

const SIZE_NOTICE = /(?:최대|용량|크기|size|up\s*to)?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|메가|킬로)\s*(?:이하|이내|까지|미만|를\s*넘|초과\s*불가|max)?/i;
const AGE_NOTICE = /(\d+)\s*(개월|달|일)\s*이내\s*(?:발급|발행)?/;

/** 업로드 칸: 키가 붙은 요소가 input이 아니면(커스텀 업로드 버튼) 가까운 input[type=file]을 찾는다 */
export function fileInputOf(el: Element | null): HTMLInputElement | null {
  if (!el) return null;
  if (el instanceof HTMLInputElement && el.type === 'file') return el;
  let box: Element | null = el;
  for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
    const inputs = box.querySelectorAll<HTMLInputElement>('input[type="file"]');
    if (inputs.length === 1) return inputs[0];
  }
  return null;
}

/** 칸 주변 안내문 (크기·형식·발급일 제한이 적혀 있는 곳) */
export function noticeOf(input: HTMLInputElement): string {
  const parts: string[] = [];
  let box: Element | null = input.parentElement;
  for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
    const t = clean(box.textContent ?? '');
    if (t) parts.push(t);
    // 다른 업로드 칸까지 넘어가면 그만
    if (box.querySelectorAll('input[type="file"]').length > 1) break;
    if (t.length > 400) break;
  }
  return parts[parts.length - 1]?.slice(0, 400) ?? '';
}

function acceptOk(accept: string, name: string, type: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  const lower = name.toLowerCase();
  const mime = (type || '').toLowerCase();
  return tokens.some((t) => (t.startsWith('.') ? lower.endsWith(t) : t.endsWith('/*') ? mime.startsWith(t.slice(0, -1)) : mime === t));
}

export function sizeLimit(notice: string): number | undefined {
  const m = SIZE_NOTICE.exec(notice);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  const mult = unit === 'KB' || unit === '킬로' ? 1024 : unit === 'GB' ? 1024 ** 3 : 1024 * 1024;
  return n * mult;
}

/** "3개월 이내 발급" → 그 날짜 이후 발급이어야 한다 (YYYY-MM-DD) */
export function issuedAfter(notice: string, today = new Date()): { since: string; text: string } | undefined {
  const m = AGE_NOTICE.exec(notice);
  if (!m) return undefined;
  const n = Number(m[1]);
  const d = new Date(today);
  if (m[2] === '일') d.setDate(d.getDate() - n);
  else d.setMonth(d.getMonth() - n);
  return { since: d.toISOString().slice(0, 10), text: m[0] };
}

function toFile(p: FilePayload): File {
  const bin = atob(p.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], p.name, { type: p.type || 'application/octet-stream', lastModified: p.lastModified });
}

/** 업로드 칸이 받는지 미리 확인 (첨부하지 않음) */
export function checkFile(input: HTMLInputElement, p: Pick<FilePayload, 'name' | 'type' | 'size' | 'issued'>): string | undefined {
  if (input.disabled) return '비활성화된 업로드 칸이에요';
  if (input.files?.length && !input.multiple) return `이미 첨부된 파일이 있어요 (${input.files[0].name}) — 덮어쓰지 않아요`;
  const accept = input.getAttribute('accept') ?? '';
  if (accept && !acceptOk(accept, p.name, p.type)) return `이 칸은 ${accept} 형식만 받아요 (${p.name})`;
  const notice = noticeOf(input);
  const limit = sizeLimit(notice);
  if (limit && p.size > limit) return `크기 제한을 넘어요: ${(p.size / 1024 / 1024).toFixed(1)}MB > 안내문 "${SIZE_NOTICE.exec(notice)?.[0].trim()}"`;
  const age = issuedAfter(notice);
  if (age && p.issued && p.issued < age.since) return `발급일(${p.issued})이 안내문 "${age.text}" 조건보다 오래됐어요 — 새로 발급받은 파일이 필요해요`;
  return undefined;
}

function shownName(input: HTMLInputElement, name: string): string | undefined {
  if (input.files?.[0]?.name !== name) return undefined;
  // 확장자까지 같은 이름이 보여야 한다 (라벨 "증명사진"이 파일 "사진.png"의 이름과 겹치지 않게)
  let box: Element | null = input.parentElement;
  for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
    if ((box.textContent ?? '').includes(name)) return name;
  }
  // 이름을 화면에 안 그리는 사이트도 있다: input에 들어간 것만 확인
  return undefined;
}

export async function attachFile(key: string, p: FilePayload): Promise<AttachResult> {
  const el = document.querySelector(`[data-clf="${key}"]`);
  const input = fileInputOf(el);
  if (!input) return { ok: false, message: '업로드 칸(input[type=file])을 찾지 못했어요 — 직접 첨부해 주세요' };
  const bad = checkFile(input, p);
  if (bad) return { ok: false, message: bad };
  const file = toFile(p);
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await sleep(300);
  // input을 안 보고 드롭만 받는 업로드 영역: 드롭 이벤트로 한 번 더
  if (input.files?.[0]?.name !== p.name || !shownName(input, p.name)) {
    const zone = input.closest('[class*="drop" i], [class*="upload" i], [class*="file" i], label') ?? input.parentElement;
    if (zone && !shownName(input, p.name)) {
      const dt2 = new DataTransfer();
      dt2.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt2 }));
      await sleep(300);
    }
  }
  if (input.files?.[0]?.name !== p.name && !shownName(input, p.name)) return { ok: false, message: '파일을 넣었지만 칸에 반영되지 않았어요 — 직접 첨부해 주세요' };
  (el as HTMLElement | null)?.setAttribute('data-clf-filled', '1');
  const shown = shownName(input, p.name);
  const age = issuedAfter(noticeOf(input));
  const note = age && !p.issued ? `안내문 "${age.text}" — 발급일을 확인해 주세요` : undefined;
  return { ok: true, shown, message: [shown ? undefined : '페이지에 파일 이름이 보이지 않아요 (사이트가 이름을 안 그릴 수 있음)', note].filter(Boolean).join(' / ') || undefined };
}
