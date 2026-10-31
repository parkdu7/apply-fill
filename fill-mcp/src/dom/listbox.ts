// 커스텀 드롭다운(MUI Select, Autocomplete 등)의 팝업 목록 다루기.
// Escape는 쓰지 않는다: 목록이 이미 닫혀 있으면 Escape가 바깥 편집 팝업(Dialog)까지 닫아 입력한 행이 사라진다.
import { valueSynonyms } from './synonyms.js';
import { clean, digits, pointerClick, squash, textOf, visible, waitFor } from './util.js';

export interface OptionItem {
  el?: HTMLElement;
  text: string;
  value: string;
}

/**
 * 검색 결과 대신 입력한 글자를 그대로 쓰거나 DB에 새 항목을 만드는 항목.
 * "직접입력시 클릭", "'한국대' 등록하기", "'한빛고'(으)로 직접 입력하기", "새로 추가" 등. direct: true일 때만 누른다.
 */
export const DIRECT_OPTION = /^직접\s*입력|\(으\)로\s*직접\s*입력|^['"‘’“”].{1,40}['"‘’“”]\s*(을|를)?\s*(새로\s*)?(등록|추가)|(등록|추가)\s*하기$|^새로\s*(등록|추가)/;

/** 버튼 드롭다운의 안내문 ("관계를 선택해주세요.", "- 선택 -") */
export const PLACEHOLDER_TEXT = /선택\s*(해\s*주세요|하세요|해\s*주십시오|하십시오)|^[-\s]*(선택|select|choose)[-\s]*$/i;

/** 팝업 목록이 될 수 있는 요소. aria가 없는 사이트는 ul/ol이나 "dropdown" 이름을 단 상자에 목록을 그린다. */
const LIST_SELECTOR = '[role="listbox"], [role="menu"], ul, ol, [id*="dropdown" i], [class*="dropdown" i]';

export function openListboxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter((l) => visible(l));
}

/** 지금 보이는 목록 후보 전부 (누르기 전과 비교해서 새로 생긴 목록을 찾는다) */
export function visibleLists(): Set<Element> {
  return new Set(Array.from(document.querySelectorAll(LIST_SELECTOR)).filter((l) => visible(l)));
}

export function isPlaceholderOption(text: string, value: string): boolean {
  const t = clean(text);
  if (!t) return true;
  if (/^[-=\s]*(선택|select|choose)/i.test(t) && t.length <= 15) return true;
  return value === '' && /선택|전체/.test(t) && t.length <= 15;
}

/**
 * 목록 항목으로 보는 요소: role=option/menuitem, antd Select·Dropdown 항목(role 없는 div·li).
 * antd Select는 크기 0인 접근성용 role=listbox를 따로 두므로 보이는 항목을 먼저 쓴다.
 */
const ITEM_SELECTOR = '[role="option"], [role="menuitem"], [role="menuitemradio"], .ant-select-item-option, .ant-dropdown-menu-item';
const DISABLED_ITEM = /-disabled(\s|$)/;

/** 목록의 항목: 위 항목 요소(보이는 것 먼저), 없으면 li (안에 li가 또 있는 묶음 li는 뺀다) */
function itemsOf(lb: Element): HTMLElement[] {
  const items = Array.from(lb.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  // 크기 0인 부모 안에 숨긴 항목(antd 접근성 목록)은 높이만 있고 너비가 0이다
  const shown = items.filter((o) => visible(o) && o.getBoundingClientRect().width > 0);
  if (shown.length) return shown;
  if (items.length) return items;
  const lis = Array.from(lb.querySelectorAll<HTMLElement>('li')).filter((li) => !li.querySelector('li'));
  if (lis.length || !lb.matches('[role="menu"], [role="listbox"]')) return lis;
  return pointerRows(lb);
}

/**
 * 항목 표시가 전혀 없는 목록(ninehire 학교 검색: ul[role=menu] 안의 div 줄): 누를 수 있는(cursor:pointer) 글자 상자.
 * 가장 바깥 것부터 보되, 여러 항목을 감싼 상자(cursor가 상속돼 같이 pointer)는 안의 줄로 나눈다.
 */
function pointerRows(lb: Element): HTMLElement[] {
  const rowLike = (e: Element) => getComputedStyle(e).cursor === 'pointer' && clean(e.textContent ?? '') !== '';
  const split = (e: HTMLElement): HTMLElement[] => {
    const kids = Array.from(e.children).filter(rowLike) as HTMLElement[];
    if (kids.length >= 2) return kids.flatMap(split);
    // 한 줄만 감싼 상자는 안쪽으로 내려간다: 안쪽을 눌러야 클릭이 어느 층의 핸들러에든 올라간다
    if (kids.length === 1 && clean(kids[0].textContent ?? '') === clean(e.textContent ?? '')) return split(kids[0]);
    return [e];
  };
  const outer = Array.from(lb.querySelectorAll<HTMLElement>('div, span, a, button')).filter(
    (e) => rowLike(e) && !(e.parentElement && e.parentElement !== lb && lb.contains(e.parentElement) && rowLike(e.parentElement)),
  );
  return outer.flatMap(split);
}

export function optionsIn(lb: Element): OptionItem[] {
  return itemsOf(lb)
    .filter((o) => o.getAttribute('aria-disabled') !== 'true' && !DISABLED_ITEM.test(String(o.className)) && !o.querySelector('input, textarea'))
    .map((o) => {
      // li 안의 버튼을 누른다 (ul > li > button)
      const el = o.matches('[role="option"]') ? o : (o.querySelector<HTMLElement>('button, a, [role="button"]') ?? o);
      return { el, text: textOf(o, 80), value: o.getAttribute('data-value') ?? el.getAttribute('data-value') ?? '' };
    })
    .filter((o) => !(o.el as HTMLButtonElement).disabled && !isPlaceholderOption(o.text, o.value));
}

/** 목록 안의 검색 칸 (국적처럼 목록 안에서 검색해서 고르는 드롭다운) */
export function searchInputIn(lb: Element): HTMLInputElement | null {
  return Array.from(lb.querySelectorAll<HTMLInputElement>('input')).find((i) => visible(i) && !i.disabled && /^(text|search|)$/.test(i.type)) ?? null;
}

/** 다른 내용 위에 떠 있는 층인지 (편집 팝업 자체는 제외) */
export function floating(el: Element): boolean {
  for (let a: Element | null = el, i = 0; a && i < 5; a = a.parentElement, i++) {
    if (a.matches('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]')) return false;
    const pos = getComputedStyle(a).position;
    if (pos === 'absolute' || pos === 'fixed') return true;
  }
  return false;
}

function near(trigger: Element, list: Element): boolean {
  for (let a = trigger.parentElement, i = 0; a && i < 6; a = a.parentElement, i++) if (a.contains(list)) return true;
  const t = trigger.getBoundingClientRect();
  const r = list.getBoundingClientRect();
  return r.left < t.right + 40 && r.right > t.left - 40 && r.top < t.bottom + 300 && r.bottom > t.top - 300;
}

/**
 * aria 없는 팝업 목록: 트리거 근처에 새로 생겼거나(before에 없음) 떠 있는(position absolute/fixed) 목록.
 * 이미 칸으로 읽은 버튼 묶음(라디오처럼 쓰는 버튼), 스캔에서 키를 받은 버튼이 든 목록은 팝업이 아니다.
 * strict: 누르기 직전과 비교할 때는 새로 생긴 것만 (닫히는 중인 이전 목록도 떠 있어서 헷갈린다).
 */
export function customListFor(trigger: Element, before?: Set<Element>, strict = false): HTMLElement | undefined {
  const lists = Array.from(document.querySelectorAll<HTMLElement>(LIST_SELECTOR)).filter(
    (l) =>
      visible(l) &&
      !l.contains(trigger) &&
      !l.dataset.clfKind &&
      !l.closest('[data-clf-kind="toggle"]') &&
      ((before && !before.has(l)) || (!strict && floating(l))) &&
      (itemsOf(l).length > 0 || !!searchInputIn(l)) &&
      !itemsOf(l).some((i) => i.querySelector('[data-clf-kind^="button:"]')) &&
      near(trigger, l),
  );
  const outer = lists.filter((l) => !lists.some((o) => o !== l && o.contains(l)));
  const t = trigger.getBoundingClientRect();
  const dist = (l: Element) => Math.abs(l.getBoundingClientRect().top - t.bottom);
  return outer.sort((a, b) => dist(a) - dist(b))[0];
}

/** 누르기/입력 전에 보이던 목록을 기억해 둔다 (그 뒤에 새로 생긴 목록만 이 칸의 것으로 본다) */
const armed = new WeakMap<Element, Set<Element>>();
export function armLists(trigger: Element): void {
  armed.set(trigger, visibleLists());
}

export function listboxFor(trigger: Element, before?: Set<Element>): HTMLElement | undefined {
  const id = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
  if (id) {
    const e = document.getElementById(id);
    if (e && visible(e)) return e.matches('[role="listbox"]') ? e : (e.querySelector<HTMLElement>('[role="listbox"]') ?? e);
  }
  // 검색 칸(armed)은 이전 검색 결과 목록이 같은 요소로 남아 있을 수 있어서 떠 있는 목록도 본다
  const prior = before ?? armed.get(trigger);
  return openListboxes().find((l) => !prior?.has(l)) ?? customListFor(trigger, prior, !!before);
}

/** aria 표시 없이 버튼·div로 만든 드롭다운 (눌러 봐서 목록이 생긴 것) */
export function isCustomTrigger(el: Element): boolean {
  return (el as HTMLElement).dataset?.clfDrop === '1';
}

/**
 * MUI Select는 mousedown에 열린다. 안 열리면 click도 시도.
 * aria 없는 드롭다운(<button>, antd div 트리거)은 마우스로 한 번 누른다 (antd Dropdown은 click, antd Select는 mousedown에 열린다).
 */
export async function openListbox(trigger: HTMLElement, timeout = 800): Promise<HTMLElement | undefined> {
  const before = visibleLists();
  if (!trigger.matches('[aria-haspopup="listbox"], [role="combobox"]')) {
    pointerClick(trigger);
    return waitFor(() => listboxFor(trigger, before), timeout);
  }
  pointerClick(trigger, 'down');
  let lb = await waitFor(() => listboxFor(trigger, before), timeout);
  if (!lb && trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click();
    lb = await waitFor(() => listboxFor(trigger, before), timeout);
  }
  return lb;
}

/**
 * 목록 닫기 (Escape 없이).
 * 1) MUI Menu/Popover: 메뉴 전용 투명 배경을 누르면 메뉴만 닫힌다 (편집 팝업과는 다른 레이어).
 * 2) 버튼 드롭다운: 트리거를 한 번 더 누르면 닫힌다.
 * 3) 바깥(페이지 빈 곳)을 누르면 닫히는 목록.
 * 4) Autocomplete 같은 Popper: 입력 칸에서 포커스를 빼면 닫힌다.
 * 다 안 되면 열어 둔다. 다음 클릭에서 저절로 닫히고, 그게 편집 팝업을 날리는 것보다 낫다.
 */
export async function closeListbox(lb: HTMLElement, trigger?: Element): Promise<void> {
  const closed = () => !lb.isConnected || !visible(lb) || (trigger ? trigger.getAttribute('aria-expanded') === 'false' : false);
  if (closed()) return;
  const layer = lb.closest('[class*="Popover-root"], [class*="Menu-root"]');
  const backdrop = layer && Array.from(layer.children).find((c) => /Backdrop/.test(String((c as HTMLElement).className)));
  if (backdrop) {
    pointerClick(backdrop);
    if (await waitFor(closed, 600)) return;
  }
  if (trigger && isCustomTrigger(trigger)) {
    pointerClick(trigger);
    if (await waitFor(closed, 400)) return;
  }
  // 편집 팝업 안이면 바깥 클릭이 팝업까지 닫을 수 있어서 하지 않는다
  if (!lb.closest('[role="dialog"], dialog') && !(trigger?.closest('[role="dialog"], dialog'))) {
    pointerClick(document.body);
    if (await waitFor(closed, 300)) return;
  }
  const focused = (trigger instanceof HTMLElement ? trigger : null) ?? (document.activeElement as HTMLElement | null);
  focused?.blur?.();
  await waitFor(closed, 600);
}

export type Pick<T> = { best: T; alias?: string } | { ambiguous: T[] } | { none: true };

/**
 * 원하는 값과 맞는 선택지 고르기.
 * 정확히 같음 → 숫자 같음 → 같은 이름의 변형("한국대학교 / 본교", "한국대학교(세종) / 분교") → 앞부분 → 포함.
 * 여러 개가 똑같이 맞으면 prefer(같은 행의 소재지·캠퍼스 등)를 담은 후보가 하나뿐일 때만 고르고, 아니면 ambiguous로 돌려준다.
 * 하나도 안 맞으면 값 동의어(만기전역 = 만기제대)로 다시 찾는다 (정확히 같거나 변형만).
 * "Java"는 "JavaScript"의 변형이 아니다 (이름 뒤에 바로 글자가 이어지면 다른 이름).
 */
export function pickOption<T extends OptionItem>(options: T[], wanted: string, prefer?: string[]): Pick<T> {
  const p = pickCore(options, wanted, false);
  if ('ambiguous' in p && prefer?.length) {
    const n = narrow(p.ambiguous, prefer);
    if (n) return { best: n };
  }
  if (!('none' in p)) return p;
  for (const alt of valueSynonyms(wanted)) {
    const q = pickCore(options, alt, true);
    if ('best' in q) return { best: q.best, alias: alt };
  }
  return p;
}

/** 후보들 중 단서 글자를 담은 것이 하나뿐이면 그것 */
function narrow<T extends OptionItem>(cands: T[], prefer: string[]): T | undefined {
  const terms = [...new Set(prefer.map(squash))].filter((t) => t.length >= 2 && t.length <= 20);
  const hits = cands.filter((o) => terms.some((t) => squash(o.text).includes(t)));
  return hits.length === 1 ? hits[0] : undefined;
}

function pickCore<T extends OptionItem>(options: T[], wanted: string, strict: boolean): Pick<T> {
  const w = squash(wanted);
  if (!w) return { none: true };
  const opts = options.filter((o) => !isPlaceholderOption(o.text, o.value) && !DIRECT_OPTION.test(clean(o.text)));
  const exact = opts.filter((o) => squash(o.text) === w || (o.value && squash(o.value) === w));
  if (exact.length === 1) return { best: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };
  if (/^\d+$/.test(w)) {
    const n = Number(w);
    const num = opts.filter((o) => digits(o.text) !== '' && Number(digits(o.text)) === n && squash(o.text).length <= w.length + 2);
    if (num.length === 1) return { best: num[0] };
  }
  const wl = clean(wanted).toLowerCase();
  const variants = opts.filter((o) => {
    const t = clean(o.text).toLowerCase();
    return t.startsWith(wl) && /^$|^[\s(/·,\-[]/.test(t.charAt(wl.length));
  });
  if (variants.length === 1) return { best: variants[0] };
  if (variants.length > 1) return { ambiguous: variants };
  if (strict) return { none: true };
  const starts = opts.filter((o) => squash(o.text).startsWith(w));
  if (starts.length === 1) return { best: starts[0] };
  if (starts.length > 1) return { ambiguous: starts };
  const within = opts.filter((o) => squash(o.text).includes(w) || (squash(o.text).length >= 2 && w.includes(squash(o.text))));
  if (within.length === 1) return { best: within[0] };
  if (within.length > 1) return { ambiguous: within };
  return { none: true };
}

// ---------- 국가번호 칸 ----------

const DIAL_CODE = /\+\s?\d{1,4}(?!\d)/;
/** 관계("모", "부친")처럼 국가번호 칸에 들어가면 안 되는 값 */
const RELATION = /^(부|모|부친|모친|아버지|어머니|배우자|남편|아내|형|누나|언니|오빠|동생|자녀|아들|딸|조부|조모|친구|지인|본인|친척)$/;

/** 선택지 대부분이 "+82", "대한민국(+82)" 모양이면 국가번호 목록 */
export function isDialCodeList(opts: OptionItem[]): boolean {
  const real = opts.filter((o) => !DIRECT_OPTION.test(o.text));
  return real.length >= 2 && real.filter((o) => DIAL_CODE.test(o.text)).length >= real.length * 0.6;
}

/** 국가번호 칸에 넣을 만한 값인지 (번호, 국가 이름). 관계·한 글자는 아니다 */
export function plausibleDialValue(value: string): boolean {
  const v = clean(value);
  if (/^\+?\s?\d{1,4}$/.test(v)) return true;
  if (RELATION.test(v)) return false;
  return /[가-힣]{2,}|[a-z]{3,}/i.test(v);
}

/**
 * 국가번호 목록에서 고를 값으로 바꾼다: "82"·"+82" → "+82"가 든 선택지, "한국" → "대한민국(+82)".
 * 관계 같은 엉뚱한 값이면 fail (모 → 모나코·모로코를 고르지 않게).
 */
export function dialCodeValue(value: string, opts: OptionItem[]): { value?: string; fail?: string } {
  const v = clean(value);
  const fail = `국가번호 칸이에요 — "${v}"는 국가 이름이나 번호가 아니에요. 전화번호 앞 국가 코드(예: 대한민국(+82))를 넣어 주세요`;
  if (!plausibleDialValue(v)) return { fail };
  const code = /^\+?\s?(\d{1,4})$/.exec(v)?.[1];
  if (code) {
    const re = new RegExp(`\\+\\s?${code}(?!\\d)`);
    const hits = opts.filter((o) => re.test(o.text));
    const korea = hits.find((o) => /대한민국|한국|korea/i.test(o.text));
    if (hits.length) return { value: (korea ?? hits[0]).text };
    return { fail: `국가번호 +${code}가 선택지에 없어요` };
  }
  if (['대한민국', ...valueSynonyms('대한민국')].some((k) => squash(k) === squash(v))) {
    const k = opts.find((o) => /대한민국|한국|korea/i.test(o.text));
    if (k) return { value: k.text };
  }
  return {};
}

/** 하위 호환: 애매하면 고르지 않는다 */
export function bestOption<T extends OptionItem>(options: T[], wanted: string): T | undefined {
  const p = pickOption(options, wanted);
  return 'best' in p ? p.best : undefined;
}

/** 목록 요약: 숫자 연속이면 범위로, 많으면 앞부분만 */
export function summarizeOptions(texts: string[], limit = 25): { options: string[]; more: number } {
  const nums = texts.map((t) => (/^\d+\s*(년|월|일|점)?$/.test(t) ? Number(digits(t)) : NaN));
  if (texts.length > 8 && nums.every((n) => !Number.isNaN(n))) {
    const sorted = [...nums].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => i === 0 || n - sorted[i - 1] === 1);
    if (contiguous) return { options: [`${texts[nums.indexOf(sorted[0])]}~${texts[nums.indexOf(sorted[sorted.length - 1])]}`], more: 0 };
  }
  if (texts.length <= limit) return { options: texts, more: 0 };
  return { options: texts.slice(0, limit), more: texts.length - limit };
}
