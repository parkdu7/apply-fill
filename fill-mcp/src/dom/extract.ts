// 폼 필드/버튼 추출. LLM이 읽기 좋게 라벨·섹션·선택지만 압축해서 돌려준다.
import { noticeOf } from './files.js';
import { classifyButton } from './actions.js';
import {
  byPrecedingText,
  collectHeadings,
  containerTitle,
  fieldLabel,
  groupLabel,
  hintOf,
  optionLabel,
  placeholderNoun,
  sectionOf,
  type Heading,
  type LabelHit,
} from './label.js';
import {
  PLACEHOLDER_TEXT,
  closeListbox,
  customListFor,
  floating,
  isPlaceholderOption,
  openListbox,
  openListboxes,
  optionsIn,
  searchInputIn,
  summarizeOptions,
} from './listbox.js';
import { CONSENT_LABEL, SENSITIVE_LABEL } from './safety.js';
import { isDisabledButton, optionText, pressedToggle, toggleOptions } from './toggle.js';
import type { ActionButton, CardSection, Field, FieldKind, ManualReason, PageScan } from './types.js';
import { CONTROL_SELECTOR, clean, hasControls, isLabelEditable, meaningful, precedes, selectedText, squash, textOf, visible } from './util.js';

export interface ScanOptions {
  /** 커스텀 드롭다운을 잠깐 열어서 선택지를 읽을지 (기본 true) */
  probeOptions?: boolean;
}

interface Entry {
  field: Field;
  els: HTMLElement[];
  anchor: HTMLElement;
  labelSrc: Node | null;
  /** 다른 칸을 건너서 찾은 줄 라벨 (한 줄에 칸이 여러 개인 경우) */
  row?: LabelHit;
}

const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const BUTTON_SELECTOR =
  'button, [role="button"], input[type="button"], input[type="submit"], input[type="image"], a[href], a[onclick]';
// 자기소개서 판단: 크기나 글자 수 카운터로는 판단하지 않는다 (활동내용·수상내용 칸도 크고 카운터가 있다)
const ESSAY_TOPIC = /자기\s*소개|소개서|자소서|지원\s*(한\s*)?동기|입사\s*후|포부|성장\s*과정|장\s*단점|가치관|이루고\s*싶은|극복|갈등/;
const ESSAY_SECTION = /자기\s*소개|소개서|자소서|에세이|essay|질문|문항/i;
const QUESTION_FORM = /하십시오|하시오|주십시오|해\s*주세요|기술\s*하|서술|바랍니다|\?$/;
const DESCRIPTION_LABEL = /내용|업무|설명|비고|성과|역할|요약|활동|수상|프로젝트|경력|사항/;
const DATE_HINT = /yyyy|yy[.\-/]mm|mm[.\-/]dd|년\s*월|날짜|일자|생년월일|date|datepicker|calendar/i;
/** 아이콘으로 그린 체크/라디오 (careerlink 가산점 "장애 여부" 등) */
const CHECK_ICON = 'svg[data-testid*="RadioButton"], svg[data-testid*="CheckBox"], svg[data-testid*="CheckCircle"]';

/** 검색해서 고르는 칸 (aria 표시가 없어도) */
const SEARCH_HINT = /검색|찾기|search/i;

const win = window as Window & { __clfSeq?: number; __clfDropLooks?: Set<string> };

function newKey(prefix: string): string {
  win.__clfSeq = (win.__clfSeq ?? 0) + 1;
  return `${prefix}${win.__clfSeq}`;
}

/**
 * 요소에 data-clf 키를 붙인다. 복제된 행처럼 키가 겹치면 새로 발급하고 copied=true.
 * cloneNode로 복제된 행은 원본의 "에이전트 입력" 표시와 선택지 캐시까지 복사돼 있으니 지운다.
 */
function assignKey(els: HTMLElement[], prefix: string, used: Set<string>): { key: string; copied: boolean } {
  let key = els[0].dataset.clf;
  let copied = false;
  if (!key || !key.startsWith(prefix) || used.has(key) || els.some((e) => e.dataset.clf && e.dataset.clf !== key)) {
    copied = !!key;
    key = newKey(prefix);
    if (copied) {
      for (const e of els) {
        delete e.dataset.clfFilled;
        delete e.dataset.clfOpts;
        delete e.dataset.clfMark;
        e.style.outline = '';
      }
    }
  }
  for (const e of els) e.dataset.clf = key;
  used.add(key);
  return { key, copied };
}

const SIZE_HINT = /(최대\s*)?\d+(\.\d+)?\s*(KB|MB|GB)\s*(이하|이내|까지|미만)?/i;
const AGE_HINT = /\d+\s*(개월|달|일)\s*이내(\s*발급)?/;

const GENERIC_FILE_LABEL = /^(파일\s*(선택|첨부|찾기|업로드|올리기)|첨부(하기)?|찾아보기|업로드|browse|choose\s*file|select\s*file|upload)$/i;

/** 업로드 칸 앞쪽 글자: 라벨 버튼(또는 input)의 앞 형제부터, 없으면 부모의 앞 형제 */
function fileItemLabel(el: HTMLInputElement): string {
  let node: Element | null = el.labels?.[0] ?? el;
  for (let depth = 0; depth < 3 && node; depth++, node = node.parentElement) {
    for (let p = node.previousElementSibling; p; p = p.previousElementSibling) {
      const t = stripMarks(clean(p.textContent ?? '')).label;
      if (t && !GENERIC_FILE_LABEL.test(t) && t.length <= 30) return t;
    }
  }
  return '';
}

function hidden(el: Element): boolean {
  return !!el.closest('[aria-hidden="true"], [data-clf-ignore], [inert]');
}

function controlVisible(input: HTMLInputElement): boolean {
  return visible(input) || Array.from(input.labels ?? []).some((l) => visible(l)) || visible(input.parentElement);
}

function topModal(): HTMLElement | null {
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open], [role="dialog"], [role="alertdialog"]'),
  ).filter(
    (d) =>
      visible(d) &&
      (d.getAttribute('aria-modal') === 'true' ||
        d.tagName === 'DIALOG' ||
        d.getAttribute('role') === 'alertdialog' ||
        !!d.closest('[class*="Modal-root"], [class*="Dialog-root"]')),
  );
  return modals[modals.length - 1] ?? null;
}

function stripMarks(label: string): { label: string; required: boolean } {
  const required = /[*＊]|\(필수\)|필수$/.test(label);
  const cleaned = clean(label.replace(/[*＊]/g, ' ').replace(/\(필수\)|필수$/g, ' '));
  return { label: cleaned, required };
}

function short(v: string, n = 50): string {
  const s = clean(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function looksLikeDate(el: HTMLInputElement, label: string): boolean {
  const adornment = el.closest('[class*="InputBase-root"]')?.querySelector('button[aria-label]');
  const blob = `${el.placeholder} ${el.name} ${el.id} ${el.className} ${label} ${adornment?.getAttribute('aria-label') ?? ''}`;
  // 라벨이 "~일"로 끝나면 날짜 (이메일·파일은 제외)
  const dayWord = /((?<![메파])일|일자|년월|연월)$/;
  return DATE_HINT.test(blob) || /(19|20)\d{2}[.\-/]\d{2}/.test(el.placeholder) || dayWord.test(label) || dayWord.test(clean(el.placeholder));
}

/** 자기소개서 문항인지: 주제어, 자기소개서 섹션, 또는 질문형 라벨(활동·수상 "내용" 칸은 제외) */
function isEssay(label: string, section = ''): boolean {
  if (ESSAY_TOPIC.test(label) || ESSAY_SECTION.test(section)) return true;
  return (QUESTION_FORM.test(label) || label.length > 25) && !DESCRIPTION_LABEL.test(label);
}

function base(el: HTMLElement, kind: FieldKind, headings: Heading[]): { field: Field; labelSrc: Node | null; row?: LabelHit } {
  const hit = fieldLabel(el);
  const { label, required } = stripMarks(hit.text);
  const field: Field = { key: '', kind, label };
  const section = sectionOf(el, headings);
  if (section) field.section = section;
  const row = hit.row && { text: stripMarks(hit.row.text).label, src: hit.row.src };
  const rowRequired = !!hit.row && stripMarks(hit.row.text).required;
  if (required || rowRequired || (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') field.required = true;
  const ph = clean(el.getAttribute('placeholder'));
  if (ph && ph !== label) field.placeholder = ph;
  const max = (el as HTMLInputElement).maxLength;
  if (max > 0 && max < 100000) field.maxLength = max;
  const hint = hintOf(el);
  if (hint) field.hint = hint;
  if (el.dataset.clfFilled === '1') field.filledByAgent = true;
  return { field, labelSrc: hit.src, row };
}

function manualFor(el: HTMLElement, field: Field): ManualReason | undefined {
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
  if (SENSITIVE_LABEL.test(field.label) || SENSITIVE_LABEL.test((el as HTMLInputElement).name ?? '')) return 'sensitive';
  return undefined;
}

function describeInput(el: HTMLInputElement, headings: Heading[]): Entry | null {
  const type = el.type.toLowerCase();
  // 업로드 칸은 input을 숨기고 버튼·라벨을 대신 보여 주는 경우가 대부분이다
  if (!visible(el) && !(type === 'file' && controlVisible(el))) return null;
  // aria가 없어도: 검색하라는 칸, 또는 입력했더니 후보 목록이 떴던 칸(fill이 combobox로 바꿔 둔 것)
  const searchLike =
    (type === 'text' || type === 'search') &&
    !el.readOnly &&
    (SEARCH_HINT.test(`${el.placeholder} ${el.getAttribute('aria-label') ?? ''} ${el.name}`) || el.dataset.clfKind === 'combobox');
  const combobox = el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete') || searchLike;
  let kind: FieldKind = combobox
    ? 'combobox'
    : type === 'email' || type === 'tel' || type === 'number' || type === 'date' || type === 'month'
      ? type
      : 'text';
  const { field, labelSrc, row } = base(el, kind, headings);
  let manual = manualFor(el, field);
  if (type === 'file') manual = 'file';
  else if (type === 'password') manual = 'password';
  if (kind === 'text' && looksLikeDate(el, field.label)) kind = field.kind = 'date';
  if (!manual && el.readOnly && kind !== 'date') manual = 'readonly';
  if (el.value && type !== 'file' && type !== 'password') field.value = short(el.value);
  if (type === 'file') {
    // "파일 선택" 같은 업로드 버튼 글자는 라벨이 아니다: 앞에 있는 글자(항목 이름)를 쓴다
    if (GENERIC_FILE_LABEL.test(field.label) || !field.label) {
      const better = fileItemLabel(el);
      if (better) field.label = better;
    }
    if (el.files?.length) field.value = short(Array.from(el.files, (f) => f.name).join(', '));
    const accept = el.getAttribute('accept');
    const notice = noticeOf(el);
    const limit = SIZE_HINT.exec(notice)?.[0];
    const age = AGE_HINT.exec(notice)?.[0];
    const bits = [accept && `형식 ${accept}`, limit && `크기 ${clean(limit)}`, age && `발급 ${clean(age)}`].filter(Boolean);
    if (bits.length) field.hint = bits.join(' · ');
  }
  if (kind === 'combobox' && !field.hint) field.hint = '검색해서 고르는 칸';
  if (manual) field.manual = manual;
  return { field, els: [el], anchor: el, labelSrc, row };
}

function describeSelect(el: HTMLSelectElement, headings: Heading[]): Entry | null {
  if (!visible(el)) return null;
  const { field, labelSrc } = base(el, 'select', headings);
  const opts = Array.from(el.options).filter((o) => !isPlaceholderOption(o.text, o.value));
  const sum = summarizeOptions(opts.map((o) => clean(o.text)));
  field.options = sum.options;
  if (sum.more) field.moreOptions = sum.more;
  const sel = selectedText(el);
  if (sel) field.value = sel;
  const manual = manualFor(el, field);
  if (manual) field.manual = manual;
  return { field, els: [el], anchor: el, labelSrc };
}

function describeTextarea(el: HTMLTextAreaElement, headings: Heading[]): Entry | null {
  if (!visible(el)) return null;
  const { field, labelSrc } = base(el, 'textarea', headings);
  if (el.value) field.value = short(el.value);
  const manual = manualFor(el, field) ?? (isEssay(field.label, field.section) ? 'essay' : el.readOnly ? 'readonly' : undefined);
  if (manual) field.manual = manual;
  return { field, els: [el], anchor: el, labelSrc };
}

function describeListbox(el: HTMLElement, headings: Heading[]): Entry | null {
  if (!visible(el)) return null;
  const { field, labelSrc, row } = base(el, 'listbox', headings);
  const display = clean(textOf(el, 80));
  if (el.dataset.clfDrop === '1' || el.tagName === 'BUTTON') {
    // 버튼 드롭다운은 아무것도 안 골랐을 때 버튼 글자가 안내문("관계를 선택해주세요.", "분야")이다
    if (display && !isButtonPlaceholder(el, display)) field.value = display;
    else if (display) field.placeholder = display;
    // 고른 뒤에도 처음 본 안내문을 칸 이름으로 쓴다 (고르기 전후로 라벨이 바뀌지 않게)
    if (field.value && el.dataset.clfPh) field.placeholder = el.dataset.clfPh;
    if (el.dataset.clfSearchable === '1') field.hint = '목록 안에서 검색해서 고르는 칸';
  } else if (display && display !== field.label) field.value = display;
  const native = el.parentElement?.querySelector<HTMLInputElement>('input[aria-hidden="true"]');
  if (native?.required) field.required = true;
  const manual = el.closest('.ant-select-disabled, .ant-dropdown-disabled') ? 'disabled' : manualFor(el, field);
  if (manual) field.manual = manual;
  return { field, els: [el], anchor: el, labelSrc, row };
}

/**
 * 버튼 드롭다운의 글자가 안내문인지 고른 값인지.
 * 처음 본 안내문을 기억해 두고(clfPh), 모르면 선택지에 있는 글자인지로 판단한다.
 */
function isButtonPlaceholder(el: HTMLElement, display: string): boolean {
  if (el.dataset.clfPh) return squash(el.dataset.clfPh) === squash(display);
  const opts = el.dataset.clfOpts ? (JSON.parse(el.dataset.clfOpts) as string[]) : undefined;
  if (PLACEHOLDER_TEXT.test(display) || (opts && !opts.some((o) => squash(o) === squash(display)))) {
    el.dataset.clfPh = display;
    return true;
  }
  // 선택지를 모르는 비활성 드롭다운: 아직 못 고른 상태로 본다
  if (!opts) el.dataset.clfPh = display;
  return !opts;
}

function describeEditable(el: HTMLElement, headings: Heading[]): Entry | null {
  if (!visible(el) || el.closest('[contenteditable="true"]') !== el) return null;
  const { field, labelSrc } = base(el, 'editable', headings);
  const text = textOf(el, 80);
  if (text) field.value = short(text);
  if (isEssay(field.label, field.section)) field.manual = 'essay';
  return { field, els: [el], anchor: el, labelSrc };
}

function describeRadioGroup(radios: HTMLInputElement[], headings: Heading[]): Entry {
  const g = groupLabel(radios);
  const { label, required } = stripMarks(g.text || radios[0].name);
  const options = radios.map((r) => optionLabel(r));
  const field: Field = { key: '', kind: 'radio', label, options };
  const section = sectionOf(radios[0], headings);
  if (section) field.section = section;
  if (required || radios.some((r) => r.required)) field.required = true;
  const checked = radios.find((r) => r.checked);
  if (checked) field.value = optionLabel(checked);
  if (radios.some((r) => r.dataset.clfFilled === '1')) field.filledByAgent = true;
  if (radios.every((r) => r.disabled)) field.manual = 'disabled';
  else if (CONSENT_LABEL.test(label) || options.some((o) => CONSENT_LABEL.test(o))) field.manual = 'consent';
  return { field, els: radios, anchor: radios[0], labelSrc: g.src };
}

function describeCheckbox(el: HTMLInputElement, siblings: HTMLInputElement[], headings: Heading[]): Entry {
  const opt = optionLabel(el);
  let labelSrc: Node | null = el;
  let label = opt;
  if (siblings.length > 1) {
    const g = groupLabel(siblings);
    if (g.text && g.text !== opt) label = opt ? `${g.text} › ${opt}` : g.text;
    labelSrc = g.src;
  } else if (!opt) {
    const hit = fieldLabel(el);
    label = hit.text;
    labelSrc = hit.src;
  }
  const marks = stripMarks(label);
  const field: Field = { key: '', kind: 'checkbox', label: marks.label, value: el.checked ? 'true' : 'false' };
  const section = sectionOf(el, headings);
  if (section) field.section = section;
  if (marks.required || el.required) field.required = true;
  if (el.dataset.clfFilled === '1') field.filledByAgent = true;
  if (el.disabled) field.manual = 'disabled';
  else if (CONSENT_LABEL.test(opt) || CONSENT_LABEL.test(label)) field.manual = 'consent';
  return { field, els: [el], anchor: el, labelSrc };
}

/**
 * 라디오처럼 하나를 고르는 버튼 묶음: aria-pressed 토글, role=radio, 같은 라벨 아래 나란한 li > button (군필/미필, 졸업/졸업예정).
 * 고른 버튼은 aria → 클래스 → 생김새로 읽는다.
 */
function describeToggleGroup(group: HTMLElement, headings: Heading[]): Entry | null {
  const buttons = toggleOptions(group);
  if (buttons.length < 2 || !visible(group)) return null;
  const hit = fieldLabel(group);
  const { label, required } = stripMarks(hit.text);
  const field: Field = { key: '', kind: 'toggle', label, options: buttons.map(optionText) };
  const section = sectionOf(group, headings);
  if (section) field.section = section;
  if (required) field.required = true;
  const pressed = pressedToggle(group);
  if (pressed) field.value = optionText(pressed);
  else if (group.dataset.clfPicked) field.value = group.dataset.clfPicked;
  if (group.dataset.clfFilled === '1') field.filledByAgent = true;
  if (buttons.every(isDisabledButton)) field.manual = 'disabled';
  else if (CONSENT_LABEL.test(label)) field.manual = 'consent';
  else if (buttons.some(isDisabledButton)) field.hint = `비활성: ${buttons.filter(isDisabledButton).map(optionText).join(', ')}`;
  return { field, els: [group], anchor: group, labelSrc: hit.src };
}

/** li > button이 2개 이상 나란한 묶음 (팝업 목록·탭·머리글은 빼고) */
function isButtonGroup(g: HTMLElement): boolean {
  const kids = Array.from(g.children);
  if (kids.length < 2 || kids.some((k) => k.tagName !== 'LI')) return false;
  if (g.closest('[role="listbox"], [role="menu"], [role="tablist"], header, footer') || floating(g) || hidden(g)) return false;
  return kids.every((li) => {
    const bs = li.querySelectorAll<HTMLElement>('button, [role="button"]');
    if (bs.length !== 1 || li.querySelector('input, select, textarea')) return false;
    const { text, kind } = classifyButton(bs[0]);
    return !!text && text.length <= 20 && meaningful(text) && kind === 'other';
  });
}

function findToggleGroups(root: ParentNode): HTMLElement[] {
  const groups = new Set<HTMLElement>();
  for (const b of Array.from(root.querySelectorAll<HTMLElement>('button[aria-pressed]'))) {
    const g = b.closest<HTMLElement>('[role="group"], [class*="ToggleButtonGroup-root"]') ?? b.parentElement;
    if (g) groups.add(g);
  }
  for (const r of Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]:not(input)'))) {
    const g = r.closest<HTMLElement>('[role="radiogroup"]') ?? r.parentElement;
    if (g) groups.add(g);
  }
  for (const li of Array.from(root.querySelectorAll('li'))) {
    const g = li.parentElement;
    if (g && !groups.has(g) && isButtonGroup(g)) groups.add(g);
  }
  return [...groups].filter((g) => !hidden(g));
}

// ---------- aria 없는 버튼 드롭다운 ----------

/** 드롭다운 버튼의 모양 (확인된 드롭다운과 같은 모양의 비활성 버튼도 드롭다운으로 본다) */
function triggerLook(el: HTMLElement): string {
  return `${el.tagName}.${String(el.className).trim()}`;
}

function iconOnly(e: Element | null): boolean {
  return !!e && (e.tagName.toLowerCase() === 'svg' || (!clean(e.textContent) && !!e.querySelector('svg')));
}

/**
 * 드롭다운일 수 있는 버튼: aria-haspopup/expanded, "~를 선택해주세요" 글자, 또는 글자 뒤 화살표 아이콘(<p>글자</p><svg/>).
 * 모양만 본다. 실제로 드롭다운인지는 눌러 봐서(목록이 생기는지) 정한다. 추가·저장·제출 같은 버튼은 후보가 아니다.
 */
function dropdownCandidate(el: HTMLElement): boolean {
  if (el.dataset.clfDrop === '0') return false;
  if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false;
  if (el.matches('[aria-haspopup="listbox"], [aria-pressed], [role="tab"], [role="radio"]')) return false;
  if (hidden(el) || !visible(el) || el.closest('[role="listbox"], [role="menu"], header, footer, [data-clf-kind="toggle"]')) return false;
  // 입력 칸에 붙은 아이콘 버튼(달력 열기, 자동완성 열기)은 칸의 일부다
  if (el.closest('[class*="InputAdornment"], [class*="Autocomplete-endAdornment"]')) return false;
  const { text, kind } = classifyButton(el);
  if (kind !== 'other' || !text || text.length > 40 || !meaningful(textOf(el, 40))) return false;
  if (el.dataset.clfDrop === '1' || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || PLACEHOLDER_TEXT.test(text)) return true;
  return el.children.length >= 2 && iconOnly(el.lastElementChild) && !iconOnly(el.firstElementChild);
}

/** antd 드롭다운·Select의 트리거. 클래스는 후보를 찾는 단서일 뿐, 드롭다운인지는 똑같이 눌러 봐서 정한다 */
const ANT_TRIGGER = '.ant-dropdown-trigger, .ant-select-selector';
const ANT_DISABLED = '.ant-select-disabled, .ant-dropdown-disabled, [aria-disabled="true"]';

/**
 * button이 아닌 div/span 드롭다운 후보 (ninehire: <div class="ant-dropdown-trigger"><span>선택해주세요.</span></div>).
 * antd 트리거 클래스, 이미 드롭다운으로 확인한 것, 또는 안내문 글자("선택해주세요.")만 보여 주는 누를 수 있는(cursor:pointer) 상자.
 */
function divTriggerCandidates(root: ParentNode): HTMLElement[] {
  const out = new Set<HTMLElement>(Array.from(root.querySelectorAll<HTMLElement>(`${ANT_TRIGGER}, [data-clf-drop="1"]`)));
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = clean(walker.currentNode.nodeValue);
    if (!t || t.length > 30 || !PLACEHOLDER_TEXT.test(t) || walker.currentNode.parentElement?.closest(ANT_TRIGGER)) continue;
    let trigger: HTMLElement | null = null;
    // 같은 글자만 담은 조상 중 가장 바깥의 누를 수 있는 상자
    for (let box = walker.currentNode.parentElement, i = 0; box && i < 4; box = box.parentElement, i++) {
      if (box.closest('button, [role="button"], label, select, option, [aria-haspopup], [role="combobox"]')) break;
      if (hasControls(box) || clean(textOf(box, 60)) !== t) break;
      if (getComputedStyle(box).cursor === 'pointer') trigger = box;
    }
    if (trigger) out.add(trigger);
  }
  const all = [...out];
  return all.filter((el) => !el.matches('button, [role="button"]') && !all.some((o) => o !== el && o.contains(el)) && divDropdownCandidate(el));
}

function divDropdownCandidate(el: HTMLElement): boolean {
  if (el.dataset.clfDrop === '0' || hidden(el) || !visible(el)) return false;
  if (el.closest('[role="listbox"], [role="menu"], header, footer, [data-clf-kind="toggle"]')) return false;
  if (el.querySelector('button, [role="button"], a[href]')) return false;
  // antd Select 트리거는 안에 검색 input이 있다. 그 밖의 상자는 입력 칸을 품으면 드롭다운이 아니다
  if (!el.matches('.ant-select-selector') && hasControls(el)) return false;
  const text = textOf(el, 60);
  if (text.length > 40) return false;
  // 더보기 메뉴(수정·삭제) 같은 동작 메뉴는 칸이 아니다
  return !text || classifyButton(el).kind === 'other';
}

/**
 * 후보 버튼을 눌러 보고 목록이 생기면 드롭다운으로 확정한다 (선택지도 같이 읽고 닫는다).
 * 비활성 버튼은 누를 수 없으니 안내문 글자나, 확인된 드롭다운과 같은 모양인지로 판단한다.
 */
async function probeTrigger(el: HTMLElement): Promise<boolean> {
  if (el.dataset.clfDrop) return el.dataset.clfDrop === '1';
  const looks = (win.__clfDropLooks ??= new Set());
  if (isDisabledButton(el) || !!el.closest(ANT_DISABLED)) return PLACEHOLDER_TEXT.test(textOf(el, 40)) || looks.has(triggerLook(el));
  const lb = await openListbox(el, 600);
  if (!lb) {
    el.dataset.clfDrop = '0';
    return false;
  }
  el.dataset.clfDrop = '1';
  el.dataset.clfOpts = JSON.stringify(optionsIn(lb).map((o) => o.text));
  if (searchInputIn(lb)) el.dataset.clfSearchable = '1';
  looks.add(triggerLook(el));
  await closeListbox(lb, el);
  return true;
}

/**
 * 한 줄 라벨 아래에 칸이 여러 개면 "줄 라벨 › 칸 이름"으로 구분한다.
 * 칸 이름은 placeholder("병과를 입력해주세요." → 병과), 버튼 드롭다운의 안내문, 묶음이 둘 이상이면 선택지("주간/야간").
 */
function refineSharedLabels(entries: Entry[]): void {
  // 같은 줄 = 라벨 글자가 같고, 라벨과 칸을 함께 감싼 가장 가까운 상자가 같다 (라벨을 찾은 경로가 달라도)
  const groups = new Map<Node, Map<string, Entry[]>>();
  for (const e of entries) {
    const src = e.row?.src ?? e.labelSrc;
    const text = e.row?.text || e.field.label;
    if (!src || !text) continue;
    let box: Node | null = src;
    while (box && !box.contains(e.anchor)) box = box.parentNode;
    if (!box || box === e.anchor) box = src;
    const byText = groups.get(box) ?? groups.set(box, new Map()).get(box)!;
    const list = byText.get(text);
    if (list) list.push(e);
    else byText.set(text, [e]);
  }
  for (const list of [...groups.values()].flatMap((m) => [...m.values()])) {
    if (list.length < 2) continue;
    const toggles = list.filter((e) => e.field.kind === 'toggle').length;
    for (const e of list) {
      const rowLabel = e.row?.text || e.field.label;
      let noun = '';
      if (e.field.kind === 'toggle') {
        const joined = (e.field.options ?? []).join('/');
        if (toggles >= 2 && joined.length <= 20) noun = joined;
      } else noun = placeholderNoun(e.field.placeholder) || (e.row ? e.field.label : '');
      const r = squash(rowLabel);
      const n = squash(noun);
      if (noun && !r.includes(n) && !n.includes(r)) e.field.label = `${rowLabel} › ${noun}`;
      else if (e.row) e.field.label = rowLabel;
    }
  }
}

/** 아이콘 + 글자로 그린 커스텀 체크. 누를 대상은 아이콘을 감싼 클릭 영역 */
function describeIconCheck(icon: Element, headings: Heading[]): Entry | null {
  let target = icon.parentElement as HTMLElement | null;
  for (let a = target, i = 0; a && i < 4; a = a.parentElement, i++) {
    if (a.matches('[role="checkbox"], [role="radio"], [role="switch"], [onclick]') || getComputedStyle(a).cursor === 'pointer') {
      target = a;
      break;
    }
  }
  if (!target || target.querySelector('input') || target.closest('label, button, [role="option"]') || !visible(target)) return null;
  const label = stripMarks(textOf(target, 60));
  if (!label.label) return null;
  target.dataset.clfCustom = 'icon';
  const id = icon.getAttribute('data-testid') ?? '';
  const checked = !/Unchecked|OutlineBlank|Blank/i.test(id);
  const field: Field = { key: '', kind: 'checkbox', label: label.label, value: checked ? 'true' : 'false' };
  const section = sectionOf(target, headings);
  if (section) field.section = section;
  if (target.dataset.clfFilled === '1') field.filledByAgent = true;
  if (CONSENT_LABEL.test(label.label)) field.manual = 'consent';
  return { field, els: [target], anchor: target, labelSrc: target };
}

// ---------- div로 그린 입력 칸 (주소 검색 팝업) ----------

const ADDRESS_LABEL = /주소|우편\s*번호|도로명|지번|address|zip\s*code|post\s*code/i;
const PSEUDO_INPUT_CLASS = /div-?like-?input|fake-?input|pseudo-?input/i;

/** 입력 칸처럼 생긴 상자: 칸 높이, 어느 정도 너비, 테두리 */
function inputLikeBox(el: HTMLElement, needBorder: boolean): boolean {
  const r = el.getBoundingClientRect();
  if (r.height < 20 || r.height > 64 || r.width < 60) return false;
  if (!needBorder) return true;
  const s = getComputedStyle(el);
  return parseFloat(s.borderBottomWidth) > 0 || parseFloat(s.borderTopWidth) > 0;
}

/**
 * input이 아니라 div로 그린 칸 (ninehire DivLikeInput: 우편번호·도로명주소). 누르면 주소 검색 팝업이 뜨고 그걸로만 값이 들어간다.
 * 팝업은 자동화하지 않는다: "직접 입력"으로 표시해서 사용자에게 넘긴다.
 * 판단: DivLikeInput 같은 이름의 클래스, 또는 주소 라벨이 붙은 테두리 있는 칸 모양 상자 (안에 입력 칸·버튼·아이콘 없음).
 */
function describePseudoInput(el: HTMLElement, headings: Heading[]): Entry | null {
  if (hidden(el) || !visible(el) || el.dataset.clfDrop === '1' || el.matches(`${ANT_TRIGGER}, [role]`)) return null;
  if (hasControls(el) || el.querySelector('button, [role="button"], a[href], svg, img') || el.children.length > 2) return null;
  if ((el.dataset.clfKind && el.dataset.clfKind !== 'text') || el.closest('button, [role="button"], label, [role="listbox"], [role="menu"]')) return null;
  if (el.parentElement?.closest('[data-clf-kind]')) return null;
  const own = clean(textOf(el, 60));
  if (own.length > 40) return null;
  const hinted = PSEUDO_INPUT_CLASS.test(String(el.className));
  if (!inputLikeBox(el, !hinted)) return null;
  const { field, labelSrc, row } = base(el, 'text', headings);
  if (!hinted && !ADDRESS_LABEL.test(`${field.label} ${own}`)) return null;
  // 안 채운 상자는 안내문("우편번호"), 숫자가 있으면 이미 들어간 값. 한 라벨 아래 상자가 여럿이라 안내문을 라벨에 붙인다
  if (own && /\d/.test(own)) field.value = short(own);
  else if (own && own !== field.label) {
    field.placeholder = own;
    field.label = field.label ? `${field.label} › ${own}` : own;
  }
  field.manual = ADDRESS_LABEL.test(`${field.label} ${own}`) ? 'address' : 'popup';
  return { field, els: [el], anchor: el, labelSrc, row };
}

function radioGroupKey(r: HTMLInputElement, containers: Map<Element, string>): string {
  // 이름이 선택지마다 다른 사이트(ats-: name="남", name="여")는 같은 fieldset이면 한 묶음으로 본다
  const box = r.closest<HTMLElement>('[role="radiogroup"], fieldset');
  const alone = !!r.name && document.querySelectorAll(`input[type="radio"][name="${CSS.escape(r.name)}"]`).length === 1;
  if (r.name && !(alone && box && box.querySelectorAll('input[type="radio"]').length > 1)) return `n:${r.form?.id ?? ''}:${r.name}`;
  const c = box ?? r.parentElement?.parentElement ?? r;
  let id = containers.get(c);
  if (!id) {
    id = `c:${containers.size}`;
    containers.set(c, id);
  }
  return id;
}

/** 같은 라벨이 이어지면 분할 칸(part), 떨어져 반복되면 행 번호(nth) */
function annotateRepeats(entries: Entry[]): void {
  const index = new Map<Entry, number>(entries.map((e, i) => [e, i]));
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.field.label) continue;
    const k = `${e.field.section ?? ''}|${e.field.label}|${e.field.kind === 'radio' ? 'r' : ''}`;
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const chains: Entry[][] = [];
    for (const e of list) {
      const chain = chains[chains.length - 1];
      const prev = chain?.[chain.length - 1];
      const adjacent =
        prev &&
        index.get(e) === index.get(prev)! + 1 &&
        !!prev.labelSrc &&
        prev.labelSrc === e.labelSrc &&
        prev.anchor.closest('tr, li, dd') === e.anchor.closest('tr, li, dd');
      if (adjacent) chain.push(e);
      else chains.push([e]);
    }
    chains.forEach((chain, i) => {
      if (chains.length > 1) for (const e of chain) e.field.nth = i + 1;
      if (chain.length > 1) chain.forEach((e, j) => (e.field.part = `${j + 1}/${chain.length}`));
    });
  }
}

const PHONE_LABEL = /연락처|전화|휴대|핸드폰|phone|tel|mobile/i;
const DIAL_OPTION = /\+\s?\d{1,4}(?!\d)/;
const DIAL_HINT = '국가번호 칸 (예: 대한민국(+82)) — 관계·이름을 넣는 칸이 아님';

function dialOptions(f: Field): boolean {
  const o = f.options ?? [];
  return o.length >= 2 && o.filter((x) => DIAL_OPTION.test(x)).length >= o.length * 0.6;
}

/**
 * 같은 라벨의 [선택 칸][글자 칸]이 나란하면 한 항목의 두 칸(국가번호 + 번호)으로 본다.
 * "긴급 연락처 #1/#2"로 보여 주면 LLM이 #1을 관계 칸으로 오해한다 (관계 "모" → 모나코·모로코).
 * 선택지가 국가번호 목록인 칸도 표시해 두고, 입력 전에 엉뚱한 값을 막는다.
 */
function annotateDialPairs(entries: Entry[]): void {
  const count = new Map<string, number>();
  for (const e of entries) count.set(`${e.field.section ?? ''}|${e.field.label}`, (count.get(`${e.field.section ?? ''}|${e.field.label}`) ?? 0) + 1);
  const flag = (e: Entry) => {
    e.field.hint = e.field.hint && e.field.hint !== '검색해서 고르는 칸' ? `${DIAL_HINT} · ${e.field.hint}` : DIAL_HINT;
    for (const el of e.els) el.dataset.clfCc = '1';
  };
  for (let i = 0; i + 1 < entries.length; i++) {
    const a = entries[i].field;
    const b = entries[i + 1].field;
    if (!a.label || a.label !== b.label || a.section !== b.section || a.part || b.part) continue;
    if (!['select', 'listbox', 'combobox'].includes(a.kind) || !['text', 'tel', 'number'].includes(b.kind)) continue;
    if (!dialOptions(a) && !PHONE_LABEL.test(a.label)) continue;
    if (count.get(`${a.section ?? ''}|${a.label}`) === 2) {
      delete a.nth;
      delete b.nth;
    }
    a.part = '1/2';
    b.part = '2/2';
    flag(entries[i]);
  }
  for (const e of entries) if (!e.els[0].dataset.clfCc && dialOptions(e.field)) flag(e);
}

/** 드롭다운 선택지: 읽어 둔 것이 있으면 그것, 없고 open이면 잠깐 열어서 읽는다 */
async function probeOptions(entry: Entry, open: boolean): Promise<void> {
  const el = entry.anchor;
  let texts: string[] | undefined;
  const cached = el.dataset.clfOpts;
  if (cached) texts = JSON.parse(cached) as string[];
  else if (open && !entry.field.manual) {
    const lb = await openListbox(el);
    if (lb) {
      texts = optionsIn(lb).map((o) => o.text);
      await closeListbox(lb, el);
      el.dataset.clfOpts = JSON.stringify(texts);
    }
  }
  if (!texts) return;
  const sum = summarizeOptions(texts);
  entry.field.options = sum.options;
  if (sum.more) entry.field.moreOptions = sum.more;
}

function scanButtons(root: ParentNode, headings: Heading[], used: Set<string>): ActionButton[] {
  const out: ActionButton[] = [];
  const taken = new Set<Element>();
  let others = 0;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(BUTTON_SELECTOR))) {
    if (hidden(el) || el.closest('[role="listbox"], [data-clf-kind="toggle"]')) continue;
    if (el.matches('[aria-haspopup="listbox"], [role="combobox"]')) continue;
    // 칸으로 읽은 버튼(드롭다운), 열려 있는 팝업 목록의 선택지
    if (el.dataset.clfKind && !el.dataset.clfKind.startsWith('button:')) continue;
    const li = el.closest('li');
    if (li?.parentElement && floating(li.parentElement)) continue;
    if (el.closest('[class*="InputAdornment"], [class*="Autocomplete-endAdornment"]')) continue;
    if (!visible(el)) continue;
    const parentButton = el.parentElement?.closest(BUTTON_SELECTOR);
    if (parentButton && taken.has(parentButton)) continue;
    if (el.tagName === 'A') {
      // 다른 페이지로 가는 링크는 버튼으로 취급하지 않는다
      const href = (el.getAttribute('href') ?? '').trim().toLowerCase();
      const inPage = !href || href.startsWith('#') || href.startsWith('javascript:');
      if (!inPage && el.getAttribute('role') !== 'button' && !el.hasAttribute('onclick')) continue;
    }
    const { text, kind } = classifyButton(el);
    if (!text) continue;
    if (kind === 'other') {
      // nav는 제외하지 않는다: careerlink는 본문 전체가 <nav> 안에 있다
      if (others >= 30 || el.closest('header, footer, [role="banner"], [role="contentinfo"]')) continue;
      others++;
    }
    const { key } = assignKey([el], 'b', used);
    el.dataset.clfKind = `button:${kind}`;
    taken.add(el);
    const b: ActionButton = { key, kind, text };
    let section = sectionOf(el, headings);
    // 한 섹션에 추가 버튼이 여럿이면(경력기술서/포트폴리오) 버튼 앞 줄 라벨을 붙인다
    if (kind === 'add' && !containerTitle(el)) {
      const sub = byPrecedingText(el);
      const t = sub ? stripMarks(sub.text).label : '';
      if (t && t.length <= 20 && t !== section && !section.endsWith(t)) section = section ? `${section} › ${t}` : t;
    }
    if (section) b.section = section;
    out.push(b);
  }
  return out;
}

/** 카드형 반복 섹션: 머리글에 추가 버튼이 있는 카드마다 저장된 행(수정 버튼이 있는 줄)을 모은다 */
function scanCards(root: ParentNode): CardSection[] {
  const out: CardSection[] = [];
  for (const header of Array.from(root.querySelectorAll<HTMLElement>('[class*="CardHeader-root"]'))) {
    const card = header.parentElement;
    if (!card || hidden(card) || !visible(card)) continue;
    const add = Array.from(header.querySelectorAll<HTMLElement>('[data-clf-kind="button:add"]'))[0];
    if (!add) continue;
    const title = containerTitle(add);
    const rows: CardSection['rows'] = [];
    for (const edit of Array.from(card.querySelectorAll<HTMLElement>('[data-clf-kind="button:edit"]'))) {
      if (header.contains(edit)) continue;
      let row: HTMLElement = edit;
      for (let a = edit.parentElement, i = 0; a && a !== card && i < 6; a = a.parentElement, i++) {
        row = a;
        if (/Grid-container/.test(String(a.className)) || a.matches('li, tr')) break;
      }
      rows.push({ text: textOf(row, 90), editKey: edit.dataset.clf });
    }
    out.push({ title, addKey: add.dataset.clf, rows });
  }
  return out;
}

/** 열려 있는 드롭다운이 있으면 닫는다 (모달처럼 화면을 가리므로). Escape는 쓰지 않는다. */
async function closeStrayListboxes(): Promise<void> {
  for (const lb of openListboxes()) {
    if (lb.closest('[class*="Popover-root"], [class*="Menu-root"], [class*="Popper"], [class*="Autocomplete-popper"]')) await closeListbox(lb);
  }
  // aria 없는 드롭다운·검색 목록 (트리거는 다시 누르지 않는다: 옆 드롭다운을 열 수 있다)
  for (const t of Array.from(document.querySelectorAll<HTMLElement>('[data-clf-drop="1"], [data-clf-kind="combobox"]'))) {
    const lb = customListFor(t);
    if (lb) await closeListbox(lb);
  }
}

export async function scan(opts: ScanOptions = {}): Promise<PageScan> {
  await closeStrayListboxes();
  const modal = topModal();
  const root: ParentNode = modal ?? document;
  const headings = collectHeadings(root);
  const used = new Set<string>();

  const slots: Array<Entry | string> = []; // string = 라디오 그룹 자리
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const radioContainers = new Map<Element, string>();
  const checkboxesByName = new Map<string, HTMLInputElement[]>();
  const elements = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));

  for (const el of elements) {
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.name) {
      const list = checkboxesByName.get(el.name);
      if (list) list.push(el);
      else checkboxesByName.set(el.name, [el]);
    }
  }

  for (const el of elements) {
    if (hidden(el)) continue;
    // 폼 빌더의 contenteditable 라벨·설명은 칸이 아니다. antd Select 안의 검색 input은 트리거(.ant-select-selector)로 읽는다
    if (isLabelEditable(el) || el.closest('.ant-select')) continue;
    let entry: Entry | null = null;
    if (el instanceof HTMLInputElement) {
      const type = el.type.toLowerCase();
      if (IGNORED_INPUT_TYPES.has(type)) continue;
      if (type === 'radio') {
        if (!controlVisible(el)) continue;
        const gk = radioGroupKey(el, radioContainers);
        const g = radioGroups.get(gk);
        if (g) g.push(el);
        else {
          radioGroups.set(gk, [el]);
          slots.push(gk);
        }
        continue;
      }
      if (type === 'checkbox') {
        if (!controlVisible(el)) continue;
        const siblings = (el.name && checkboxesByName.get(el.name)) || [el];
        entry = describeCheckbox(el, siblings, headings);
      } else entry = describeInput(el, headings);
    } else if (el instanceof HTMLSelectElement) entry = describeSelect(el, headings);
    else if (el instanceof HTMLTextAreaElement) entry = describeTextarea(el, headings);
    else if (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox') entry = describeListbox(el, headings);
    else if (el.isContentEditable) entry = describeEditable(el, headings);
    if (entry) slots.push(entry);
  }

  const entries: Entry[] = slots.map((s) => (typeof s === 'string' ? describeRadioGroup(radioGroups.get(s)!, headings) : s));

  // 토글 묶음, 버튼 드롭다운, 아이콘 체크는 input이 아니라서 따로 찾는다
  const toggleGroups = findToggleGroups(root);
  for (const group of toggleGroups) {
    const e = describeToggleGroup(group, headings);
    if (e) entries.push(e);
  }
  const inToggle = (el: Element) => toggleGroups.some((g) => g.contains(el));
  const candidates = [
    ...Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]')).filter((b) => !inToggle(b) && dropdownCandidate(b)),
    ...divTriggerCandidates(root).filter((d) => !inToggle(d)),
  ];
  // 누를 수 있는 것부터 확인해야 비활성 버튼을 같은 모양으로 판단할 수 있다
  candidates.sort((a, b) => Number(isDisabledButton(a)) - Number(isDisabledButton(b)));
  for (const b of candidates) {
    if (!(await probeTrigger(b))) continue;
    const e = describeListbox(b, headings);
    if (e) entries.push(e);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('div[tabindex], span[tabindex], div[class*="input" i], span[class*="input" i], div[onclick]'))) {
    const e = describePseudoInput(el, headings);
    if (e) entries.push(e);
  }
  for (const icon of Array.from(root.querySelectorAll(CHECK_ICON))) {
    // MUI Radio/Checkbox 안의 아이콘은 진짜 input이 따로 있다
    if (icon.closest('[class*="Radio-root"], [class*="Checkbox-root"]') || (icon.parentElement && hidden(icon.parentElement))) continue;
    const e = describeIconCheck(icon, headings);
    if (e && !entries.some((x) => x.anchor === e.anchor)) entries.push(e);
  }
  entries.sort((a, b) => (a.anchor === b.anchor ? 0 : precedes(a.anchor, b.anchor) ? -1 : 1));
  refineSharedLabels(entries);

  for (const e of entries) {
    const { key, copied } = assignKey(e.els, 'f', used);
    e.field.key = key;
    if (copied) delete e.field.filledByAgent;
    for (const el of e.els) {
      el.dataset.clfKind = e.field.kind;
      el.dataset.clfManual = e.field.manual ?? '';
      el.dataset.clfLabel = e.field.label;
    }
  }
  annotateRepeats(entries);
  for (const e of entries) if (e.field.kind === 'listbox') await probeOptions(e, opts.probeOptions !== false);
  annotateDialPairs(entries);

  const buttons = scanButtons(root, headings, used);
  const result: PageScan = {
    url: location.href,
    title: document.title,
    fields: entries.map((e) => e.field),
    buttons,
  };
  const cards = modal ? [] : scanCards(root);
  if (cards.length) result.cards = cards;
  if (modal) {
    const title = clean(textOf(modal.querySelector('h1, h2, h3, [class*="DialogTitle"]'), 60));
    result.modal = { title, text: textOf(modal, 200), editing: entries.length > 0 };
  }
  return result;
}
