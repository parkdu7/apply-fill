// 버튼 텍스트 읽기와 클릭 전 안전 확인
import { classifyButtonText } from './safety.js';
import type { ButtonInfo, ButtonKind } from './types.js';
import { clean, textOf, visible } from './util.js';

/** 아이콘만 있는 버튼의 이름 (MUI data-testid, tabler-icon 클래스) → 한국어 동작 이름 */
const ICON_WORDS: [RegExp, string][] = [
  [/^Add|plus/i, '추가'],
  [/Edit|pencil/i, '수정'],
  [/Delete|trash/i, '삭제'],
  [/Close|^x$/i, '닫기'],
  [/Search/i, '검색'],
];

function iconName(el: Element): string {
  const svg = el.querySelector('svg');
  if (!svg) return '';
  const id = svg.getAttribute('data-testid') ?? '';
  const tabler = /tabler-icon-([\w-]+)/.exec(svg.getAttribute('class') ?? '')?.[1] ?? '';
  return id || tabler;
}

/** 글자 없는 아이콘 버튼 바로 옆의 짧은 이름 (<button><svg/></button><p>직장경력</p>) */
function neighborText(el: Element): string {
  // 단계 이동 내비(<nav>의 아이콘 버튼 + 단계 이름)는 이름을 붙이지 않는다: 버튼 목록만 길어진다
  if (el.closest('nav, header')) return '';
  const n = el.nextElementSibling;
  if (!n || n.matches('button, [role="button"], input, select, textarea') || n.querySelector('button, input, select, textarea')) return '';
  const t = textOf(n, 30);
  return t.length <= 20 ? t : '';
}

/** 버튼이 들어 있는 모달(편집 팝업·확인창)의 글자. 모달 밖이면 undefined */
export function dialogTextOf(el: Element): string | undefined {
  const d = el.closest('[role="dialog"], [role="alertdialog"], dialog');
  return d ? textOf(d, 300) : undefined;
}

/** 화면에 보이는 버튼 이름 + 분류에 쓸 전체 문자열(aria-label, 아이콘 이름 포함) */
export function buttonText(el: HTMLElement): { text: string; probe: string } {
  const own = clean(el instanceof HTMLInputElement ? el.value || el.alt : textOf(el, 40));
  const aria = clean(el.getAttribute('aria-label') || el.getAttribute('title'));
  const icon = iconName(el);
  const iconWord = ICON_WORDS.find(([re]) => re.test(icon))?.[1] ?? '';
  const img = clean(el.querySelector('img[alt]')?.getAttribute('alt'));
  const text = (own.length <= 2 && aria ? aria : own) || aria || img || iconWord || neighborText(el) || icon;
  return { text: text.slice(0, 40), probe: `${own} ${aria} ${img} ${iconWord} ${icon}` };
}

export function classifyButton(el: HTMLElement): { text: string; kind: ButtonKind } {
  const { text, probe } = buttonText(el);
  const kind = classifyButtonText(probe, dialogTextOf(el));
  if (kind === 'other' && (el.matches('[role="tab"]') || el.closest('[role="tablist"]'))) return { text, kind: 'tab' };
  return { text, kind };
}

/** 클릭 직전에 버튼을 다시 읽어 분류한다. 스캔 이후 글자가 바뀌었을 수도 있으니까. */
export function buttonInfo(key: string): ButtonInfo | null {
  const el = document.querySelector<HTMLElement>(`[data-clf="${CSS.escape(key)}"]`);
  if (!el || !el.dataset.clfKind?.startsWith('button:') || !visible(el)) return null;
  const { text, kind } = classifyButton(el);
  const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
  return disabled ? { key, kind, text, disabled } : { key, kind, text };
}

/** Playwright 클릭이 안 될 때 쓰는 DOM 클릭. 제출 계열은 여기서도 거부. */
export function clickDom(key: string): boolean {
  const info = buttonInfo(key);
  if (!info || info.kind === 'blocked') return false;
  document.querySelector<HTMLElement>(`[data-clf="${CSS.escape(key)}"]`)?.click();
  return true;
}
