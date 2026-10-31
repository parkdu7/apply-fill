// 확장 드라이버용 입력: 실제 마우스·키보드가 없는 환경(content script)에서 사람 입력을 흉내 낸다.
// Playwright 드라이버는 실제 입력을 쓰고, 이 함수들은 쓰지 않는다.
// Escape 키는 보내지 않는다 (편집 팝업이 닫혀 입력한 행이 사라진다).
import { classifyButton } from './actions.js';
import type { KeyActionName } from './types.js';
import { fireBlur, fireChange, fireInput, pointerClick, setNativeValue, sleep } from './util.js';

function target(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`요소를 찾지 못함: ${selector}`);
  return el;
}

/** 클릭: 화면에 보이게 스크롤한 뒤 pointer/mouse/click 순서로. 제출 계열 버튼은 여기서도 거부 */
export function clickSelector(selector: string): boolean {
  const el = target(selector);
  if (el.dataset.clfKind?.startsWith('button:') && classifyButton(el).kind === 'blocked') throw new Error('제출·삭제 계열 버튼은 누르지 않아요');
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  el.focus?.();
  pointerClick(el);
  return true;
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editable(el: HTMLElement): el is Editable {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** 칸 값을 통째로 바꾼다 (Playwright fill과 같은 의미: 포커스 → 값 → input/change) */
export function setValueSelector(selector: string, value: string): boolean {
  const el = target(selector);
  el.focus();
  if (editable(el)) {
    setNativeValue(el, value);
    fireInput(el, value);
    fireChange(el);
  } else if (el.isContentEditable) {
    el.textContent = value;
    fireInput(el, value);
  }
  return true;
}

function key(el: HTMLElement, type: 'keydown' | 'keyup' | 'keypress', k: string, code = k): boolean {
  return el.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, composed: true }));
}

export function pressKey(selector: string, action: KeyActionName): boolean {
  const el = target(selector);
  if (action === 'tab') {
    key(el, 'keydown', 'Tab');
    fireBlur(el);
    key(el, 'keyup', 'Tab');
    el.blur();
    return true;
  }
  if (!editable(el)) return true;
  if (action === 'selectAll') {
    el.focus();
    el.select?.();
    return true;
  }
  // backspace: 선택 영역(없으면 마지막 글자)을 지운다
  key(el, 'keydown', 'Backspace');
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = start !== end ? el.value.slice(0, start) + el.value.slice(end) : el.value.slice(0, Math.max(0, start - 1)) + el.value.slice(start);
  el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  setNativeValue(el, next);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
  key(el, 'keyup', 'Backspace');
  return true;
}

/** 한 글자씩 친다: keydown → beforeinput → 값 → input → keyup. 키 입력에만 검색하는 칸용 */
export async function typeText(selector: string, text: string, delayMs = 30): Promise<boolean> {
  const el = target(selector);
  el.focus();
  for (const ch of text) {
    key(el, 'keydown', ch, `Key${ch.toUpperCase()}`);
    key(el, 'keypress', ch, `Key${ch.toUpperCase()}`);
    if (editable(el)) {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
      setNativeValue(el, el.value + ch);
      fireInput(el, ch);
    } else if (el.isContentEditable) {
      el.textContent = (el.textContent ?? '') + ch;
      fireInput(el, ch);
    }
    key(el, 'keyup', ch, `Key${ch.toUpperCase()}`);
    if (delayMs) await sleep(delayMs);
  }
  return true;
}

export function attrOf(selector: string, name: string): string | null {
  return document.querySelector(selector)?.getAttribute(name) ?? null;
}

/** 진짜 입력(chrome.debugger)용: 화면에 보이게 스크롤한 뒤 이 프레임 안에서의 가운데 좌표 */
export function rectOf(selector: string): { x: number; y: number; w: number; h: number } {
  const el = target(selector);
  if (el.dataset.clfKind?.startsWith('button:') && classifyButton(el).kind === 'blocked') throw new Error('제출·삭제 계열 버튼은 누르지 않아요');
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

export function focusSel(selector: string): boolean {
  const el = target(selector);
  el.focus();
  if (editable(el)) el.setSelectionRange?.(el.value.length, el.value.length);
  return document.activeElement === el;
}

/** 자식 프레임(주소로 찾음)의 이 프레임 안 위치. 진짜 클릭 좌표를 메인 프레임 기준으로 바꿀 때 쓴다 */
export function frameOffset(url: string): { x: number; y: number } | null {
  for (const f of document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>('iframe, frame')) {
    let href = f.src;
    try {
      href = f.contentWindow?.location.href ?? href;
    } catch {
      // 다른 origin이면 src로 비교
    }
    if (href === url || f.src === url) {
      const r = f.getBoundingClientRect();
      return { x: r.left + f.clientLeft, y: r.top + f.clientTop };
    }
  }
  return null;
}
