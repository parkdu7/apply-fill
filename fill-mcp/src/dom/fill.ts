// 값 입력 + 재확인(검증). 각 칸에 실제로 들어간 값을 돌려줘서 LLM이 불일치를 보고 재시도할 수 있게 한다.
// Escape 키는 어디서도 보내지 않는다 (편집 팝업이 닫혀 입력한 행이 사라진다).
import { optionLabel } from './label.js';
import {
  DIRECT_OPTION,
  PLACEHOLDER_TEXT,
  armLists,
  closeListbox,
  dialCodeValue,
  isCustomTrigger,
  isDialCodeList,
  isPlaceholderOption,
  listboxFor,
  openListbox,
  openListboxes,
  optionsIn,
  pickOption,
  plausibleDialValue,
  searchInputIn,
  visibleLists,
  type OptionItem,
  type Pick,
} from './listbox.js';
import { looksSensitiveValue } from './safety.js';
import { groupLook, isDisabledButton, optionText, pressedToggle, toggleOptions } from './toggle.js';
import type { FieldKind, FieldState, FillOutcome, FillRequest, ManualReason, ModalState } from './types.js';
import {
  clean,
  digits,
  fireBlur,
  fireChange,
  fireInput,
  fireKeyup,
  pointerClick,
  selectedText,
  setNativeValue,
  sleep,
  squash,
  textOf,
  visible,
  waitFor,
} from './util.js';

const MANUAL_MESSAGE: Record<ManualReason, string> = {
  file: '파일 첨부는 직접 해 주세요',
  password: '비밀번호 칸은 입력하지 않습니다',
  sensitive: '민감정보 칸은 입력하지 않습니다',
  essay: '자기소개서는 직접 작성하는 칸입니다',
  consent: '동의/서약은 직접 읽고 체크해 주세요',
  readonly: '읽기 전용 칸입니다 (검색 팝업 등으로 직접 입력)',
  disabled: '비활성화된 칸입니다 (앞 항목을 먼저 선택해야 할 수 있음)',
  address: '주소 검색 팝업으로만 넣을 수 있는 칸입니다 (사용자에게 직접 입력을 안내해 주세요)',
  popup: '검색 팝업으로만 넣을 수 있는 칸입니다 (사용자에게 직접 입력을 안내해 주세요)',
};

const TRUE = /^(true|y|yes|on|1|o|예|네|체크|선택|해당|있음|대상)$/i;
const FALSE = /^(false|n|no|off|0|x|아니오|아니요|해제|미선택|해당\s*없음|없음|비대상)$/i;

interface FillerResult {
  /** 검증할 때 비교할 값 (선택형은 실제 고른 선택지 텍스트) */
  expected?: string;
  fail?: string;
  message?: string;
}

function find(key: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-clf="${CSS.escape(key)}"]`));
}

/** 아이콘으로 그린 체크(가산점 "장애 여부" 등)의 상태 */
function iconChecked(el: HTMLElement): boolean {
  const id = el.querySelector('svg[data-testid]')?.getAttribute('data-testid') ?? '';
  return !/Unchecked|OutlineBlank|Blank/i.test(id) && /Checked|CheckBox|CheckCircle|RadioButtonChecked/i.test(id);
}

/** 칸의 현재 값. asUserValue면 select의 기본 선택(첫 항목)은 빈 값으로 본다 (덮어쓰기 판단용) */
export function readValue(els: HTMLElement[], kind: FieldKind, asUserValue = false): string {
  const el = els[0];
  switch (kind) {
    case 'radio': {
      const r = (els as HTMLInputElement[]).find((x) => x.checked);
      return r ? optionLabel(r) : '';
    }
    case 'toggle': {
      const b = pressedToggle(el);
      return b ? optionText(b) : (el.dataset.clfPicked ?? '');
    }
    case 'checkbox':
      if (el.dataset.clfCustom) return iconChecked(el) ? 'true' : 'false';
      return (el as HTMLInputElement).checked ? 'true' : 'false';
    case 'select':
      return selectedText(el as HTMLSelectElement, asUserValue);
    case 'listbox': {
      // 버튼 드롭다운은 안 골랐을 때 안내문("관계를 선택해주세요.")이 보인다
      const t = clean(textOf(el, 120));
      if (el.dataset.clfPh ? squash(t) === squash(el.dataset.clfPh) : (el.tagName === 'BUTTON' || isCustomTrigger(el)) && PLACEHOLDER_TEXT.test(t)) return '';
      return t;
    }
    case 'editable':
      return clean(el.textContent);
    default:
      return (el as HTMLInputElement).value ?? '';
  }
}

function toBool(v: string): boolean | null {
  const s = clean(v);
  if (TRUE.test(s)) return true;
  if (FALSE.test(s)) return false;
  return null;
}

function hasValue(kind: FieldKind, v: string): boolean {
  return kind === 'checkbox' ? v === 'true' : v !== '';
}

export function matches(kind: FieldKind, wanted: string, actual: string): boolean {
  if (kind === 'checkbox') return toBool(wanted) === (actual === 'true');
  if (actual === wanted || squash(actual) === squash(wanted)) return true;
  // 자동완성은 후보 글자("한국대학교(세종) / 분교")와 칸에 남는 글자("한국대학교(세종)")가 다를 수 있다
  if (kind === 'combobox') {
    const a = squash(actual);
    const w = squash(wanted);
    return a.length >= 2 && (w.startsWith(a) || a.startsWith(w));
  }
  if (kind === 'select' || kind === 'listbox' || kind === 'radio' || kind === 'toggle') return false;
  if (kind === 'number') return actual !== '' && Number(actual) === Number(wanted);
  const d = digits(wanted);
  // 날짜·전화번호는 구분자만 다르면 같은 값으로 본다 (1999-03-15 = 1999.03.15)
  return d.length >= 4 && digits(actual) === d && !/[가-힣a-zA-Z]/.test(actual.replace(/\s/g, '') + wanted.replace(/\s/g, ''));
}

// ---------- 날짜 형식 ----------

function dateParts(value: string): { y: string; m?: string; d?: string } | null {
  const ds = digits(value);
  if (ds.length === 8) return { y: ds.slice(0, 4), m: ds.slice(4, 6), d: ds.slice(6, 8) };
  if (ds.length === 6 && /^(19|20)/.test(ds)) return { y: ds.slice(0, 4), m: ds.slice(4, 6) };
  const p = value.match(/\d+/g);
  if (!p || p[0].length !== 4) return null;
  return { y: p[0], m: p[1]?.padStart(2, '0'), d: p[2]?.padStart(2, '0') };
}

/** placeholder("YYYY.MM.DD", "YYYY/MM/DD", "예) 1999.03.15")에 맞춰 날짜 모양을 바꾼다 */
export function formatDateLike(value: string, placeholder: string): string | null {
  const parts = dateParts(value);
  if (!parts) return null;
  let pattern = placeholder;
  if (!/y{2,4}/i.test(pattern)) {
    const ex = /\d{4}([.\-/]?)\d{2}(?:\1\d{2})?/.exec(placeholder);
    if (!ex) return null;
    const sep = ex[1];
    pattern = ex[0].length >= 8 ? `YYYY${sep}MM${sep}DD` : `YYYY${sep}MM`;
  }
  if (/d{2}/i.test(pattern) && !parts.d) return null;
  if (/m{2}/i.test(pattern) && !parts.m) return null;
  return pattern
    .replace(/y{4}/i, parts.y)
    .replace(/y{2}/i, parts.y.slice(2))
    .replace(/m{2}/i, parts.m ?? '')
    .replace(/d{2}/i, parts.d ?? '')
    .replace(/^[^\d]*(?=\d)/, '');
}

function isoDate(value: string, withDay: boolean): string | null {
  const p = dateParts(value);
  if (!p || !p.m || (withDay && !p.d)) return null;
  return withDay ? `${p.y}-${p.m}-${p.d}` : `${p.y}-${p.m}`;
}

// ---------- 선택지 고르기 결과 → 메시지 ----------

function optionList(opts: OptionItem[]): string {
  const t = opts.map((o) => o.text);
  return t.length > 30 ? `${t.slice(0, 30).join(', ')} 외 ${t.length - 30}개` : t.join(', ');
}

function aliasNote<T extends OptionItem>(pick: Pick<T>, wanted: string): string | undefined {
  return 'best' in pick && pick.alias ? `"${wanted}"이(가) 선택지에 없어 같은 뜻의 "${pick.best.text}"을(를) 골랐어요` : undefined;
}

/** 국가번호 목록이면 고를 값을 바꾸거나(82 → 대한민국(+82)) 엉뚱한 값(관계 "모")을 막는다 */
function dialGuard(opts: OptionItem[], value: string): { value: string; fail?: string } {
  if (!isDialCodeList(opts)) return { value };
  const g = dialCodeValue(value, opts);
  return { value: g.value ?? value, fail: g.fail };
}

function pickFailure<T extends OptionItem>(pick: Pick<T>, all: OptionItem[]): string | null {
  if ('best' in pick) return null;
  if ('ambiguous' in pick) return `후보가 여러 개: ${optionList(pick.ambiguous)} — 정확한 후보 글자로 다시 보내 주세요`;
  return `선택지에 없음 — 가능한 값: ${optionList(all.filter((o) => !isPlaceholderOption(o.text, o.value)))}`;
}

// ---------- 종류별 입력 ----------

async function fillTextLike(els: HTMLElement[], value: string, kind: FieldKind): Promise<FillerResult> {
  const el = els[0] as HTMLInputElement | HTMLTextAreaElement;
  let v = value;
  if (el instanceof HTMLInputElement && el.type === 'date') v = isoDate(value, true) ?? value;
  else if (el instanceof HTMLInputElement && el.type === 'month') v = isoDate(value, false) ?? value;
  else if (kind === 'date' && el.placeholder) v = formatDateLike(value, el.placeholder) ?? value;
  // 넘치는 값을 넣으면 사이트마다 잘리거나 막히거나 제각각이라, 아예 넣지 않고 줄여 달라고 돌려준다
  if (el.maxLength > 0 && v.length > el.maxLength) {
    return { fail: `글자 수 초과: 최대 ${el.maxLength}자인데 ${v.length}자예요. 줄여서 다시 보내 주세요` };
  }
  const before = visibleLists();
  setNativeValue(el, v);
  fireInput(el, v);
  // 입력하자 칸 바로 아래에 후보 목록이 뜨면 검색형 칸이다: 후보를 눌러야 확정된다
  if (kind === 'text' && (await waitFor(() => listboxFor(el, before), 60))) {
    el.dataset.clfKind = 'combobox';
    return { fail: '검색형 칸이에요 (입력하자 후보 목록이 떴어요) — 후보를 골라야 확정돼요' };
  }
  fireChange(el);
  fireKeyup(el);
  fireBlur(el);
  return { expected: v };
}

// ---------- antd DatePicker ----------

/**
 * antd DatePicker: 칸에 글자를 써 넣어도 antd 상태에 안 들어가서 저장 버튼이 안 풀린다 (ninehire).
 * readonly가 아닐 때도 있다 (ninehire는 줄을 저장한 뒤 다시 그린 칸에서 readonly가 빠진다): 항상 달력으로 넣는다.
 */
function antPickerInput(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && !!el.closest('.ant-picker');
}

function openPickerDropdown(): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-picker-dropdown'))
    .filter((d) => !d.classList.contains('ant-picker-dropdown-hidden') && visible(d))
    .pop();
}

/** 달력을 열어 연도 → 월 → 일 칸(td[title="2015" | "2015-03" | "2015-03-01"])을 차례로 누른다 */
async function fillAntPicker(el: HTMLInputElement, value: string): Promise<FillerResult> {
  const p = dateParts(value);
  if (!p?.m) return { fail: '날짜를 읽지 못했어요 — YYYY-MM-DD 형식으로 보내 주세요' };
  el.focus();
  pointerClick(el);
  const drop = await waitFor(openPickerDropdown, 1000);
  if (!drop) return { fail: '달력이 열리지 않음' };
  const cell = (title: string) =>
    Array.from(drop.querySelectorAll<HTMLElement>(`td.ant-picker-cell[title="${title}"]`)).find((c) => visible(c) && !c.classList.contains('ant-picker-cell-disabled'));
  const press = async (title: string) => {
    const c = await waitFor(() => cell(title), 800);
    if (!c) return false;
    pointerClick(c.querySelector('.ant-picker-cell-inner') ?? c);
    return true;
  };
  const yearBtn = drop.querySelector<HTMLElement>('.ant-picker-year-btn');
  if (yearBtn && !drop.querySelector('.ant-picker-year-panel')) {
    pointerClick(yearBtn);
    await waitFor(() => drop.querySelector('.ant-picker-year-panel'), 800);
  }
  // 10년 단위로 넘겨 그 해가 보이게 한다
  for (let i = 0; i < 20 && !cell(p.y); i++) {
    const years = Array.from(drop.querySelectorAll<HTMLElement>('.ant-picker-year-panel td[title]')).map((c) => Number(c.getAttribute('title')));
    if (!years.length) break;
    const btn = drop.querySelector<HTMLElement>(Number(p.y) < Math.min(...years) ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn');
    if (!btn) break;
    pointerClick(btn);
    await sleep(60);
  }
  const ym = `${p.y}-${p.m}`;
  let ok = (await press(p.y)) && (await press(ym));
  // 월을 누르면 월 달력은 닫히고, 날짜 달력은 일 패널로 넘어간다
  if (ok && (await waitFor(() => !openPickerDropdown() || drop.querySelector('.ant-picker-date-panel'), 800)) && openPickerDropdown()) {
    ok = !!p.d && (await press(`${ym}-${p.d}`));
  }
  const closed = await waitFor(() => !openPickerDropdown(), 800);
  if (!ok || !closed) {
    if (!closed) el.blur();
    return { fail: `달력에서 ${p.d ? `${ym}-${p.d}` : ym}을(를) 고르지 못했어요` };
  }
  // 사이트 표시 형식(2015-03, 2015.03.01 등)으로 들어간 값을 기준으로 확인한다
  if (!digits(el.value).startsWith(p.y + p.m)) return { fail: `달력으로 골랐지만 칸 값이 "${el.value}"예요` };
  return { expected: el.value };
}

async function fillEditable(els: HTMLElement[], value: string): Promise<FillerResult> {
  const el = els[0];
  el.focus();
  el.textContent = value;
  fireInput(el, value);
  fireBlur(el);
  return { expected: value };
}

async function fillSelect(els: HTMLElement[], wanted: string, prefer?: string[]): Promise<FillerResult> {
  const el = els[0] as HTMLSelectElement;
  const opts = Array.from(el.options).map((o, i) => ({ text: clean(o.text), value: o.value, index: i }));
  const dial = dialGuard(opts, wanted);
  if (dial.fail) return { fail: dial.fail };
  const value = dial.value;
  const pick = pickOption(opts, value, prefer);
  const fail = pickFailure(pick, opts);
  if (fail || !('best' in pick)) return { fail: fail ?? '선택 실패' };
  el.selectedIndex = pick.best.index;
  fireInput(el);
  fireChange(el);
  fireBlur(el);
  return { expected: pick.best.text, message: aliasNote(pick, value) };
}

async function fillRadio(els: HTMLElement[], value: string, prefer?: string[]): Promise<FillerResult> {
  const radios = els as HTMLInputElement[];
  const opts = radios.map((r) => ({ text: optionLabel(r), value: r.value, el: r }));
  const pick = pickOption(opts, value, prefer);
  const fail = pickFailure(pick, opts);
  if (fail || !('best' in pick)) return { fail: fail ?? '선택 실패' };
  const r = pick.best.el;
  if (!r.checked) r.click();
  if (!r.checked) r.labels?.[0]?.click();
  return { expected: pick.best.text, message: aliasNote(pick, value) };
}

async function fillToggle(els: HTMLElement[], value: string, prefer?: string[]): Promise<FillerResult> {
  const group = els[0];
  const opts = toggleOptions(group).map((b) => ({ text: optionText(b), value: b.getAttribute('value') ?? '', el: b }));
  const pick = pickOption(opts, value, prefer);
  const fail = pickFailure(pick, opts);
  if (fail || !('best' in pick)) return { fail: fail ?? '선택 실패' };
  const target = pick.best.el;
  if (isDisabledButton(target)) return { fail: `"${pick.best.text}" 버튼이 비활성이라 안 눌려요 (앞 항목을 먼저 골라야 할 수 있어요)` };
  if (pressedToggle(group) !== target) {
    const look = groupLook(group);
    delete group.dataset.clfPicked;
    target.click();
    await waitFor(() => pressedToggle(group) === target, 400);
    // 고른 표시를 못 읽는 사이트: 누른 뒤 생김새가 바뀌었으면 누른 값을 기억해 둔다
    if (!pressedToggle(group) && groupLook(group) !== look) group.dataset.clfPicked = pick.best.text;
  }
  return { expected: pick.best.text, message: aliasNote(pick, value) };
}

async function fillCheckbox(els: HTMLElement[], value: string): Promise<FillerResult> {
  const el = els[0];
  const want = toBool(value);
  if (want === null) return { fail: '체크박스 값은 true/false(예/아니오)로 주세요' };
  if (el.dataset.clfCustom) {
    if (iconChecked(el) !== want) pointerClick(el);
    await waitFor(() => iconChecked(el) === want, 500);
    return { expected: want ? 'true' : 'false' };
  }
  const box = el as HTMLInputElement;
  if (box.checked !== want) box.click();
  if (box.checked !== want) box.labels?.[0]?.click();
  return { expected: want ? 'true' : 'false' };
}

async function fillListbox(els: HTMLElement[], wanted: string, prefer?: string[]): Promise<FillerResult> {
  const el = els[0];
  const lb = await openListbox(el);
  if (!lb) return { fail: '드롭다운 목록이 열리지 않음 — method: "keyboard"로 재시도해 보세요' };
  const opts = optionsIn(lb);
  const searchable = !!searchInputIn(lb);
  if (!searchable) el.dataset.clfOpts = JSON.stringify(opts.map((o) => o.text));
  const dial = dialGuard(opts, wanted);
  const value = dial.value;
  const pick: Pick<OptionItem> = dial.fail ? { none: true } : pickOption(opts, value, prefer);
  const fail = dial.fail ?? pickFailure(pick, opts);
  if (fail || !('best' in pick) || !pick.best.el) {
    await closeListbox(lb, el);
    // 목록 안 검색 칸이 있으면 키보드로 검색해서 다시 찾는다 (보이는 건 앞쪽 일부뿐)
    if (searchable && 'none' in pick) return { fail: `목록 안에서 검색이 필요해요 — 보이는 선택지: ${optionList(opts)}` };
    return { fail: fail ?? '선택 실패' };
  }
  pick.best.el.scrollIntoView({ block: 'nearest' });
  pointerClick(pick.best.el);
  await waitFor(() => !lb.isConnected || !visible(lb) || el.getAttribute('aria-expanded') === 'false', 800);
  if (lb.isConnected && visible(lb) && el.getAttribute('aria-expanded') !== 'false') await closeListbox(lb, el);
  return { expected: pick.best.text, message: aliasNote(pick, value) };
}

/** 자동완성 목록(검색 결과가 늦게 오는 DB 검색 포함)을 기다린다. "직접입력" 항목만 있는 동안은 계속 기다린다. */
async function waitForSuggestions(input: HTMLElement, timeout = 3000): Promise<HTMLElement | undefined> {
  const end = Date.now() + timeout;
  let lb: HTMLElement | undefined;
  while (Date.now() < end) {
    lb = listboxFor(input);
    if (lb && optionsIn(lb).some((o) => !DIRECT_OPTION.test(o.text))) return lb;
    await sleep(100);
  }
  return lb;
}

async function fillCombobox(els: HTMLElement[], req: FillRequest): Promise<FillerResult> {
  const el = els[0] as HTMLInputElement;
  const query = req.query ?? req.value;
  armPick(el);
  el.focus();
  setNativeValue(el, query);
  fireInput(el, query);
  const lb = await waitForSuggestions(el);
  const opts = lb ? optionsIn(lb) : [];
  const dial = dialGuard(opts, req.value);
  const pick: Pick<OptionItem> = dial.fail ? { none: true } : pickOption(opts, dial.value, req.prefer);
  let chosen: OptionItem | undefined = 'best' in pick ? pick.best : undefined;
  let message: string | undefined = aliasNote(pick, req.value);
  if (!chosen && req.direct) {
    chosen = opts.find((o) => DIRECT_OPTION.test(o.text));
    if (chosen) message = `검색 결과에 없어 "직접입력"으로 "${query}"를 넣음`;
  }
  if (chosen?.el) {
    pointerClick(chosen.el);
    const c = await confirmState(el);
    el.blur();
    const unconfirmed = pickUnconfirmed(c);
    if (unconfirmed) return { fail: unconfirmed };
    return { expected: DIRECT_OPTION.test(chosen.text) ? query : chosen.text, message };
  }
  // 못 고르면 입력한 글자를 지우고 목록을 닫는다 (Escape 대신 포커스 빼기)
  setNativeValue(el, '');
  fireInput(el, '');
  if (lb) await closeListbox(lb, el);
  else el.blur();
  const hasDirect = opts.some((o) => DIRECT_OPTION.test(o.text));
  if (dial.fail) return { fail: dial.fail };
  if ('ambiguous' in pick) return { fail: pickFailure(pick, opts) ?? '' };
  if (!lb || !opts.length) return { fail: `검색 결과가 없음 ("${query}") — 다른 검색어(query)로 다시 시도하거나 direct: true로 직접입력` };
  return {
    fail: `선택지에 없음 — 후보: ${optionList(opts.filter((o) => !DIRECT_OPTION.test(o.text)))}${hasDirect ? ' (목록에 없으면 direct: true로 직접입력)' : ''}`,
  };
}

// ---------- 검색형 칸: 후보를 눌렀는지 확인 ----------

/** 같은 블록에서 이 칸을 골라야 풀리는 칸 (학교 → 소재지·본교/분교, 전공 → 평점) */
function dependentsOf(el: HTMLElement): HTMLElement[] {
  for (let a = el.parentElement, i = 0; a && i < 6; a = a.parentElement, i++) {
    const others = Array.from(a.querySelectorAll<HTMLElement>('[data-clf]')).filter(
      (o) => o !== el && !o.contains(el) && !(o.dataset.clfKind ?? '').startsWith('button:'),
    );
    if (others.length) return others.filter(isOff);
  }
  return [];
}

function isOff(o: HTMLElement): boolean {
  return o.dataset.clfKind === 'toggle' ? toggleOptions(o).every(isDisabledButton) : isDisabledButton(o);
}

/** 검색 전 비활성이던 의존 칸과 그때 값 (늘 잠겨 있고 사이트가 채우기만 하는 칸도 있다: 발행처) */
const pendingDeps = new WeakMap<HTMLElement, { el: HTMLElement; value: string }[]>();

function depValue(d: HTMLElement): string {
  return readValue([d], (d.dataset.clfKind as FieldKind) ?? 'text');
}

function listSig(el: HTMLElement): string {
  const lb = listboxFor(el);
  return lb ? optionsIn(lb).map((o) => o.text).join('|') : '';
}

/** 검색 전: 지금 떠 있는 목록과 비활성 의존 칸을 기억해 둔다 */
function armPick(el: HTMLElement, withDeps = true): { sig: string; deps: number } {
  const sig = listSig(el);
  armLists(el);
  const deps = withDeps ? dependentsOf(el) : [];
  pendingDeps.set(
    el,
    deps.map((d) => ({ el: d, value: depValue(d) })),
  );
  return { sig, deps: deps.length };
}

interface ConfirmState {
  listOpen: boolean;
  deps: number;
  freed: number;
}

/** 후보를 누른 뒤: 목록이 닫히고, 비활성이던 의존 칸이 풀리면 확정 */
async function confirmState(el: HTMLElement): Promise<ConfirmState> {
  const deps = pendingDeps.get(el) ?? [];
  const state = (): ConfirmState => {
    const lb = listboxFor(el);
    // 풀렸거나, 잠긴 채로 사이트가 값을 채웠으면 확정 신호
    const freed = deps.filter((d) => d.el.isConnected && (!isOff(d.el) || depValue(d.el) !== d.value)).length;
    return { listOpen: !!lb && lb.isConnected && visible(lb), deps: deps.length, freed };
  };
  await waitFor(() => {
    const s = state();
    return !s.listOpen && (!s.deps || s.freed > 0);
  }, 1200);
  return state();
}

function pickUnconfirmed(c: ConfirmState): string | null {
  if (c.listOpen) return '후보를 눌렀는데 목록이 그대로예요 — 선택이 확정되지 않았어요';
  if (c.deps && !c.freed) return `후보를 눌렀는데 뒤 칸(${c.deps}개)이 계속 비활성이에요 — 선택이 확정되지 않았을 수 있어요`;
  return null;
}

// ---------- 표시 ----------

const COLORS = { ok: '#16a34a', low: '#eab308', bad: '#dc2626' } as const;

function mark(els: HTMLElement[], kind: FieldKind, state: keyof typeof COLORS): void {
  let target: HTMLElement = els[0];
  if (kind === 'radio') {
    const checked = (els as HTMLInputElement[]).find((r) => r.checked) ?? els[0];
    target = (checked.closest('[role="radiogroup"], fieldset') as HTMLElement) ?? (checked as HTMLInputElement).labels?.[0] ?? checked.parentElement ?? checked;
  } else if (kind === 'checkbox' && !els[0].dataset.clfCustom) {
    target = (els[0] as HTMLInputElement).labels?.[0] ?? els[0].parentElement ?? els[0];
  } else if (kind !== 'toggle' && kind !== 'checkbox') {
    target = (els[0].closest('[class*="InputBase-root"]') as HTMLElement) ?? els[0];
  }
  target.style.outline = `2px solid ${COLORS[state]}`;
  target.style.outlineOffset = '2px';
  target.dataset.clfMark = state;
}

export function clearMarks(): number {
  const marked = Array.from(document.querySelectorAll<HTMLElement>('[data-clf-mark]'));
  for (const el of marked) {
    el.style.outline = '';
    el.style.outlineOffset = '';
    delete el.dataset.clfMark;
  }
  return marked.length;
}

/**
 * 칸 바로 근처의 글자 수 카운터("123 / 200자", "(150/100 byte)")를 읽는다.
 * 사이트가 직접 센 값이라 바이트 제한도 정확히 확인된다. 다른 칸의 카운터를 읽지 않도록 칸이 하나뿐인 범위에서만 찾는다.
 */
export function counterNear(el: HTMLElement): { used: number; max: number; unit: string } | null {
  const scopes = [el.closest('[class*="FormControl-root"]'), el.parentElement, el.parentElement?.parentElement];
  for (const box of scopes) {
    if (!box) continue;
    const controls = Array.from(box.querySelectorAll('input, select, textarea, [contenteditable="true"]')).filter(
      (c) => !c.closest('[aria-hidden="true"]') && (c as HTMLInputElement).type !== 'hidden',
    );
    if (controls.length > 1) break;
    const m = /(\d[\d,]*)\s*(?:자|byte|bytes|바이트)?\s*\/\s*([\d,]+)\s*(자|byte|bytes|바이트)/i.exec(textOf(box, 400));
    if (m) return { used: Number(m[1].replace(/,/g, '')), max: Number(m[2].replace(/,/g, '')), unit: m[3] };
  }
  return null;
}

/** 현재 값을 읽어 원하는 값과 비교하고 칸에 색을 칠한다. 키보드 입력 후 재확인에도 쓴다. */
export function inspect(key: string, wanted: string, confidence: 'high' | 'low' = 'high', expected?: string, message?: string): FillOutcome {
  const els = find(key);
  if (!els.length) {
    const why = modalState().open ? '' : ' (편집 팝업이 닫혔을 수 있음)';
    return { key, status: 'not_found', message: `입력 후 칸이 사라짐${why}` };
  }
  const kind = els[0].dataset.clfKind as FieldKind;
  const label = els[0].dataset.clfLabel;
  const actual = readValue(els, kind);
  let ok = matches(kind, expected ?? wanted, actual);
  const counter = kind === 'textarea' || kind === 'text' || kind === 'editable' ? counterNear(els[0]) : null;
  if (ok && counter && counter.used > counter.max) {
    ok = false;
    message = `사이트 글자 수 카운터 초과 (${counter.used}/${counter.max}${counter.unit}) — 줄여서 다시 보내 주세요${/byte|바이트/i.test(counter.unit) ? ' (한글은 1자에 2~3byte)' : ''}`;
  }
  for (const e of els) e.dataset.clfFilled = '1';
  mark(els, kind, ok ? (confidence === 'low' ? 'low' : 'ok') : 'bad');
  const out: FillOutcome = { key, status: ok ? 'ok' : 'mismatch', kind, label, actual: actual.slice(0, 80) };
  if (message) out.message = message;
  return out;
}

/**
 * 입력 전 규칙 확인: 수동 칸, 민감정보, 이미 값이 있는 칸.
 * 막아야 하면 결과를, 진행해도 되면 null을 돌려준다. 키보드 입력 경로도 이 판단을 따른다.
 */
export function precheck(req: FillRequest): FillOutcome | null {
  const els = find(req.key);
  if (!els.length) {
    const why = modalState().open ? '' : ' 편집 팝업이 닫혔다면 다시 열어야 해요.';
    return { key: req.key, status: 'not_found', message: `칸을 찾지 못함 — extract_fields를 다시 호출하세요.${why}` };
  }
  const kind = els[0].dataset.clfKind as FieldKind | undefined;
  const label = els[0].dataset.clfLabel;
  if (!kind || kind.startsWith('button:')) return { key: req.key, status: 'error', label, message: '입력 칸이 아닙니다' };
  let manual = els[0].dataset.clfManual as ManualReason | '';
  // 스캔 때 비활성이던 칸이 앞 칸을 고르면서 풀렸으면 넣는다 (학교 → 소재지, 분야 → 희망직무)
  if (manual === 'disabled' && !isOff(els[0])) manual = '';
  if (manual === 'disabled') return { key: req.key, status: 'refused', kind, label, message: MANUAL_MESSAGE.disabled, locked: true };
  if (manual) return { key: req.key, status: 'refused', kind, label, message: MANUAL_MESSAGE[manual] };
  // 스캔 뒤에 잠긴 칸 (자격증명을 고르면 발행기관이 자동으로 채워지고 잠기는 식)
  if ((els[0] as HTMLInputElement).disabled || els[0].getAttribute('aria-disabled') === 'true') {
    return {
      key: req.key,
      status: 'refused',
      kind,
      label,
      actual: readValue(els, kind).slice(0, 80),
      message: '잠긴 칸이라 그대로 둠 (사이트가 자동으로 채웠을 수 있음)',
      locked: true,
    };
  }
  const value = String(req.value ?? '');
  if (looksSensitiveValue(value, label)) return { key: req.key, status: 'refused', kind, label, message: '주민번호·카드번호 형식의 값은 입력하지 않습니다' };
  // 국가번호 칸에 관계("모") 같은 값을 넣으면 모나코·모로코가 후보로 뜬다: 넣기 전에 막는다
  if (els[0].dataset.clfCc === '1' && !plausibleDialValue(value)) {
    return {
      key: req.key,
      status: 'mismatch',
      kind,
      label,
      message: `국가번호 칸이에요 — "${value}"는 국가 이름이나 번호가 아니에요. 전화번호 앞 국가 코드(예: 대한민국(+82) 또는 +82)를 넣어 주세요`,
    };
  }

  const current = readValue(els, kind, true);
  const mine = els.some((e) => e.dataset.clfFilled === '1');
  if (hasValue(kind, current) && !mine && !req.overwrite) {
    if (matches(kind, value, current)) return { key: req.key, status: 'ok', kind, label, actual: current, message: '이미 같은 값' };
    return { key: req.key, status: 'skipped', kind, label, actual: current.slice(0, 80), message: '이미 값이 있어 덮어쓰지 않음 (프로필과 다르면 사용자에게 알리기)' };
  }
  return null;
}

async function fillOne(req: FillRequest): Promise<FillOutcome> {
  const blocked = precheck(req);
  if (blocked) return blocked;
  const els = find(req.key);
  const kind = els[0].dataset.clfKind as FieldKind;
  const label = els[0].dataset.clfLabel;
  const value = String(req.value ?? '');

  let res: FillerResult;
  try {
    switch (kind) {
      case 'select':
        res = await fillSelect(els, value, req.prefer);
        break;
      case 'listbox':
        res = await fillListbox(els, value, req.prefer);
        break;
      case 'combobox':
        res = await fillCombobox(els, { ...req, value });
        break;
      case 'radio':
        res = await fillRadio(els, value, req.prefer);
        break;
      case 'toggle':
        res = await fillToggle(els, value, req.prefer);
        break;
      case 'checkbox':
        res = await fillCheckbox(els, value);
        break;
      case 'editable':
        res = await fillEditable(els, value);
        break;
      default:
        res = antPickerInput(els[0]) ? await fillAntPicker(els[0], value) : await fillTextLike(els, value, kind);
    }
  } catch (e) {
    return { key: req.key, status: 'error', kind, label, message: e instanceof Error ? e.message : String(e) };
  }
  if (res.fail) {
    mark(els, kind, 'bad');
    return { key: req.key, status: 'mismatch', kind, label, actual: readValue(els, kind).slice(0, 80), message: res.fail };
  }
  await sleep(60); // React 등이 다시 그릴 시간
  return inspect(req.key, value, req.confidence, res.expected, res.message);
}

export async function fill(reqs: FillRequest[]): Promise<FillOutcome[]> {
  const out: FillOutcome[] = [];
  // 순서대로: 앞 칸 선택에 따라 뒤 칸이 열리는 폼이 많다
  for (const r of reqs) out.push(await fillOne(r));
  return out;
}

/** 열려 있는 모달(편집 팝업·안내창) 중 맨 위 */
export function modalState(): ModalState {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')).filter((d) => visible(d));
  const top = dialogs[dialogs.length - 1];
  if (!top) return { open: false, title: '' };
  const title = clean(textOf(top.querySelector('h1, h2, h3, [class*="DialogTitle"]'), 60));
  // 오류 문구: 에러 표시 요소, 또는 짧은 글자 중 "필수/입력해 주세요/올바른" 같은 말
  const errors = new Set<string>();
  for (const e of Array.from(top.querySelectorAll<HTMLElement>('[role="alert"], [class*="Mui-error"], [class*="error" i], p, span, div'))) {
    if (!visible(e) || e.querySelector('input, textarea, button, [role="button"]')) continue;
    const t = clean(textOf(e, 120));
    if (!t || t.length > 80) continue;
    const isErrorEl = e.matches('[role="alert"], [class*="Mui-error"], [class*="error" i]') && !e.matches('label, [class*="InputLabel"], [class*="FormLabel"]');
    if (isErrorEl || /필수\s*(항목|입력|값)|입력해\s*주세요|선택해\s*주세요|올바른|형식이|초과|최대\s*\d+/.test(t)) errors.add(t);
  }
  return { open: true, title, errors: [...errors].slice(0, 5) };
}

/** 키보드 방식 재시도용: 열린 목록에서 가장 맞는 선택지에 표시를 달아 둔다 */
export function markOption(
  key: string,
  wanted: string,
  direct = false,
  prefer?: string[],
): { text?: string; options?: string[]; ambiguous?: boolean; searchable?: boolean; fail?: string; note?: string } {
  for (const e of Array.from(document.querySelectorAll('[data-clf-opt]'))) e.removeAttribute('data-clf-opt');
  const el = find(key)[0];
  if (!el) return {};
  for (const e of Array.from(document.querySelectorAll('[data-clf-search]'))) e.removeAttribute('data-clf-search');
  const lb = listboxFor(el) ?? openListboxes().pop();
  if (!lb) return {};
  const opts = optionsIn(lb);
  const dial = dialGuard(opts, wanted);
  if (dial.fail) return { fail: dial.fail, options: opts.map((o) => o.text) };
  const value = dial.value;
  const pick = pickOption(opts, value, prefer);
  let chosen = 'best' in pick ? pick.best : undefined;
  if (!chosen && direct) chosen = opts.find((o) => DIRECT_OPTION.test(o.text));
  if (!chosen?.el) {
    // 목록 안 검색 칸 (드라이버가 실제 키 입력으로 검색한다)
    const search = searchInputIn(lb);
    search?.setAttribute('data-clf-search', '1');
    return { options: ('ambiguous' in pick ? pick.ambiguous : opts).map((o) => o.text), ambiguous: 'ambiguous' in pick, searchable: !!search };
  }
  chosen.el.setAttribute('data-clf-opt', '1');
  return { text: chosen.text, note: aliasNote(pick, value) };
}

/** 키보드 검색 전 (드라이버용): 지금 목록 내용과 비활성 의존 칸 수를 기억해 둔다 */
export function armSearch(key: string, withDeps = true): { sig: string; deps: number } {
  const el = find(key)[0];
  return el ? armPick(el, withDeps) : { sig: '', deps: 0 };
}

/** 지금 이 칸의 목록 내용 (검색 결과가 바뀌었는지 볼 때) */
export function listState(key: string): { sig: string; count: number } {
  const el = find(key)[0];
  const lb = el && listboxFor(el);
  if (!lb) return { sig: '', count: 0 };
  const opts = optionsIn(lb);
  return { sig: opts.map((o) => o.text).join('|'), count: opts.length };
}

/** 후보를 누른 뒤 (드라이버용): 확정 신호(목록 닫힘, 의존 칸 풀림)까지 보고 결과를 돌려준다 */
export async function confirmPick(key: string, wanted: string, confidence: 'high' | 'low', expected?: string): Promise<FillOutcome> {
  const el = find(key)[0];
  const c = el ? await confirmState(el) : null;
  await sleep(150); // 고른 뒤 사이트가 칸 글자를 다시 쓰는 시간 ("직접입력시 클릭" → 친 글자)
  const out = inspect(key, wanted, confidence, expected);
  const unconfirmed = c && pickUnconfirmed(c);
  if (unconfirmed && out.status === 'ok') {
    mark(find(key), out.kind ?? 'combobox', 'bad');
    return { ...out, status: 'mismatch', message: unconfirmed };
  }
  return out;
}

/** 이 칸의 목록을 Escape 없이 닫는다 (키보드 재시도에서 못 골랐을 때) */
export async function dismiss(key: string): Promise<void> {
  const el = find(key)[0];
  if (!el) return;
  const lb = listboxFor(el);
  if (lb) await closeListbox(lb, el);
  else el.blur();
}

// ---------- 다시 확인 (토글이 다른 칸을 비웠는지, 잠긴 칸이 풀렸는지, 사용자가 뭔가 했는지) ----------

function stateOf(key: string): FieldState {
  const els = find(key);
  if (!els.length) return { key, exists: false, disabled: false, value: '' };
  const kind = els[0].dataset.clfKind as FieldKind;
  return { key, exists: true, disabled: isOff(els[0]), value: readValue(els, kind, true) };
}

/** 칸들의 지금 상태 (잠긴 칸이 풀렸는지·사이트가 채웠는지) */
export function fieldStates(keys: string[]): FieldState[] {
  return keys.map(stateOf);
}

/**
 * 앞에서 넣은 칸이 아직 그 값인지. 뒤 칸(국내/국외 토글 등)을 넣다가 사이트가 앞 칸을 비우는 경우를 잡는다.
 * expected는 입력 직후 읽은 값(선택형은 고른 선택지), wanted는 처음 보낸 값.
 */
export function verify(items: { key: string; wanted: string; expected?: string }[]): FieldState[] {
  return items.map(({ key, wanted, expected }) => {
    const st = stateOf(key);
    if (!st.exists) return { ...st, ok: false };
    const els = find(key);
    const kind = els[0].dataset.clfKind as FieldKind;
    const cur = readValue(els, kind);
    const exp = expected ?? wanted;
    const ok = matches(kind, exp, cur) || matches(kind, wanted, cur) || (exp.length >= 80 && cur.startsWith(exp));
    if (!ok) mark(els, kind, 'bad');
    return { ...st, value: cur.slice(0, 80), ok };
  });
}

/** 사용자 작업을 기다릴 때 보는 상태: 팝업, 주소, 저장된 행 수, 첨부된 파일 수, 지켜볼 칸 값 */
export function watchState(keys: string[]): { modal: boolean; modalTitle: string; url: string; rows: number; files: number; values: Record<string, string> } {
  const m = modalState();
  const values: Record<string, string> = {};
  for (const k of keys) values[k] = stateOf(k).value;
  const files = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).reduce((n, i) => n + (i.files?.length ?? 0), 0);
  return { modal: m.open, modalTitle: m.title, url: location.href, rows: document.querySelectorAll('[data-clf-kind="button:edit"]').length, files, values };
}
