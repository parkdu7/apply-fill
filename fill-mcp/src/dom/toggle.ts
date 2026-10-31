// 라디오처럼 하나를 고르는 버튼 묶음 (토글 버튼, li > button 묶음, role=radio).
// 고른 버튼은 aria → 클래스 → 생김새(색·굵기·그림자) 순서로 찾는다. aria 없이 색만 바꾸는 사이트(ats-)가 있다.
import { clean, textOf, visible } from './util.js';

const SELECTED_CLASS = /(^|[\s_-])(selected|active|checked|current|on)($|[\s_-])|Mui-selected/i;

export function toggleOptions(group: Element): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>('button, [role="radio"]')).filter((b) => visible(b));
}

export function isDisabledButton(b: Element): boolean {
  return (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true';
}

/** 글자가 실제로 그려지는 요소 (버튼 안 <p>가 따로 굵기·색을 가질 수 있다) */
function textNode(b: Element): Element {
  let e: Element = b;
  while (e.children.length === 1 && clean(e.children[0].textContent) === clean(e.textContent)) e = e.children[0];
  return e;
}

function look(b: HTMLElement): string {
  const s = getComputedStyle(b);
  const t = getComputedStyle(textNode(b));
  return [s.backgroundColor, s.boxShadow, s.borderColor, s.fontWeight, t.color, t.fontWeight].join('|');
}

function emphasis(b: HTMLElement): number {
  const s = getComputedStyle(b);
  const t = getComputedStyle(textNode(b));
  let n = 0;
  if (s.boxShadow && s.boxShadow !== 'none') n++;
  if (Number(t.fontWeight) >= 600 || Number(s.fontWeight) >= 600) n++;
  if (b.style.color || b.style.backgroundColor) n++;
  return n;
}

/** 생김새로 고른 버튼 찾기: 셋 이상이면 혼자 다른 것, 둘이면 더 강조된 것 */
function oddOneOut(opts: HTMLElement[]): HTMLElement | undefined {
  const enabled = opts.filter((b) => !isDisabledButton(b));
  if (enabled.length < 2) return undefined;
  const looks = enabled.map(look);
  if (enabled.length >= 3) {
    if (new Set(looks).size !== 2) return undefined;
    const odd = enabled.filter((_, i) => looks.filter((x) => x === looks[i]).length === 1);
    return odd.length === 1 ? odd[0] : undefined;
  }
  if (looks[0] === looks[1]) return undefined;
  const e = enabled.map(emphasis);
  return e[0] === e[1] ? undefined : enabled[e[0] > e[1] ? 0 : 1];
}

/** 묶음에서 지금 고른 버튼 */
export function pressedToggle(group: Element): HTMLElement | undefined {
  const opts = toggleOptions(group);
  const aria = opts.find((b) => ['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => b.getAttribute(a) === 'true'));
  if (aria) return aria;
  // aria 상태를 쓰는 묶음이면 그것만 믿는다
  if (opts.some((b) => b.hasAttribute('aria-pressed') || b.hasAttribute('aria-checked'))) return undefined;
  const byClass = opts.filter((b) => SELECTED_CLASS.test(String(b.className)));
  if (byClass.length === 1) return byClass[0];
  return oddOneOut(opts);
}

/** 묶음 전체의 생김새 (누른 뒤 뭔가 바뀌었는지 볼 때) */
export function groupLook(group: Element): string {
  return toggleOptions(group).map(look).join('#');
}

export function optionText(b: Element): string {
  return clean(textOf(b, 40));
}
