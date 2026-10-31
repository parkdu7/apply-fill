export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/[​ ﻿]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 비교용: 공백 제거 + 소문자 */
export function squash(s: string | null | undefined): string {
  return clean(s).replace(/\s+/g, '').toLowerCase();
}

export function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

export const CONTROL_SELECTOR =
  'input, select, textarea, [contenteditable=""], [contenteditable="true"], [aria-haspopup="listbox"], [role="combobox"]';

type VisibilityCheckable = Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };

export function visible(el: Element | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  const v = el as VisibilityCheckable;
  if (v.checkVisibility && !v.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/** el 안의 텍스트. select 옵션, textarea, 스크립트 등은 뺀다. */
export function textOf(el: Element | null | undefined, max = 200): string {
  if (!el) return '';
  let out = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (p && p !== el && p.closest('select, option, textarea, script, style, noscript, [role="listbox"]')) {
        return el.contains(p.closest('select, option, textarea, script, style, noscript, [role="listbox"]'))
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    out += walker.currentNode.nodeValue + ' ';
    if (out.length > max * 3) break;
  }
  return clean(out).slice(0, max);
}

/** 글 쓰는 에디터로 알려진 contenteditable (자기소개서 칸 등) */
const EDITOR_CLASS = /ql-editor|ProseMirror|DraftEditor|tiptap|mce-content|ck-editor|note-editable|se-contents|toastui/i;
const LABEL_CLASS = /label|title|desc|caption|heading/i;

/**
 * 폼 빌더(ninehire EditableLabel 등)가 라벨·설명을 그리는 contenteditable. 입력 칸이 아니다.
 * 자기 클래스나 부모 클래스가 라벨·제목·설명이고, 에디터(role=textbox, 알려진 에디터 클래스, 큰 상자)가 아닌 것.
 */
export function isLabelEditable(el: Element): boolean {
  if (!el.matches('[contenteditable=""], [contenteditable="true"]') || el.matches('[role="textbox"], [aria-multiline="true"]')) return false;
  if (el.getBoundingClientRect().height > 60) return false;
  for (let a: Element | null = el, i = 0; a && i < 2; a = a.parentElement, i++) {
    const c = String((a as HTMLElement).className ?? '');
    if (EDITOR_CLASS.test(c)) return false;
    if (LABEL_CLASS.test(c)) return true;
  }
  return false;
}

export function hasControls(el: Element): boolean {
  if (el.matches(CONTROL_SELECTOR) && !isLabelEditable(el)) return true;
  for (const c of Array.from(el.querySelectorAll(CONTROL_SELECTOR))) if (!isLabelEditable(c)) return true;
  return false;
}

/** 의미 있는 글자(한글/영문)가 있는지. "-", "~", "/" 같은 구분자는 라벨이 아니다. */
export function meaningful(s: string): boolean {
  return /[가-힣a-zA-Z]/.test(s);
}

/**
 * select에서 "사용자가 고른 값". 첫 항목이 그냥 기본으로 선택된 상태(직접입력, 4.5 등)는 빈 값으로 본다.
 * 다른 항목에 selected가 박혀 있으면(임시저장 불러오기 등) 값이 있는 것으로 본다.
 */
export function selectedText(el: HTMLSelectElement, ignoreDefault = true): string {
  const o = el.selectedOptions[0];
  if (!o) return '';
  const t = clean(o.text);
  if (!t || (/^[-=\s]*(선택|select|choose)/i.test(t) && t.length <= 15)) return '';
  if (ignoreDefault && o.index === 0 && (o.value === '' || !o.hasAttribute('selected'))) return '';
  return t;
}

type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** React/Vue 제어 컴포넌트도 인식하도록 프로토타입의 setter로 값을 넣는다. */
export function setNativeValue(el: ValueElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

export function fireInput(el: Element, data: string | null = null): void {
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data, inputType: 'insertText' }));
}

export function fireChange(el: Element): void {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fireKeyup(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
}

export function fireBlur(el: Element): void {
  el.dispatchEvent(new FocusEvent('blur'));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

export function pressEscape(el: Element): void {
  const o = { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' };
  el.dispatchEvent(new KeyboardEvent('keydown', o));
  el.dispatchEvent(new KeyboardEvent('keyup', o));
}

/** 마우스로 누른 것처럼 pointer/mouse/click 이벤트를 순서대로 보낸다. */
export function pointerClick(el: Element, only?: 'down'): void {
  const r = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    button: 0,
    view: window,
  };
  const p = { ...base, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', p));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  if (only === 'down') return;
  el.dispatchEvent(new PointerEvent('pointerup', p));
  el.dispatchEvent(new MouseEvent('mouseup', base));
  el.dispatchEvent(new MouseEvent('click', base));
}

export async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 1000, step = 30): Promise<T | undefined> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return undefined;
    await sleep(step);
  }
}

/** 문서 순서대로 a가 b보다 앞인지 */
export function precedes(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}
