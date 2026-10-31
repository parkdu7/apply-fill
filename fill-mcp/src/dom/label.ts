// 입력 칸의 라벨과 섹션 찾기. 사이트마다 마크업이 달라서 여러 방법을 순서대로 시도한다.
import { CONTROL_SELECTOR, clean, hasControls, isLabelEditable, meaningful, precedes, textOf, visible } from './util.js';

const MAX_LABEL = 60;

/** 찾은 라벨과, 그 글자를 가져온 노드 (분할 칸/반복 행 구분에 쓴다) */
export interface LabelHit {
  text: string;
  src: Node | null;
}

const hit = (text: string, src: Node | null): LabelHit | null => (text ? { text, src } : null);

function byAriaLabelledby(el: Element): LabelHit | null {
  const refs = (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter((id) => id && id !== el.id)
    .map((id) => document.getElementById(id))
    .filter((e): e is HTMLElement => !!e);
  return hit(clean(refs.map((e) => textOf(e)).join(' ')), refs[0] ?? null);
}

function byLabelElement(el: Element): LabelHit | null {
  const labels = (el as HTMLInputElement).labels;
  if (!labels) return null;
  for (const l of Array.from(labels)) {
    const t = textOf(l);
    if (t) return { text: t, src: l };
  }
  return null;
}

/** MUI FormControl 안의 InputLabel/FormLabel (id 연결이 없을 때) */
function formControlLabel(fc: Element | null, selector: string): Element | null {
  if (!fc) return null;
  return Array.from(fc.querySelectorAll(selector)).find((l) => !l.closest('[aria-hidden="true"]')) ?? null;
}

function byFormControl(el: Element): LabelHit | null {
  const l = formControlLabel(el.closest('[class*="FormControl-root"]'), 'label, legend, [class*="FormLabel-root"], [class*="InputLabel-root"]');
  return l && !l.contains(el) ? hit(textOf(l), l) : null;
}

function columnIndex(cell: HTMLTableCellElement): number {
  let i = 0;
  for (let c = cell.previousElementSibling as HTMLTableCellElement | null; c; c = c.previousElementSibling as HTMLTableCellElement | null) {
    i += c.colSpan || 1;
  }
  return i;
}

function headerCellAt(row: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
  let i = 0;
  for (const c of Array.from(row.cells)) {
    const span = c.colSpan || 1;
    if (col >= i && col < i + span) return c;
    i += span;
  }
  return null;
}

function isHeaderRow(row: HTMLTableRowElement | undefined): boolean {
  if (!row || row.cells.length < 2) return false;
  return Array.from(row.cells).every((c) => c.tagName === 'TH' || (!hasControls(c) && !!textOf(c)));
}

/** 표 레이아웃: 같은 행의 th(행 머리) 그리고/또는 같은 열의 머리글 */
function byTable(el: Element): LabelHit | null {
  const cell = el.closest('td, th') as HTMLTableCellElement | null;
  if (!cell) return null;
  const row = cell.parentElement as HTMLTableRowElement;
  let rowHead: HTMLTableCellElement | null = null;
  for (let p = cell.previousElementSibling as HTMLTableCellElement | null; p; p = p.previousElementSibling as HTMLTableCellElement | null) {
    if (p.tagName === 'TH' || (!hasControls(p) && textOf(p).length <= 30)) {
      const t = textOf(p);
      if (t && meaningful(t)) {
        rowHead = p;
        break;
      }
    }
  }
  let colHead: HTMLTableCellElement | null = null;
  const table = cell.closest('table');
  if (table) {
    const head = (table.tHead?.rows[0] ?? table.rows[0]) as HTMLTableRowElement | undefined;
    if (head && head !== row && isHeaderRow(head)) colHead = headerCellAt(head, columnIndex(cell));
  }
  const r = rowHead ? textOf(rowHead) : '';
  const c = colHead ? textOf(colHead) : '';
  if (r && c && r !== c) return { text: `${r} › ${c}`, src: colHead };
  return hit(c || r, colHead ?? rowHead);
}

function byDefinitionList(el: Element): LabelHit | null {
  const dd = el.closest('dd');
  if (!dd) return null;
  for (let p = dd.previousElementSibling; p; p = p.previousElementSibling) {
    if (p.tagName === 'DT') return hit(textOf(p), p);
  }
  return null;
}

// ---------- 라벨 상자 (폼 빌더: <label> 없이 칸 위에 div.label / contenteditable 라벨) ----------

/** 라벨을 그리는 상자의 클래스: "label" 단어, 또는 EditableLabel·FieldLabel 같은 컴포넌트 이름 */
const LABEL_BOX = (c: string) => /(^|[\s_-])label($|[\s_-])/i.test(c) || /[a-z]Label($|[\s_-])/.test(c);
/** 칸으로 보는 것 (라벨과 칸 사이에 다른 칸이 끼었는지 볼 때) */
const FIELDISH = `${CONTROL_SELECTOR}, [data-clf-drop="1"], .ant-dropdown-trigger, .ant-select-selector`;
// 한 라벨 아래 칸이 여러 줄로 쌓이는 경우(주소: 우편번호 / 도로명주소 / 상세주소)까지
const MAX_GAP_ABOVE = 100;
const MAX_GAP_LEFT = 160;

function labelBoxes(scope: Element): Element[] {
  const boxes = Array.from(scope.querySelectorAll('[class*="label" i], [contenteditable=""], [contenteditable="true"]')).filter(
    (b) =>
      (isLabelEditable(b) || LABEL_BOX(String((b as HTMLElement).className ?? ''))) &&
      // 선택지 라벨(체크박스·라디오 옆 글자)과 <label>/<legend>는 다른 단계에서 읽는다
      !b.closest('label, legend, button, [role="button"], [role="listbox"], [role="menu"], [class*="ControlLabel"], [class*="checkbox" i], [class*="radio" i]') &&
      !hasControls(b) &&
      visible(b),
  );
  // 라벨 여러 개를 담은 줄(div.label-row)은 라벨이 아니다. 나머지 겹친 상자는 바깥 것 (div.label 안에 EditableLabel + 필수 표시 *)
  const single = boxes.filter((b) => boxes.filter((o) => o !== b && b.contains(o) && !o.contains(b)).length < 2);
  return single.filter((b) => !single.some((o) => o !== b && o.contains(b))).filter((b) => {
    const t = textOf(b, 80);
    return !!t && t.length <= MAX_LABEL && meaningful(t);
  });
}

type Rect = DOMRect;
const overlapX = (a: Rect, b: Rect) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
const overlapY = (a: Rect, b: Rect) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

/** 라벨 상자와 칸 사이(위→아래 또는 왼쪽→오른쪽)에 다른 칸이 있는지: 있으면 그 라벨은 그 칸의 것 */
function fieldBetween(scope: Element, box: Rect, el: Element, r: Rect, above: boolean): boolean {
  return Array.from(scope.querySelectorAll(FIELDISH)).some((c) => {
    if (c === el || c.contains(el) || el.contains(c) || isLabelEditable(c) || !visible(c)) return false;
    const cr = c.getBoundingClientRect();
    if (!cr.width && !cr.height) return false;
    return above
      ? overlapX(cr, box) > 0 && cr.top >= box.bottom - 2 && cr.bottom <= r.top + 2
      : overlapY(cr, r) > 0 && cr.left >= box.right - 2 && cr.right <= r.left + 2;
  });
}

/**
 * 칸에서 가장 가까운 라벨 상자: 바로 위(가로로 겹침) 또는 같은 줄 왼쪽.
 * 라벨 줄과 칸 줄이 따로 있는 표 모양(프로그램 | 활용 수준 | 사용 기간)도 칸마다 제 열의 라벨을 고른다.
 * 가까운 상자부터 넓혀 가며 찾고, 그 사이에 다른 칸이 있으면 남의 라벨이라 쓰지 않는다.
 */
export function byLabelBlock(el: Element): LabelHit | null {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  let scope = el.parentElement;
  for (let depth = 0; scope && depth < 6 && scope !== document.body; depth++, scope = scope.parentElement) {
    let best: { box: Element; rect: Rect; gap: number; above: boolean } | null = null;
    for (const box of labelBoxes(scope)) {
      if (box.contains(el) || !precedes(box, el)) continue;
      const b = box.getBoundingClientRect();
      let gap: number;
      let above = true;
      if (b.bottom <= r.top + 4 && overlapX(b, r) > 0) gap = r.top - b.bottom;
      else if (b.right <= r.left + 4 && overlapY(b, r) > 0) {
        gap = r.left - b.right;
        above = false;
      } else continue;
      if (gap > (above ? MAX_GAP_ABOVE : MAX_GAP_LEFT)) continue;
      if (!best || gap < best.gap) best = { box, rect: b, gap, above };
    }
    if (!best) continue;
    return fieldBetween(scope, best.rect, el, r, best.above) ? null : hit(textOf(best.box, 80), best.box);
  }
  return null;
}

/** 글자가 있는 버튼이거나 그런 버튼을 품은 요소. 버튼 글자("관계를 선택해주세요.", "비대상 대상")는 라벨이 아니다. */
function hasTextButton(e: Element): boolean {
  const buttons = e.matches('button, [role="button"]') ? [e] : Array.from(e.querySelectorAll('button, [role="button"]'));
  return buttons.some((b) => meaningful(textOf(b, 40)));
}

/**
 * 칸 앞에 있는 짧은 글자. 조상으로 올라가며 이전 형제를 본다.
 * 다른 입력 칸이나 버튼을 건너서 찾은 글자는 far=true (placeholder가 있으면 그쪽이 더 정확하다).
 */
export function byPrecedingText(el: Element): (LabelHit & { far: boolean }) | null {
  let node: Element | null = el;
  let far = false;
  for (let depth = 0; node && depth < 6 && node !== document.body; depth++) {
    let blocked = false;
    let sib: Node | null = node.previousSibling;
    for (let hops = 0; sib && hops < 5; hops++, sib = sib.previousSibling) {
      if (sib.nodeType === Node.TEXT_NODE) {
        const t = clean(sib.nodeValue);
        if (t && meaningful(t) && t.length <= 40) return { text: t, src: sib, far };
        continue;
      }
      if (sib.nodeType !== Node.ELEMENT_NODE) continue;
      const e = sib as Element;
      if (hasControls(e)) {
        blocked = true;
        break;
      }
      if (!visible(e)) continue;
      if (hasTextButton(e)) {
        blocked = true;
        break;
      }
      const t = textOf(e, 80);
      if (t && meaningful(t)) {
        if (t.length <= 40) return { text: t, src: e, far };
        blocked = true;
        break;
      }
    }
    if (blocked) far = true;
    node = node.parentElement;
  }
  return null;
}

function trimLabel(s: string): string {
  return clean(s).slice(0, MAX_LABEL);
}

/**
 * placeholder에서 칸 이름만: "병과를 입력해주세요." → "병과", "지원경로를 선택해주세요." → "지원경로", "입대일" → "입대일".
 * 예시 값("예) 홍길동", "YYYY.MM.DD", "010-0000-0000")은 이름이 아니라서 빈 값.
 */
export function placeholderNoun(ph: string | null | undefined): string {
  const s = clean(ph);
  if (!s || /^(예|ex|e\.g)\s*[).:]/i.test(s) || /\d/.test(s) || !/[가-힣]/.test(s)) return '';
  const noun = clean(s.replace(/\s*(을|를)?\s*(입력|선택|검색)\s*(해\s*주세요|하세요|해\s*주십시오|하십시오|바랍니다)?\s*[.!]?$/, ''));
  return noun.length <= 15 && noun.split(' ').length <= 3 ? noun : '';
}

/**
 * 일반 입력 칸의 라벨.
 * row: 다른 칸·버튼을 건너서 찾은 줄 라벨 (placeholder를 라벨로 쓴 경우). 한 줄에 칸이 여러 개면 "줄 라벨 › 칸 이름"으로 합친다.
 */
export function fieldLabel(el: Element): LabelHit & { row?: LabelHit } {
  const direct =
    byAriaLabelledby(el) ??
    hit(clean(el.getAttribute('aria-label')), el) ??
    byLabelElement(el) ??
    byFormControl(el) ??
    byTable(el) ??
    byDefinitionList(el) ??
    byLabelBlock(el);
  if (direct) return { text: trimLabel(direct.text), src: direct.src };
  const placeholder = clean(el.getAttribute('placeholder'));
  const pre = byPrecedingText(el);
  if (pre && !(pre.far && placeholder)) return { text: trimLabel(pre.text), src: pre.src };
  const fallback = placeholderNoun(placeholder) || placeholder || clean(el.getAttribute('title')) || clean(el.getAttribute('name'));
  const out: LabelHit & { row?: LabelHit } = { text: trimLabel(fallback), src: el };
  if (pre?.far) out.row = { text: trimLabel(pre.text), src: pre.src };
  return out;
}

/** 라디오/체크박스의 선택지 라벨 ("남", "여") */
export function optionLabel(input: HTMLInputElement): string {
  const t = byLabelElement(input)?.text || clean(input.getAttribute('aria-label'));
  if (t) return trimLabel(t);
  // <input> 남 처럼 바로 뒤에 글자가 오는 경우
  for (let n = input.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE && clean(n.nodeValue)) return trimLabel(n.nodeValue ?? '');
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (hasControls(n as Element)) break;
      const s = textOf(n as Element);
      if (s) return trimLabel(s);
    }
  }
  return clean(input.value);
}

function commonAncestor(els: Element[]): Element | null {
  let a: Element | null = els[0]?.parentElement ?? null;
  while (a && !els.every((e) => a!.contains(e))) a = a.parentElement;
  // 라디오 하나만 감싸는 label이면 한 단계 위로
  if (a && a.tagName === 'LABEL') a = a.parentElement;
  return a;
}

/** 라디오 그룹/체크박스 묶음의 라벨 ("성별") */
export function groupLabel(inputs: HTMLInputElement[]): LabelHit {
  const first = inputs[0];
  const group = first.closest('[role="radiogroup"], [role="group"], fieldset');
  if (group) {
    const h =
      byAriaLabelledby(group) ??
      hit(clean(group.getAttribute('aria-label')), group) ??
      (group.tagName === 'FIELDSET' ? hit(textOf(group.querySelector('legend')), group.querySelector('legend')) : null);
    if (h) return { text: trimLabel(h.text), src: h.src };
  }
  const container = commonAncestor(inputs) ?? first.parentElement ?? first;
  const fcLabel = formControlLabel(container.closest('[class*="FormControl-root"]'), 'legend, [class*="FormLabel-root"]');
  if (fcLabel && textOf(fcLabel)) return { text: trimLabel(textOf(fcLabel)), src: fcLabel };
  const h =
    byTable(container) ??
    byDefinitionList(container) ??
    byLabelBlock(container) ??
    byPrecedingText(first.closest('label') ?? first) ??
    byPrecedingText(group ?? container);
  return h ? { text: trimLabel(h.text), src: h.src } : { text: '', src: null };
}

/** 칸 바로 뒤의 짧은 글자(단위, "/ 4.5")와 MUI 도움말 */
export function hintOf(el: Element): string {
  const parts: string[] = [];
  const fc = el.closest('[class*="FormControl-root"], [class*="TextField-root"]');
  const helper = fc?.querySelector('[class*="FormHelperText-root"]');
  if (helper) parts.push(textOf(helper, 80));
  const anchor = fc ?? el;
  for (let n = anchor.nextSibling, i = 0; n && i < 3; n = n.nextSibling, i++) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = clean(n.nodeValue);
      if (t) {
        if (t.length <= 15) parts.push(t);
        break;
      }
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const e = n as Element;
    // 줄을 바꾸는 블록(다음 섹션 제목 등)은 이 칸의 보조 문구가 아니다
    if (hasControls(e) || !visible(e) || !getComputedStyle(e).display.startsWith('inline')) break;
    const t = textOf(e, 40);
    if (t && t.length <= 15) parts.push(t);
    break;
  }
  return clean(parts.filter(Boolean).join(' · ')).slice(0, 100);
}

// ---------- 섹션 ----------

const HEADING_SELECTOR =
  'h1, h2, h3, h4, h5, h6, legend, caption, [role="heading"], [class*="CardHeader-title"], [class*="title" i], [class*="tit" i], [class*="heading" i]';

export interface Heading {
  el: Element;
  text: string;
  level: number;
}

export function collectHeadings(root: ParentNode = document): Heading[] {
  const out: Heading[] = [];
  for (const el of Array.from(root.querySelectorAll(HEADING_SELECTOR))) {
    // MUI OutlinedInput의 <fieldset><legend>는 라벨 복사본이라 제외 (aria-hidden)
    if (el.tagName === 'LABEL' || el.closest('label, button, a, [role="listbox"], option, [aria-hidden="true"], [class*="FormLabel"], [class*="InputLabel"]')) continue;
    if (hasControls(el) || !visible(el)) continue;
    const text = textOf(el, 60);
    if (!text || text.length > 40 || !meaningful(text)) continue;
    const last = out[out.length - 1];
    if (last && last.el.contains(el)) continue; // 중첩된 제목 요소는 바깥 것만
    const m = /^H([1-6])$/.exec(el.tagName);
    const level = m ? Number(m[1]) : Number(el.getAttribute('aria-level')) || (el.tagName === 'LEGEND' || el.tagName === 'CAPTION' ? 6 : 7);
    out.push({ el, text, level });
  }
  return out;
}

const CARD_HEADER = /CardHeader-root/;

function cardHeaderText(header: Element): string {
  return textOf(header.querySelector('[class*="CardHeader-content"]') ?? header, 60);
}

/**
 * 카드형 레이아웃의 섹션 제목 (careerlink: resume-* 카드의 CardHeader).
 * 편집 팝업 안이면 팝업 제목. 카드 머리글 안의 버튼(추가 아이콘)이면 그 머리글.
 */
export function containerTitle(el: Element): string {
  const dialog = el.closest('[role="dialog"], [role="alertdialog"], dialog');
  if (dialog) {
    const t = textOf(dialog.querySelector('h1, h2, h3, [class*="DialogTitle"]'), 60);
    if (t) return t;
  }
  const ownHeader = el.closest('[class*="CardHeader-root"]');
  if (ownHeader) return cardHeaderText(ownHeader);
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const header = Array.from(a.children).find((c) => CARD_HEADER.test(String((c as HTMLElement).className)));
    if (header && !header.contains(el)) {
      const t = cardHeaderText(header);
      if (t) return t;
    }
  }
  return '';
}

/** 섹션 이름: 카드 머리글/팝업 제목을 먼저, 없으면 앞에 나온 가장 가까운 제목 + 그보다 상위 제목 */
export function sectionOf(el: Element, headings: Heading[]): string {
  const card = containerTitle(el);
  if (card) return card;
  let lo = 0;
  let hi = headings.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (precedes(headings[mid].el, el)) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return '';
  const near = headings[idx];
  // 본문의 맨 첫 제목은 보통 페이지/공고 제목이라 상위 섹션으로 붙이지 않는다 (머리글·단계 내비의 제목은 건너뛰고 센다)
  const first = Math.max(0, headings.findIndex((h) => !h.el.closest('header, [role="banner"], nav, [role="navigation"]')));
  for (let i = idx - 1; i >= first + 1; i--) {
    const h = headings[i];
    if (h.level < near.level && h.text !== near.text) return `${h.text} › ${near.text}`;
  }
  return near.text;
}
