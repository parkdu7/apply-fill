// Driver: 에이전트 툴과 실행 환경 사이의 경계.
// DomDriver는 환경 무관 로직(스캔 캐시, 일괄 입력·검증, 반복 행 추가)이고, 실제 브라우저 조작은 BrowserHost가 한다.
//   - PlaywrightDriver: Playwright(pw-host.ts) — 테스트·디버깅·오프라인 회귀 테스트
//   - ExtensionDriver(ext-driver.ts): 크롬 확장 — 실사용
// 실제 DOM 작업은 dom 번들(src/dom → window.__clf)을 각 프레임에서 호출해서 한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AdapterStore, SiteAdapter } from './adapters.js';
import type { BrowserManager } from './browser.js';
import type { VaultFile } from './bridge.js';
import { DIRECT_OPTION } from './dom/listbox.js';
import { BLOCKED_BUTTON } from './dom/safety.js';
import { labelSynonyms, sameValue } from './dom/synonyms.js';
import type { ActionButton, ButtonInfo, Field, FieldKind, FieldState, FillOutcome, FillRequest, ModalState, PageScan } from './dom/types.js';
import { fileForLabel, pickFile, type FileSource } from './files.js';
import type { LoginDetect } from './dom/login.js';
import type { PostcodeState } from './dom/postcode.js';
import { PlaywrightHost } from './pw-host.js';
import { sel, type BrowserHost, type DialogRecord, type FrameRef, type PageRef } from './transport.js';

export type FillMethod = 'auto' | 'dom' | 'keyboard';

export interface DriverFillRequest extends FillRequest {
  method?: FillMethod;
}

export interface ScanResult extends PageScan {
  frames: number;
  /** changed_only: 지난 스캔과 같아서 뺀 칸·버튼 수 */
  omitted?: { fields: number; buttons: number };
  /** 이 사이트(ATS)에서 배워 둔 것 */
  adapter?: SiteAdapter;
  /** 업로드 칸이 있을 때: 파일 보관함 목록 (내용 없이) */
  files?: VaultFile[];
  /** 외부 연동 버튼 (YBM·OPIc 성적 조회 등) */
  external?: ExternalHint[];
  /** 로그인 화면이거나 CAPTCHA·2단계 인증·본인인증 화면일 때 */
  login?: LoginDetect;
}

export interface AddressResult {
  ok: boolean;
  /** 고른 주소 줄 */
  picked?: string;
  /** 결과가 여러 개라 고르지 않았을 때 목록 (pick으로 다시 부른다) */
  results?: string[];
  message?: string;
  newFields: Field[];
  changedFields: ChangedField[];
  dialogs: DialogRecord[];
}

/** 외부 연동으로만 넣는 항목 (YBM 토익 성적 불러오기, OPIc 성적 인증 등): 자동으로 하지 않고 사용자에게 안내한다 */
export interface ExternalHint {
  name: string;
  /** 사용자가 누를 버튼 키 */
  button?: string;
  /** 결과가 들어올 칸 (wait_for_user keys로 지켜보고, 들어오면 프로필과 비교) */
  watch: string[];
}

export interface AttachItemResult {
  key: string;
  label?: string;
  file?: string;
  ok: boolean;
  shown?: string;
  message?: string;
}

/** 이미 있던 칸인데 값이 바뀐 것 (버튼 클릭이 다른 칸을 다시 계산하는 사이트) */
export interface ChangedField {
  field: Field;
  from: string;
}

/** 뒤 칸을 넣자 사이트가 앞 칸을 비운 기록 (국내/국외 토글 → 학교명·학점 초기화) */
export interface ResetInfo {
  by: string;
  cleared: string[];
}

export interface FillResult {
  outcomes: FillOutcome[];
  dialogs: DialogRecord[];
  /** 입력하고 나서 새로 나타난 칸 (졸업구분을 고르면 졸업일 칸이 생기는 식) */
  newFields: Field[];
  /** 입력하지 않은 칸인데 값이 바뀐 것 (사이트가 자동으로 채우거나 다시 계산) */
  changedFields: ChangedField[];
  /** 팝업이 닫혀서 중간에 멈춘 경우 */
  stopped?: string;
  /** then_click 결과 */
  clicked?: { text: string; closedModal: boolean; error?: string };
  resets?: ResetInfo[];
}

export interface ClickResult {
  ok: boolean;
  message?: string;
  text?: string;
  clicks?: number;
  newFields: Field[];
  newButtons: ActionButton[];
  /** 누른 뒤 값이 바뀐 기존 칸 ("18 개월"을 누르자 제대일이 다시 계산되는 식) */
  changedFields: ChangedField[];
  dialogs: DialogRecord[];
  url?: string;
  switchedTab?: boolean;
  modal?: PageScan['modal'];
}

export interface NavResult {
  ok: boolean;
  message?: string;
  text?: string;
  fromUrl: string;
  url: string;
  title: string;
  navigated: boolean;
  switchedTab: boolean;
  dialogs: DialogRecord[];
}

/** add_rows의 한 행: 라벨 → 값 (자동완성은 {value, query, direct}). "_ref"는 프로필 항목 경로(파일 보관함 연결용) */
export type RowValue = string | { value: string; query?: string; direct?: boolean; confidence?: 'high' | 'low' };
export type RowSpec = Record<string, RowValue>;

export interface RowResult {
  index: number;
  saved: boolean;
  /** 팝업 없이 페이지 안에 펼쳐진 줄에 채웠음 (행 저장 버튼 없음) */
  inline?: boolean;
  outcomes: FillOutcome[];
  unmatched: string[];
  message?: string;
  /** 저장은 됐지만 보낸 값이 안 들어간 칸 ("고용형태 (비활성)") */
  partial?: string[];
  resets?: ResetInfo[];
  /** 행 팝업에서 보관함 파일을 자동으로 첨부한 것 */
  attached?: string[];
}

export interface AddRowsResult {
  requested: number;
  rows: RowResult[];
  /** 멈춘 이유. 팝업을 열어 둔 채 멈췄으면 openFields/saveKey로 이어서 고칠 수 있다 */
  stopped?: string;
  openFields?: Field[];
  saveKey?: string;
  /** openFields가 팝업이 아니라 페이지 안에 펼쳐진 줄의 칸 */
  inline?: boolean;
  notices: string[];
  dialogs: DialogRecord[];
  savedRows?: { title: string; rows: string[] };
  /** 추가 버튼이 반응하지 않거나 "최대 N개" 안내가 떠서 알아낸 최대 행 수 */
  maxRows?: number;
  /** 최대 개수 때문에 넣지 못한 행 번호 (1부터) */
  skippedRows?: number[];
}

export interface WaitResult {
  /** 무엇이 바뀌어서 재개했는지 */
  changes: string[];
  timedOut: boolean;
  waitedSec: number;
  newFields: Field[];
  changedFields: ChangedField[];
  modal?: PageScan['modal'];
  dialogs: DialogRecord[];
}

export interface Driver {
  scan(opts?: { changedOnly?: boolean }): Promise<ScanResult>;
  fill(reqs: DriverFillRequest[], thenClick?: string): Promise<FillResult>;
  click(key: string, times?: number): Promise<ClickResult>;
  addRows(addKey: string, rows: RowSpec[]): Promise<AddRowsResult>;
  nextStep(key?: string): Promise<NavResult>;
  waitForUser(opts: { reason: string; keys?: string[]; timeoutSec?: number }): Promise<WaitResult>;
  /** 주소 검색 팝업(다음 우편번호)으로 주소 넣기. open: 팝업을 여는 버튼 키(이미 열려 있으면 생략) */
  searchAddress(opts: { query: string; pick?: string; open?: string }): Promise<AddressResult>;
  /** 보관함 파일을 업로드 칸에 첨부. file은 보관함 id·종류·이름 */
  attach(items: { key: string; file: string }[]): Promise<{ results: AttachItemResult[]; files: VaultFile[] }>;
  snapshot(dir: string): Promise<string[]>;
}

const KEYBOARD_KINDS = new Set<FieldKind>(['text', 'textarea', 'number', 'email', 'tel', 'date', 'month', 'listbox', 'combobox']);
/** 저장을 막지 않는 결과: 성공, 거부(수동·잠긴 칸), 건너뜀(사이트가 이미 채운 값 유지), 사이트 자동 채움 */
const ACCEPTABLE = new Set<FillOutcome['status']>(['ok', 'refused', 'skipped', 'auto']);
/** 값 자체가 틀린 경우: 키보드로 다시 넣어도 소용없다 */
/** 진짜 입력으로 다시 해도 소용없는 실패 ("선택지에 없음"은 흉내 입력이 검색을 못 일으킨 것일 수 있어서 다시 한다) */
const TRUSTED_NO_RETRY = /^(후보가 여러 개|글자 수 초과|사이트 글자 수|".*" 버튼이 비활성|달력|날짜를 읽지|국가번호)/;
const NO_RETRY = /^(선택지에 없음|후보가 여러 개|검색 결과가 없음|글자 수 초과|사이트 글자 수|".*" 버튼이 비활성|달력|날짜를 읽지|국가번호)/;
/** 같은 행의 다른 값 중 자동완성 후보를 고르는 단서로 쓸 만한 것 (소재지·캠퍼스 등 짧은 글자) */
const PREFER_VALUE = /^[^\d]{2,12}$/;
/** 잠긴 칸이 사이트에 의해 채워지거나 풀릴 때까지 기다리는 시간 */
const LOCK_WAIT = 1200;

const sq = (s: string) => s.replace(/\s+/g, '').toLowerCase();

function joinMsg(...parts: (string | undefined)[]): string | undefined {
  const s = parts.filter(Boolean).join(' / ');
  return s || undefined;
}

/**
 * 행 라벨 → 팝업의 칸. 사이트 어댑터 매핑 → 정확히 같음 → 포함 → 동의어. 여러 칸이 맞으면 매칭하지 않는다.
 * aliases: 어댑터가 배운 이 섹션의 매핑 (프로필 키 → 팝업 라벨)
 */
export function matchLabel(label: string, fields: Field[], aliases?: Record<string, string>): Field | undefined {
  const mapped = aliases?.[label];
  if (mapped) {
    const hit = fields.filter((f) => sq(f.label) === sq(mapped));
    if (hit.length === 1) return hit[0];
  }
  const w = sq(label);
  const exact = fields.filter((f) => sq(f.label) === w);
  if (exact.length === 1) return exact[0];
  const group = labelSynonyms(label);
  // 동의어가 라벨과 정확히 같은 칸을 포함 비교보다 먼저 본다 ("학점 만점"이 "학점" 칸에 붙지 않게 → "기준 학점")
  const exactSyn = fields.filter((f) => group.some((s) => sq(s) === sq(f.label)));
  if (exactSyn.length === 1) return exactSyn[0];
  const contains = fields.filter((f) => sq(f.label).includes(w) || (sq(f.label).length >= 2 && w.includes(sq(f.label))));
  if (contains.length === 1) return contains[0];
  // "졸업"처럼 짧은 말은 "졸업 구분"에도 들어 있어서 동의어 포함 비교는 3자 이상만
  const looseSyn = fields.filter((f) => group.some((s) => sq(s).length >= 3 && sq(f.label).includes(sq(s))));
  if (looseSyn.length === 1) return looseSyn[0];
  return undefined;
}

/** 어댑터의 "채우면 안 되는 칸" 규칙에 걸리는지 */
function adapterManual(f: Field, a: SiteAdapter): boolean {
  return !!a.manual?.some((m) => sq(m.label) === sq(f.label) && (!m.section || (f.section ?? '').includes(m.section)));
}

/** 어댑터로 스캔 결과 고치기: 채우면 안 되는 칸 표시, 버튼 분류 */
function applyAdapter(r: ScanResult, a: SiteAdapter): void {
  for (const f of r.fields) {
    const m = a.manual?.find((x) => sq(x.label) === sq(f.label) && (!x.section || (f.section ?? '').includes(x.section)));
    if (m && !f.manual) f.manual = m.reason;
  }
  for (const b of r.buttons) {
    const k = a.buttonKinds?.[b.text];
    if (k && b.kind !== 'blocked') b.kind = k;
  }
}

/** 위 칸(토글·라디오: 국내/국외, 구분)을 먼저: 누르면 뒤 칸을 비우거나 새로 그리는 사이트가 많다 */
function upperFirst(kind: FieldKind | undefined): number {
  return kind === 'toggle' || kind === 'radio' ? 0 : 1;
}

interface LastScan {
  page: PageRef;
  scan: ScanResult;
  keys: Set<string>;
  buttonKeys: Set<string>;
}

interface Located {
  frame: FrameRef;
  local: string;
}

export class DomDriver implements Driver {
  private last?: LastScan;
  /** changed_only 비교 기준: 마지막 extract_fields 결과 (fill/click 안의 스캔은 기준을 바꾸지 않는다) */
  private lastExtract?: { page: PageRef; scan: ScanResult };

  constructor(
    protected readonly host: BrowserHost,
    protected readonly adapters?: AdapterStore,
    protected readonly files?: FileSource,
  ) {}

  // ---------- 프레임과 키 ----------

  private prefix(f: FrameRef): string {
    return f.id === 0 ? '' : `${f.id}:`;
  }

  /** "3:f12" → (프레임 3, f12) / "f12" → (메인 프레임, f12) */
  private resolve(page: PageRef, key: string): Located | null {
    const m = /^(\d+):(.+)$/.exec(key);
    if (!m) return { frame: page.main(), local: key };
    const f = page.frameById(Number(m[1]));
    if (!f || f.detached()) return null;
    return { frame: f, local: m[2] };
  }

  private modalState(page: PageRef): Promise<ModalState> {
    return page
      .main()
      .call<ModalState>('modalState')
      .catch(() => ({ open: false, title: '' }));
  }

  private async waitModal(page: PageRef, open: boolean, timeout: number): Promise<ModalState> {
    const end = Date.now() + timeout;
    let m = await this.modalState(page);
    while (m.open !== open && Date.now() < end) {
      await page.wait(120);
      m = await this.modalState(page);
    }
    return m;
  }

  private adapterFor(url: string): SiteAdapter | undefined {
    return this.adapters?.lookup(url);
  }

  // ---------- 스캔 ----------

  private async scanPage(page: PageRef, probeOptions = true): Promise<ScanResult> {
    const frames = await page.frames();
    const result: ScanResult = { url: page.url(), title: await page.title(), fields: [], buttons: [], frames: frames.length };
    for (const f of frames) {
      let s: PageScan;
      try {
        s = await f.call<PageScan>('scan', { probeOptions });
      } catch (e) {
        if (f.id === 0) throw e;
        continue; // 접근 안 되는 iframe은 건너뜀
      }
      const pre = this.prefix(f);
      result.fields.push(...s.fields.map((x) => ({ ...x, key: pre + x.key })));
      result.buttons.push(...s.buttons.map((x) => ({ ...x, key: pre + x.key })));
      if (s.modal && !result.modal) result.modal = s.modal;
      if (s.cards?.length) {
        result.cards = [
          ...(result.cards ?? []),
          ...s.cards.map((c) => ({
            ...c,
            addKey: c.addKey && pre + c.addKey,
            rows: c.rows.map((r) => ({ ...r, editKey: r.editKey && pre + r.editKey })),
          })),
        ];
      }
    }
    const prev = this.last?.page === page ? this.last : undefined;
    this.last = {
      page,
      scan: result,
      keys: new Set([...(prev?.keys ?? []), ...result.fields.map((f) => f.key)]),
      buttonKeys: new Set([...(prev?.buttonKeys ?? []), ...result.buttons.map((b) => b.key)]),
    };
    return result;
  }

  async scan(opts: { changedOnly?: boolean } = {}): Promise<ScanResult> {
    return this.host.agent(async () => {
      const page = await this.host.page();
      if (this.last?.page !== page) this.last = undefined;
      const prev = this.lastExtract?.page === page ? this.lastExtract.scan : undefined;
      const r = await this.scanPage(page);
      this.lastExtract = { page, scan: r };
      // 이번 스캔 기준으로 새 칸을 판단하도록 키 목록을 덮어쓴다
      this.last = { page, scan: r, keys: new Set(r.fields.map((f) => f.key)), buttonKeys: new Set(r.buttons.map((b) => b.key)) };
      const adapter = this.adapterFor(r.url);
      if (adapter) {
        applyAdapter(r, adapter);
        r.adapter = adapter;
      }
      if (this.files && r.fields.some((f) => f.manual === 'file')) r.files = await this.files.list().catch(() => undefined);
      const login = await this.loginState(page);
      if (login) r.login = login;
      const external = externalHints(r);
      if (external.length) {
        r.external = external;
        for (const e of external) {
          const section = r.buttons.find((b) => b.key === e.button)?.section;
          if (section) this.adapters?.learnExternal(r.url, section, e.name, e.button ? 'button' : 'field');
        }
        this.adapters?.flush();
      }
      if (!opts.changedOnly || !prev || prev.url !== r.url) return r;
      // 바뀐 것만: 새 칸·값이 바뀐 칸·새 버튼 (사용량 절약)
      const prevFields = new Map(prev.fields.map((f) => [f.key, JSON.stringify(f)]));
      const prevButtons = new Set(prev.buttons.map((b) => JSON.stringify(b)));
      const fields = r.fields.filter((f) => prevFields.get(f.key) !== JSON.stringify(f));
      const buttons = r.buttons.filter((b) => !prevButtons.has(JSON.stringify(b)));
      return { ...r, fields, buttons, omitted: { fields: r.fields.length - fields.length, buttons: r.buttons.length - buttons.length } };
    });
  }

  private async knownKeys(page: PageRef): Promise<LastScan> {
    if (this.last?.page === page) return this.last;
    await this.scanPage(page);
    return this.last!;
  }

  private async diffAfter(
    page: PageRef,
    before: LastScan,
    probe: boolean,
  ): Promise<{ fields: Field[]; buttons: ActionButton[]; changed: ChangedField[]; scan: ScanResult }> {
    const oldFields = new Set(before.keys);
    const oldButtons = new Set(before.buttonKeys);
    const oldValues = new Map(before.scan.fields.map((f) => [f.key, f.value ?? '']));
    const after = await this.scanPage(page, probe);
    return {
      fields: after.fields.filter((f) => !oldFields.has(f.key)),
      buttons: after.buttons.filter((b) => !oldButtons.has(b.key)),
      // 사이트가 형식만 바꾼 값(010-1234-5678 → 01012345678)은 바뀐 것으로 보지 않는다
      changed: after.fields
        .filter((f) => oldValues.has(f.key) && !sameValue(oldValues.get(f.key)!, f.value ?? ''))
        .map((f) => ({ field: f, from: oldValues.get(f.key)! })),
      scan: after,
    };
  }

  // ---------- 입력 ----------

  /**
   * 칸들을 순서대로 넣는다. 편집 팝업이 열린 채 시작했는데 중간에 닫히면 바로 멈춘다.
   * 넣을 때마다 앞에서 넣은 칸이 그대로인지 다시 보고(토글이 다른 칸을 비우는 사이트), 비워진 칸은 끝에 다시 넣는다.
   * 잠겨 있던 칸은 끝에 다시 본다: 풀렸으면 넣고, 사이트가 채웠으면 "자동 채움"으로 둔다.
   */
  private async fillMany(page: PageRef, reqs: DriverFillRequest[]): Promise<{ outcomes: FillOutcome[]; stopped?: string; resets: ResetInfo[] }> {
    const outcomes: FillOutcome[] = [];
    const resets: ResetInfo[] = [];
    const modalAtStart = await this.modalState(page);
    const locs: (Located | null)[] = reqs.map((r) => this.resolve(page, r.key));
    /** 지금까지 성공한 칸 (뒤 칸이 비우는지 볼 대상) */
    const done = new Map<number, { wanted: string; expected?: string }>();
    const redo = new Map<number, string>();

    const checkResets = async (i: number, by: string) => {
      const loc = locs[i]!;
      const prior = [...done.entries()].filter(([j]) => j !== i && locs[j]?.frame === loc.frame);
      if (!prior.length) return;
      const states = await loc.frame
        .call<FieldState[]>(
          'verify',
          prior.map(([j, d]) => ({ key: locs[j]!.local, wanted: d.wanted, expected: d.expected })),
        )
        .catch(() => [] as FieldState[]);
      const lost = prior.filter((_, n) => states[n] && states[n].exists && !states[n].ok);
      if (!lost.length) return;
      resets.push({ by, cleared: lost.map(([j]) => outcomes[j]?.label ?? reqs[j].key) });
      for (const [j] of lost) {
        done.delete(j);
        redo.set(j, by);
      }
    };

    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      const loc = locs[i];
      if (!loc) {
        outcomes.push({ key: r.key, status: 'not_found', message: '프레임이 바뀌었어요 — extract_fields를 다시 호출하세요' });
        continue;
      }
      const out = { ...(await this.fillOne(loc, r)), key: r.key };
      outcomes.push(out);
      if (modalAtStart.open && !(await this.modalState(page)).open) {
        const stopped = `편집 팝업("${modalAtStart.title}")이 "${out.label ?? r.key}" 입력 뒤에 닫혀서 멈췄어요. 저장 안 한 값은 사라졌을 수 있어요.`;
        for (const rest of reqs.slice(i + 1)) outcomes.push({ key: rest.key, status: 'error', message: '팝업이 닫혀서 입력하지 않음' });
        return { outcomes, stopped, resets };
      }
      if (out.status !== 'refused' && out.status !== 'not_found') await checkResets(i, out.label ?? r.key);
      if (out.status === 'ok') done.set(i, { wanted: r.value, expected: out.actual && out.actual.length < 80 ? out.actual : undefined });
    }

    // 2차: 비워진 칸 다시 넣기, 잠겼던 칸 다시 보기
    const lockedIdx = outcomes.map((o, i) => (o.locked ? i : -1)).filter((i) => i >= 0);
    if (lockedIdx.length) await this.awaitLocks(page, lockedIdx.map((i) => locs[i]!));
    for (let i = 0; i < reqs.length; i++) {
      const loc = locs[i];
      if (!loc) continue;
      if (redo.has(i)) {
        const again = { ...(await this.fillOne(loc, reqs[i])), key: reqs[i].key };
        outcomes[i] = { ...again, message: joinMsg(again.message, `"${redo.get(i)}" 입력 뒤 비워져서 다시 넣음`) };
        continue;
      }
      if (!outcomes[i].locked) continue;
      const [st] = await loc.frame.call<FieldState[]>('fieldStates', [loc.local]).catch(() => [] as FieldState[]);
      if (!st?.exists) continue;
      if (!st.disabled && !st.value) {
        // 앞 칸을 고르면서 풀린 칸 (재직 상태 → 퇴직사유)
        const again = { ...(await this.fillOne(loc, reqs[i])), key: reqs[i].key };
        outcomes[i] = { ...again, message: joinMsg(again.message, '앞 칸을 넣은 뒤 풀려서 넣음') };
      } else if (st.value) {
        const same = sameValue(st.value, reqs[i].value) || sq(st.value).includes(sq(reqs[i].value));
        outcomes[i] = {
          ...outcomes[i],
          status: 'auto',
          actual: st.value,
          locked: undefined,
          message: same ? '사이트가 자동으로 채움' : `사이트가 자동으로 채움 — 보낸 값 "${reqs[i].value}"와 달라요 (확인 필요)`,
        };
      } else {
        outcomes[i] = { ...outcomes[i], message: joinMsg(outcomes[i].message, '자동 채움 대기: 앞 칸을 고르면 사이트가 채우는 칸일 수 있어요') };
      }
    }
    return { outcomes, resets };
  }

  /** 잠긴 칸들이 풀리거나 채워질 때까지 잠깐 기다린다 (사이트가 앞 칸 선택 뒤 비동기로 채운다) */
  private async awaitLocks(page: PageRef, locs: Located[]): Promise<void> {
    const end = Date.now() + LOCK_WAIT;
    for (;;) {
      let pending = 0;
      for (const l of locs) {
        const [st] = await l.frame.call<FieldState[]>('fieldStates', [l.local]).catch(() => [] as FieldState[]);
        if (st?.exists && st.disabled && !st.value) pending++;
      }
      if (!pending || Date.now() > end) return;
      await page.wait(150);
    }
  }

  private applyAdapterValues(page: PageRef, reqs: DriverFillRequest[]): DriverFillRequest[] {
    const values = this.adapterFor(page.url())?.values;
    if (!values) return reqs;
    return reqs.map((r) => (values[r.value] ? { ...r, value: values[r.value] } : r));
  }

  async fill(reqs: DriverFillRequest[], thenClick?: string): Promise<FillResult> {
    return this.host.agent(async () => {
      const started = Date.now();
      const page = await this.host.page();
      const before = await this.knownKeys(page);
      // 어댑터가 "채우면 안 되는 칸"으로 표시한 것(자소서로 못 알아본 칸 등)은 페이지에 보내기 전에 막는다
      const adapter = this.adapterFor(page.url());
      const manual = new Map(
        (adapter ? before.scan.fields.filter((f) => adapterManual(f, adapter)) : []).map((f) => [f.key, f] as const),
      );
      const allowed = reqs.filter((r) => !manual.has(r.key));
      // 초기화 기록은 편집 팝업 제목(=섹션) 기준으로 남긴다 (저장하면 팝업이 닫히니 미리 읽어 둔다)
      const popup = (await this.modalState(page)).title || before.scan.modal?.title;
      const filled = await this.fillMany(page, this.applyAdapterValues(page, allowed));
      const { stopped, resets } = filled;
      const outcomes = reqs.map(
        (r) =>
          filled.outcomes.find((o) => o.key === r.key) ?? {
            key: r.key,
            status: 'refused' as const,
            label: manual.get(r.key)?.label,
            message: '이 사이트에서는 직접 쓰는 칸이에요 (어댑터: 자기소개서 등)',
          },
      );
      let clicked: FillResult['clicked'];
      if (thenClick && !stopped) {
        const bad = outcomes.filter((o) => !ACCEPTABLE.has(o.status));
        if (bad.length) clicked = { text: '', closedModal: false, error: `불일치/실패 ${bad.length}칸이 있어 누르지 않았어요` };
        else clicked = await this.clickAndAwaitClose(page, thenClick);
      }
      const { fields, changed } = await this.diffAfter(page, before, false);
      const asked = new Set(reqs.map((r) => r.key));
      const changedFields = changed.filter((c) => !asked.has(c.field.key));
      if (resets.length) this.learnResets(page.url(), popup, resets);
      return {
        outcomes,
        dialogs: await this.host.dialogsSince(started),
        newFields: fields,
        changedFields,
        stopped,
        clicked,
        ...(resets.length ? { resets } : {}),
      };
    });
  }

  /** 버튼(보통 팝업의 "저장하기")을 누르고, 팝업이 열려 있었으면 닫힐 때까지 기다린다 */
  private async clickAndAwaitClose(page: PageRef, key: string): Promise<NonNullable<FillResult['clicked']>> {
    const modalBefore = await this.modalState(page);
    const r = await this.safeClick(page, key);
    if (!r.ok) return { text: '', closedModal: false, error: r.message };
    if (!modalBefore.open) {
      await page.settle(page.url());
      return { text: r.info.text, closedModal: false };
    }
    const after = await this.waitModal(page, false, 3000);
    if (!after.open) return { text: r.info.text, closedModal: true };
    // 저장이 안 되고 팝업이 그대로면, 팝업 안의 오류 문구만 돌려준다
    const errors = after.errors?.length ? after.errors.join(' / ') : '사이트가 저장을 막았을 수 있어요 (필수 칸·필수 첨부 파일 확인)';
    return { text: r.info.text, closedModal: false, error: `팝업이 닫히지 않았어요 — ${errors}`.slice(0, 300) };
  }

  private async fillOne(loc: Located, r: DriverFillRequest): Promise<FillOutcome> {
    const req: FillRequest = {
      key: loc.local,
      value: String(r.value),
      confidence: r.confidence,
      overwrite: r.overwrite,
      query: r.query,
      direct: r.direct,
      prefer: r.prefer,
    };
    if (r.method === 'keyboard') return this.trustedRetry(loc.frame, req, await this.keyboardFill(loc.frame, req));
    // 검색형 칸은 실제 키 입력에만 검색하는 사이트가 많아서 처음부터 키보드로 친다
    if (r.method !== 'dom') {
      const kind = await loc.frame.attr(sel.key(req.key), 'data-clf-kind');
      if (kind === 'combobox') return this.trustedRetry(loc.frame, req, await this.keyboardFill(loc.frame, req));
    }
    const [out] = await loc.frame.call<FillOutcome[]>('fill', [req]);
    const retryable = r.method !== 'dom' && out.status === 'mismatch' && out.kind && KEYBOARD_KINDS.has(out.kind) && !NO_RETRY.test(out.message ?? '');
    if (!retryable) return out;
    const retry = await this.trustedRetry(loc.frame, req, await this.keyboardFill(loc.frame, req));
    if (retry.status === 'ok') return { ...retry, message: joinMsg(retry.message, '키보드 입력으로 다시 넣어 반영됨') };
    return { ...out, message: joinMsg(out.message, `키보드 재시도도 실패 (실제 값 "${retry.actual ?? ''}")`) };
  }

  /**
   * 키보드 입력이 흉내(확장의 content script)라 실패했으면, 진짜 입력(확장: chrome.debugger)으로 한 번 더.
   * 실제 키 입력(isTrusted)에만 반응하는 검색 칸용. Playwright는 처음부터 진짜 입력이라 withTrusted가 없다.
   */
  private async trustedRetry(frame: FrameRef, req: FillRequest, out: FillOutcome): Promise<FillOutcome> {
    if (out.status !== 'mismatch' || !this.host.withTrusted || TRUSTED_NO_RETRY.test(out.message ?? '')) return out;
    // 앞 시도(흉내 입력)가 친 글자는 지우고 다시 친다. 원래 값이 있던 칸은 precheck에서 이미 거부돼 여기까지 오지 않는다
    if (out.kind !== 'listbox') await frame.fill(sel.key(req.key), '').catch(() => {});
    const again = await this.host.withTrusted(() => this.keyboardFill(frame, req)).catch((e: unknown) => ({
      ...out,
      message: joinMsg(out.message, `진짜 입력 재시도 실패: ${e instanceof Error ? e.message.split('\n')[0] : e}`),
    }));
    return again.status === 'ok' ? { ...again, message: joinMsg(again.message, '실제 키 입력으로 다시 넣어 반영됨') } : again;
  }

  /** 실제 키보드/마우스 입력. DOM 이벤트로 안 먹는 마스크 입력, 커스텀 드롭다운용 */
  private async keyboardFill(frame: FrameRef, req: FillRequest): Promise<FillOutcome> {
    // 수동 칸/민감정보/덮어쓰기 규칙은 DOM 쪽 판단(칸 라벨까지 보는)을 그대로 따른다
    const blocked = await frame.call<FillOutcome | null>('precheck', req);
    if (blocked) return blocked;
    const target = sel.key(req.key);
    const kind = (await frame.attr(target, 'data-clf-kind')) as FieldKind | null;
    if (!kind) return { key: req.key, status: 'not_found', message: '칸을 찾지 못함 — extract_fields를 다시 호출하세요' };
    // 라디오/체크박스/토글/네이티브 select는 DOM 방식이 가장 정확하다
    if (!KEYBOARD_KINDS.has(kind)) return (await frame.call<FillOutcome[]>('fill', [req]))[0];
    const conf = req.confidence ?? 'high';
    try {
      if (kind === 'listbox' || kind === 'combobox') {
        const out = await this.pickWithMouse(frame, req, conf, kind === 'combobox');
        return out.label ? out : { ...out, label: (await frame.attr(target, 'data-clf-label')) ?? undefined };
      }
      await frame.fill(target, req.value);
      let out = await frame.call<FillOutcome>('inspect', req.key, req.value, conf);
      // 날짜 칸(MUI X)은 한 글자씩 치면 오히려 비는 경우가 있어서 fill까지만 한다
      if (out.status === 'ok' || kind === 'date' || kind === 'month') return out;
      await frame.click(target);
      await frame.press(target, 'selectAll');
      await frame.press(target, 'backspace');
      await frame.type(target, req.value, 30);
      await frame.press(target, 'tab');
      out = await frame.call<FillOutcome>('inspect', req.key, req.value, conf);
      return out;
    } catch (e) {
      return { key: req.key, status: 'error', kind, message: `키보드 입력 실패: ${e instanceof Error ? e.message.split('\n')[0] : e}` };
    }
  }

  /**
   * 검색 결과가 바뀔 때까지 기다린다 (DB 검색이 늦게 오고, 그 전에는 이전 검색 결과가 남아 있다).
   * 바뀐 뒤에는 목록이 멈출 때까지 한 번 더 기다린다. "직접입력/등록하기"만 있는 동안은 결과가 아직 안 온 것으로 본다.
   */
  private async awaitResults(frame: FrameRef, key: string, beforeSig: string): Promise<void> {
    let last = '';
    let stable = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 120));
      const s = await frame.call<{ sig: string; count: number }>('listState', key);
      const real = s.sig.split('|').filter((t) => t && !DIRECT_OPTION.test(t));
      if (!s.count || s.sig === beforeSig || !real.length) continue;
      if (s.sig === last) {
        if (++stable >= 2) return;
      } else {
        last = s.sig;
        stable = 0;
      }
    }
  }

  private async pickWithMouse(frame: FrameRef, req: FillRequest, conf: 'high' | 'low', typeFirst: boolean): Promise<FillOutcome> {
    type Marked = { text?: string; options?: string[]; ambiguous?: boolean; searchable?: boolean; fail?: string; note?: string };
    const mark = () => frame.call<Marked>('markOption', req.key, req.value, req.direct ?? false, req.prefer);
    const target = sel.key(req.key);
    // 누르기 전 목록·비활성 의존 칸을 기억해 둔다 (검색형 칸만 의존 칸 풀림을 확정 신호로 쓴다)
    const armed = await frame.call<{ sig: string }>('armSearch', req.key, typeFirst);
    await frame.click(target);
    if (typeFirst) {
      await frame.fill(target, '');
      await frame.type(target, req.query ?? req.value, 40);
      await this.awaitResults(frame, req.key, armed.sig);
    } else {
      await new Promise((r) => setTimeout(r, 300));
    }
    let picked = await mark();
    // 목록 안에 검색 칸이 있는 드롭다운(국적 등): 보이는 앞쪽에 없으면 실제 키 입력으로 검색해서 다시 찾는다
    if (!picked.text && !picked.fail && picked.searchable) {
      const { sig } = await frame.call<{ sig: string }>('listState', req.key);
      await frame.type(sel.search, req.query ?? req.value, 40);
      await this.awaitResults(frame, req.key, sig);
      picked = await mark();
    }
    if (!picked.text) {
      await frame.call('dismiss', req.key);
      const list = (picked.options ?? []).slice(0, 30).join(', ');
      return {
        key: req.key,
        status: 'mismatch',
        kind: typeFirst ? 'combobox' : 'listbox',
        message:
          picked.fail ??
          (picked.ambiguous ? `후보가 여러 개: ${list} — 정확한 후보 글자로 다시 보내 주세요` : list ? `선택지에 없음 — 가능한 값: ${list}` : '목록이 열리지 않음'),
      };
    }
    await frame.click(sel.opt);
    const expected = DIRECT_OPTION.test(picked.text) ? (req.query ?? req.value) : picked.text;
    // 후보를 눌렀는지는 값만으로 모른다 (친 글자와 후보 글자가 같을 수 있다): 목록 닫힘·의존 칸 풀림까지 본다
    const out = await frame.call<FillOutcome>('confirmPick', req.key, req.value, conf, expected);
    return picked.note ? { ...out, message: joinMsg(out.message, picked.note) } : out;
  }

  // ---------- 버튼 ----------

  /** 누르기 직전에 버튼 글자를 다시 읽어 제출 계열이면 거부 (페이지 안 + Node 쪽 이중 확인) */
  private async safeClick(page: PageRef, key: string): Promise<{ ok: true; info: ButtonInfo } | { ok: false; message: string; disabled?: boolean }> {
    const loc = this.resolve(page, key);
    if (!loc) return { ok: false, message: '프레임이 바뀌었어요 — extract_fields를 다시 호출하세요' };
    const info = await loc.frame.call<ButtonInfo | null>('buttonInfo', loc.local);
    if (!info) return { ok: false, message: `버튼 ${key}를 찾지 못했어요 — extract_fields를 다시 호출하세요` };
    if (info.kind === 'blocked' || BLOCKED_BUTTON.test(info.text)) {
      return { ok: false, message: `"${info.text}"은(는) 제출·삭제 계열 버튼이라 누르지 않아요. 필요하면 직접 눌러 주세요.` };
    }
    if (info.disabled) return { ok: false, disabled: true, message: `"${info.text}" 버튼은 비활성이라 안 눌려요 (앞 항목을 먼저 골라야 할 수 있어요)` };
    try {
      await loc.frame.click(sel.key(loc.local), 8000);
    } catch {
      const ok = await loc.frame.call<boolean>('clickDom', loc.local);
      if (!ok) return { ok: false, message: `"${info.text}" 버튼을 누르지 못했어요` };
    }
    return { ok: true, info };
  }

  async click(key: string, times = 1): Promise<ClickResult> {
    return this.host.agent(async () => {
      const started = Date.now();
      const page = await this.host.page();
      const before = await this.knownKeys(page);
      let clicks = 0;
      let text = '';
      for (let i = 0; i < Math.min(Math.max(times, 1), 10); i++) {
        const r = await this.safeClick(page, key);
        if (!r.ok) {
          if (i === 0) return { ok: false, message: r.message, newFields: [], newButtons: [], changedFields: [], dialogs: await this.host.dialogsSince(started) };
          break;
        }
        text = r.info.text;
        clicks++;
        await page.settle(page.url());
        if (page.closed()) break;
      }
      const active = await this.host.page();
      if (active !== page) {
        return {
          ok: true,
          text,
          clicks,
          message: '새 탭/창이 열려서 그쪽으로 전환했어요 — extract_fields로 확인하세요',
          newFields: [],
          newButtons: [],
          changedFields: [],
          dialogs: await this.host.dialogsSince(started),
          url: active.url(),
          switchedTab: true,
        };
      }
      const diff = await this.diffAfter(page, before, true);
      return {
        ok: true,
        text,
        clicks,
        newFields: diff.fields,
        newButtons: diff.buttons,
        changedFields: diff.changed,
        dialogs: await this.host.dialogsSince(started),
        url: page.url(),
        modal: diff.scan.modal,
        message: await this.host.takeExternalTabs(),
      };
    });
  }

  /** 행 하나의 요청 목록: 라벨 → 칸, 어댑터 순서·위 칸 먼저·팝업 칸 순서로 정렬, 자동완성에는 같은 행의 다른 값을 단서로 */
  private rowRequests(
    row: RowSpec,
    fields: Field[],
    section: string | undefined,
    res: RowResult,
    page: PageRef,
    mapped: [string, string][] = [],
  ): DriverFillRequest[] {
    const sec = section ? this.adapterFor(page.url())?.sections?.[section] : undefined;
    const reqs: (DriverFillRequest & { kind?: FieldKind; label: string })[] = [];
    const hints = Object.entries(row)
      .filter(([k]) => !k.startsWith('_'))
      .map(([, v]) => (typeof v === 'string' ? v : v.value))
      .filter((v) => PREFER_VALUE.test(v));
    for (const [label, spec] of Object.entries(row)) {
      if (label.startsWith('_')) continue;
      const f = matchLabel(label, fields, sec?.labels);
      if (!f) {
        res.unmatched.push(label);
        continue;
      }
      const s = typeof spec === 'string' ? { value: spec } : spec;
      const value = this.adapterFor(page.url())?.values?.[s.value] ?? s.value;
      const prefer = f.kind === 'combobox' || f.kind === 'listbox' || f.kind === 'select' ? hints.filter((h) => h !== value) : undefined;
      reqs.push({ key: f.key, value, query: s.query, direct: s.direct, confidence: s.confidence, prefer, kind: f.kind, label: f.label });
      if (sq(label) !== sq(f.label)) mapped.push([label, f.label]);
    }
    const order = new Map(fields.map((f, idx) => [f.key, idx]));
    const learned = new Map((sec?.order ?? []).map((l, idx) => [sq(l), idx]));
    const rank = (r: { label: string; kind?: FieldKind; key: string }) => [
      learned.has(sq(r.label)) ? learned.get(sq(r.label))! : learned.size,
      upperFirst(r.kind),
      order.get(r.key) ?? 0,
    ];
    reqs.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });
    return reqs.map(({ kind: _k, label: _l, ...r }) => r);
  }

  /** 저장은 되지만 보낸 값이 안 들어간 칸 (부분 저장을 성공으로 보고하지 않게) */
  private partialOf(outcomes: FillOutcome[]): string[] {
    const why: Partial<Record<FillOutcome['status'], string>> = { refused: '거부·비활성', skipped: '기존 값 유지', auto: '사이트 값' };
    return outcomes
      .filter((o) => o.status === 'refused' || o.status === 'skipped' || (o.status === 'auto' && /달라요/.test(o.message ?? '')))
      .map((o) => `${o.label ?? o.key} (${why[o.status]}${o.actual ? `: "${o.actual}"` : ''})`);
  }

  /**
   * 반복 섹션에 행 여러 개 넣기: 행마다 추가 → 편집 팝업 → 라벨로 칸 찾기 → 입력 → 팝업의 저장하기 → 닫힘 확인.
   * 문제가 생기면 그 행에서 팝업을 열어 둔 채 멈추고, 팝업의 칸 목록을 돌려준다 (fill_fields + then_click으로 이어서 고친다).
   * 추가 버튼이 아무 반응이 없거나 비활성이면 최대 개수에 이른 것으로 본다.
   */
  async addRows(addKey: string, rows: RowSpec[]): Promise<AddRowsResult> {
    return this.host.agent(async () => {
      const started = Date.now();
      const page = await this.host.page();
      const out: AddRowsResult = { requested: rows.length, rows: [], notices: [], dialogs: [] };
      const initial = await this.knownKeys(page);
      const card = initial.scan.cards?.find((c) => c.addKey === addKey);
      const section = card?.title ?? initial.scan.buttons.find((b) => b.key === addKey)?.section;
      const finish = async () => {
        out.dialogs = await this.host.dialogsSince(started);
        const scan = await this.scanPage(page, false).catch(() => undefined);
        const c = scan?.cards?.find((x) => x.addKey === addKey);
        if (c) out.savedRows = { title: c.title, rows: c.rows.map((r) => r.text) };
        if (out.maxRows && section) this.adapters?.learnMaxRows(page.url(), section, out.maxRows);
        this.adapters?.flush();
        return out;
      };
      const savedCount = async () => {
        const s = await this.scanPage(page, false).catch(() => undefined);
        return s?.cards?.find((x) => x.addKey === addKey)?.rows.length;
      };
      const limitReached = async (i: number, why: string) => {
        const n = (await savedCount()) ?? (card?.rows.length ?? 0) + out.rows.filter((r) => r.saved).length;
        out.rows.pop();
        if (n > 0) out.maxRows = n;
        out.skippedRows = rows.map((_, j) => j + 1).slice(i);
        out.stopped = `${why} — 이 섹션은 최대 ${n}개로 보여요. ${i + 1}~${rows.length}행(${rows.length - i}개)은 넣지 않았어요. 뺄 항목을 사용자에게 알려 주세요.`;
      };
      if ((await this.modalState(page)).open) {
        out.stopped = '팝업이 이미 열려 있어요. 열린 팝업은 fill_fields(then_click)로 마무리하거나 닫은 뒤 다시 시도하세요.';
        return finish();
      }
      const maxRows = section ? this.adapterFor(page.url())?.sections?.[section]?.maxRows : undefined;
      for (let i = 0; i < rows.length; i++) {
        const res: RowResult = { index: i + 1, saved: false, outcomes: [], unmatched: [] };
        out.rows.push(res);
        if (maxRows !== undefined && (card?.rows.length ?? 0) + i >= maxRows) {
          await limitReached(i, `어댑터에 배운 최대 개수(${maxRows}개)에 이르렀어요`);
          break;
        }
        const known = await this.knownKeys(page);
        const c = await this.safeClick(page, addKey);
        if (!c.ok) {
          if (c.disabled) await limitReached(i, '추가 버튼이 비활성이에요');
          else out.stopped = c.message;
          break;
        }
        let m = await this.waitModal(page, true, 1500);
        if (!m.open) {
          // 팝업 없이 페이지 안에 줄이 펼쳐지는 사이트: 새로 생긴 칸을 이 행의 칸으로 보고 채운다 (행 저장 버튼은 없다)
          const added = (await this.diffAfter(page, known, false)).fields;
          if (added.length) {
            const stop = await this.fillInlineRow(page, rows[i], added, res, section);
            if (stop) {
              out.stopped = `${i + 1}행: ${stop}`;
              out.openFields = (await this.scanPage(page, true)).fields.filter((f) => added.some((a) => a.key === f.key));
              out.inline = true;
              break;
            }
            continue;
          }
          m = await this.waitModal(page, true, 3500);
        }
        if (!m.open) {
          // 알림 없이 아무 반응이 없다: 이미 저장된 행이 있으면 최대 개수로 본다 (학내외활동 5개 이후)
          if (i > 0 || (card?.rows.length ?? 0) > 0) await limitReached(i, '추가 버튼을 눌러도 아무 반응이 없어요');
          else out.stopped = '추가 버튼을 눌렀는데 편집 팝업도, 새 입력 칸도 생기지 않았어요';
          break;
        }
        await page.wait(250); // 팝업 열림 애니메이션
        // 선택지는 입력할 때 어차피 열어 보니까 여기서는 읽지 않는다 (멈출 때만 선택지까지 읽어서 돌려준다)
        const dialog = await this.scanPage(page, false);
        const openFieldsWithOptions = async () => (await this.scanPage(page, true)).fields;
        if (!dialog.modal?.editing) {
          // 입력 칸 없는 안내창 (예: "최대 등록 가능한 개수는 5개 입니다")
          const text = dialog.modal?.text ?? '';
          out.notices.push(text);
          const ok = dialog.buttons.find((b) => b.kind === 'rowsave' || /^(확인|닫기)$/.test(b.text));
          if (ok) await this.clickAndAwaitClose(page, ok.key);
          const max = /최대[^\d]{0,12}(\d+)\s*(개|건|회)/.exec(text);
          if (max) {
            out.maxRows = Number(max[1]);
            out.skippedRows = rows.map((_, j) => j + 1).slice(i);
          }
          out.stopped = `안내창이 떠서 멈췄어요: ${text}`;
          res.message = '저장 안 됨';
          break;
        }
        if (section) this.adapters?.learnFields(page.url(), section, dialog.fields.map((f) => f.label));
        const mapped: [string, string][] = [];
        const reqs = this.rowRequests(rows[i], dialog.fields, section, res, page, mapped);
        const saveButton = dialog.buttons.filter((b) => b.kind === 'rowsave').sort((a, b) => Number(/저장/.test(b.text)) - Number(/저장/.test(a.text)))[0];
        const filled = await this.fillMany(page, reqs);
        res.outcomes = filled.outcomes;
        if (filled.resets.length) {
          res.resets = filled.resets;
          if (section) this.learnResets(page.url(), section, filled.resets);
        }
        if (filled.stopped) {
          out.stopped = `${i + 1}행: ${filled.stopped}`;
          break;
        }
        // 찾은 칸은 먼저 채워 두고, 못 찾은 라벨만 고치게 한다
        if (res.unmatched.length) {
          out.stopped = `${i + 1}행: 팝업에서 칸을 못 찾음 (${res.unmatched.join(', ')}). 찾은 칸은 채웠고 팝업은 열어 뒀어요.`;
          out.openFields = await openFieldsWithOptions();
          out.saveKey = saveButton?.key;
          break;
        }
        const attached = await this.autoAttach(page, rows[i], section);
        if (attached.length) res.attached = attached;
        const bad = filled.outcomes.filter((o) => !ACCEPTABLE.has(o.status));
        const now = await this.scanPage(page, false);
        const emptyRequired = now.fields.filter(
          (f) => f.required && (!f.manual || f.manual === 'file') && (f.value === undefined || f.value === '' || f.value === 'false'),
        );
        if (bad.length || emptyRequired.length) {
          out.stopped = `${i + 1}행: ${bad.length ? `불일치/실패 ${bad.length}칸` : ''}${bad.length && emptyRequired.length ? ', ' : ''}${
            emptyRequired.length
              ? `필수인데 빈 칸: ${emptyRequired.map((f) => (f.manual === 'file' ? `${f.label}(파일 첨부 — 보관함에 없으면 사용자가 직접)` : f.label)).join(', ')}`
              : ''
          }. 팝업은 열어 뒀어요.`;
          out.openFields = await openFieldsWithOptions();
          out.saveKey = saveButton?.key;
          break;
        }
        if (!saveButton) {
          out.stopped = `${i + 1}행: 팝업에서 저장 버튼을 못 찾았어요. 팝업은 열어 뒀어요.`;
          out.openFields = await openFieldsWithOptions();
          break;
        }
        const saved = await this.clickAndAwaitClose(page, saveButton.key);
        if (!saved.closedModal) {
          out.stopped = `${i + 1}행: 저장하기를 눌렀지만 ${saved.error ?? '팝업이 닫히지 않았어요'}`;
          out.openFields = await openFieldsWithOptions();
          out.saveKey = saveButton.key;
          break;
        }
        res.saved = true;
        // 저장까지 성공한 행의 라벨 매핑만 배운다
        for (const [from, to] of mapped) this.adapters?.learnLabel(page.url(), section, from, to);
        const partial = this.partialOf(res.outcomes);
        if (partial.length) res.partial = partial;
      }
      const ext = await this.host.takeExternalTabs();
      if (ext) out.notices.push(ext);
      return finish();
    });
  }

  /**
   * 행 팝업 안의 빈 업로드 칸에 보관함 파일을 붙인다.
   * 행에 파일 칸 라벨이 적혀 있으면 그 파일, 아니면 칸 라벨과 보관함 종류가 하나만 맞을 때만 (졸업증명서 칸 ↔ 졸업증명서).
   */
  protected async autoAttach(page: PageRef, row: RowSpec, section?: string): Promise<string[]> {
    if (!this.files) return [];
    const scan = await this.scanPage(page, false);
    const empty = scan.fields.filter((f) => f.manual === 'file' && !f.value);
    if (!empty.length) return [];
    const files = await this.files.list().catch(() => [] as VaultFile[]);
    if (!files.length) return [];
    const required = new Set(this.adapterFor(page.url())?.sections?.[section ?? '']?.requiredFiles ?? []);
    const out: string[] = [];
    for (const f of empty) {
      const asked = Object.entries(row).find(([k]) => sq(k) === sq(f.label))?.[1];
      const ref = typeof asked === 'string' ? asked : asked?.value;
      const file = ref ? pickFile(files, ref).file : f.required || required.has(f.label) ? fileForLabel(files, f.label) : undefined;
      if (!file) continue;
      const loc = this.resolve(page, f.key);
      if (!loc) continue;
      const r = await this.files.attach(loc.frame, loc.local, file.id).catch((e: unknown) => ({ ok: false, message: String(e) }));
      if (r.ok) out.push(`${f.label} ← ${file.name}`);
    }
    return out;
  }

  /** 로그인 폼이나 인증 화면이 있는 프레임 (없으면 undefined) */
  private async loginState(page: PageRef): Promise<LoginDetect | undefined> {
    let form: LoginDetect | undefined;
    for (const f of await page.frames().catch(() => [] as FrameRef[])) {
      const d = await f.call<LoginDetect>('detectLogin').catch(() => undefined);
      if (d?.challenge) return d;
      if (d?.form) form ??= d;
    }
    return form;
  }

  // ---------- 주소 검색 (다음 우편번호) ----------

  /** 지금 탭의 프레임과 팝업 창 중에서 우편번호 검색 화면인 프레임 */
  private async findPostcode(page: PageRef): Promise<{ frame: FrameRef; state: PostcodeState } | undefined> {
    // 팝업 창이 작업 탭으로 잡혔을 수도 있다 (같은 사이트로 열린 창)
    const pages = [...new Set([page, await this.host.page(), ...((await this.host.popups?.().catch(() => [])) ?? [])])];
    for (const p of pages) {
      if (p.closed()) continue;
      for (const f of await p.frames().catch(() => [] as FrameRef[])) {
        const state = await f.call<PostcodeState>('postcodeState').catch(() => undefined);
        if (state?.isPostcode) return { frame: f, state };
      }
    }
    return undefined;
  }

  async searchAddress(opts: { query: string; pick?: string; open?: string }): Promise<AddressResult> {
    return this.host.agent(async () => {
      const started = Date.now();
      const page = await this.host.page();
      const before = await this.knownKeys(page);
      const done = async (r: Omit<AddressResult, 'newFields' | 'changedFields' | 'dialogs'>): Promise<AddressResult> => {
        const diff = page.closed() ? undefined : await this.diffAfter(page, before, true).catch(() => undefined);
        return { ...r, newFields: diff?.fields ?? [], changedFields: diff?.changed ?? [], dialogs: await this.host.dialogsSince(started) };
      };
      let pc = await this.findPostcode(page);
      if (!pc && opts.open) {
        const r = await this.safeClick(page, opts.open);
        if (!r.ok) return done({ ok: false, message: r.message });
        for (let i = 0; i < 20 && !pc; i++) {
          await page.wait(300);
          pc = await this.findPostcode(page);
        }
      }
      if (!pc) return done({ ok: false, message: '주소 검색 화면을 찾지 못했어요. "우편번호 찾기" 버튼 키를 open으로 주거나, 사용자에게 직접 검색을 부탁하세요 (wait_for_user).' });
      // 결과가 없으면(또는 지난 검색 결과면) 검색부터
      const searchAndWait = async (frame: FrameRef): Promise<PostcodeState> => {
        await frame.call('postcodeSearch', opts.query);
        let st: PostcodeState = { isPostcode: true, results: [] };
        for (let i = 0; i < 20; i++) {
          await page.wait(250);
          st = (await frame.call<PostcodeState>('postcodeState').catch(() => undefined)) ?? st;
          if (st.results.length || st.notice) break;
        }
        return st;
      };
      let state = await searchAndWait(pc.frame);
      if (!state.results.length && this.host.withTrusted) {
        // 키 입력에만 반응하는 검색 칸: 진짜 입력으로 한 번 더 (확장)
        const frame = pc.frame;
        state = await this.host.withTrusted(async () => {
          await frame.click('#region_name, input[placeholder*="예)"]').catch(() => {});
          return searchAndWait(frame);
        });
      }
      if (!state.results.length) return done({ ok: false, message: `"${opts.query}" 검색 결과가 없어요${state.notice ? ` (${state.notice})` : ''}. 도로명+건물번호나 동 이름으로 다시 검색하세요.` });
      let index = 0;
      if (state.results.length > 1) {
        const want = sq(opts.pick ?? '');
        const hits = want ? state.results.map((t, i) => ({ t, i })).filter((x) => sq(x.t).includes(want)) : [];
        if (hits.length !== 1) {
          return done({
            ok: false,
            results: state.results.slice(0, 15),
            message: `결과가 ${state.results.length}개예요. 프로필 주소와 맞는 줄의 글자(우편번호나 건물명)를 pick으로 주고 다시 부르세요. 검색 팝업은 열어 뒀어요.`,
          });
        }
        index = hits[0].i;
      }
      const picked = await pc.frame.call<string>('postcodePick', index);
      // 고르면 팝업이 닫히고 사이트가 우편번호·주소 칸을 채운다
      for (let i = 0; i < 12; i++) {
        await page.wait(250);
        if (!(await this.findPostcode(page))) break;
      }
      return done({ ok: true, picked, message: '상세주소(동·호수)는 fill_fields로 이어서 넣으세요.' });
    });
  }

  async attach(items: { key: string; file: string }[]): Promise<{ results: AttachItemResult[]; files: VaultFile[] }> {
    if (!this.files) return { results: items.map((i) => ({ key: i.key, ok: false, message: '파일 보관함이 없는 환경이에요 — 직접 첨부해 주세요' })), files: [] };
    const files = await this.files.list();
    if (!items.length) return { results: [], files };
    const vault = this.files;
    return this.host.agent(async () => {
      const page = await this.host.page();
      const scan = await this.scanPage(page, false);
      const results: AttachItemResult[] = [];
      for (const it of items) {
        const field = scan.fields.find((f) => f.key === it.key);
        const label = field?.label;
        if (field && field.manual !== 'file') {
          results.push({ key: it.key, label, ok: false, message: '업로드 칸이 아니에요' });
          continue;
        }
        const picked = pickFile(files, it.file);
        if (!picked.file) {
          results.push({ key: it.key, label, ok: false, message: picked.error });
          continue;
        }
        const loc = this.resolve(page, it.key);
        if (!loc) {
          results.push({ key: it.key, label, ok: false, message: '프레임이 바뀌었어요 — extract_fields를 다시 호출하세요' });
          continue;
        }
        const r = await vault.attach(loc.frame, loc.local, picked.file.id).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message.split('\n')[0] : String(e) }));
        results.push({ key: it.key, label, file: picked.file.name, ok: r.ok, shown: (r as { shown?: string }).shown, message: r.message });
      }
      return { results, files };
    });
  }

  /** 페이지 안에 펼쳐진 한 줄 채우기. 멈춰야 하면 이유를 돌려준다 */
  private async fillInlineRow(page: PageRef, row: RowSpec, added: Field[], res: RowResult, section?: string): Promise<string | undefined> {
    res.inline = true;
    const reqs = this.rowRequests(row, added, section, res, page);
    const filled = await this.fillMany(page, reqs);
    res.outcomes = filled.outcomes;
    if (filled.resets.length) res.resets = filled.resets;
    await this.scanPage(page, false); // 다음 줄의 "새 칸"을 이 줄과 구분하도록 키를 갱신
    const bad = res.outcomes.filter((o) => !ACCEPTABLE.has(o.status));
    if (res.unmatched.length) return `새 줄에서 칸을 못 찾음 (${res.unmatched.join(', ')}). 찾은 칸은 채웠어요.`;
    if (bad.length) return `불일치/실패 ${bad.length}칸.`;
    res.saved = true;
    const partial = this.partialOf(res.outcomes);
    if (partial.length) res.partial = partial;
    return undefined;
  }

  private learnResets(url: string, section: string | undefined, resets: ResetInfo[]): void {
    if (!section || !this.adapters) return;
    for (const r of resets) this.adapters.learnReset(url, section, r.by, r.cleared);
    this.adapters.flush();
  }

  async nextStep(key?: string): Promise<NavResult> {
    return this.host.agent(async () => {
      const started = Date.now();
      const page = await this.host.page();
      const fromUrl = page.url();
      const fail = async (message: string): Promise<NavResult> => ({
        ok: false,
        message,
        fromUrl,
        url: fromUrl,
        title: '',
        navigated: false,
        switchedTab: false,
        dialogs: await this.host.dialogsSince(started),
      });
      const { scan } = await this.knownKeys(page);
      let target: ActionButton | undefined;
      if (key) target = scan.buttons.find((b) => b.key === key);
      else {
        const nexts = scan.buttons.filter((b) => b.kind === 'next');
        if (nexts.length > 1) return fail(`"다음" 버튼이 여러 개예요. key로 골라 주세요: ${nexts.map((b) => `${b.key} "${b.text}"`).join(', ')}`);
        target = nexts[0];
      }
      if (!target) {
        const saves = scan.buttons.filter((b) => b.kind === 'save');
        return fail(
          `다음 단계 버튼을 찾지 못했어요.${saves.length ? ` 저장 버튼: ${saves.map((b) => `${b.key} "${b.text}"`).join(', ')}` : ''} 한 페이지짜리 지원서일 수 있어요.`,
        );
      }
      if (target.kind !== 'next' && target.kind !== 'save') return fail(`next_step은 "다음"/"저장" 버튼만 눌러요. "${target.text}"은(는) click_button을 쓰세요.`);
      const r = await this.safeClick(page, target.key);
      if (!r.ok) return fail(r.message);
      await page.settle(fromUrl);
      const active = await this.host.page();
      this.last = undefined;
      return {
        ok: true,
        text: r.info.text,
        fromUrl,
        url: active.url(),
        title: await active.title(),
        navigated: active.url() !== fromUrl,
        switchedTab: active !== page,
        dialogs: await this.host.dialogsSince(started),
      };
    });
  }

  // ---------- 사용자 작업 기다리기 ----------

  /**
   * 사용자가 직접 할 일(파일 첨부·성적 조회 팝업·인증)을 끝낼 때까지 기다린다.
   * 팝업이 닫히거나, 주소가 바뀌거나, 저장된 행·첨부 파일 수가 바뀌거나, 지켜보는 칸 값이 바뀌면 재개한다.
   * 에이전트 동작 구간(agent) 밖에서 기다린다: 그동안 사용자가 누른 확인창은 건드리지 않는다.
   */
  async waitForUser(opts: { reason: string; keys?: string[]; timeoutSec?: number }): Promise<WaitResult> {
    const started = Date.now();
    const page = await this.host.page();
    const before = await this.host.agent(() => this.knownKeys(page));
    type Watch = { modal: boolean; modalTitle: string; url: string; rows: number; files: number; values: Record<string, string> };
    const byFrame = new Map<FrameRef, string[]>();
    for (const k of opts.keys ?? []) {
      const loc = this.resolve(page, k);
      if (loc) byFrame.set(loc.frame, [...(byFrame.get(loc.frame) ?? []), loc.local]);
    }
    const read = async (): Promise<Watch> => {
      const w = await page.main().call<Watch>('watchState', byFrame.get(page.main()) ?? []);
      for (const [f, locals] of byFrame) {
        if (f.id === 0) continue;
        const sub = await f.call<Watch>('watchState', locals).catch(() => undefined);
        if (sub) for (const [k, v] of Object.entries(sub.values)) w.values[`${f.id}:${k}`] = v;
      }
      return w;
    };
    const timeout = Math.min(Math.max(opts.timeoutSec ?? 180, 5), 600) * 1000;
    const start = await read();
    const changes: string[] = [];
    while (Date.now() - started < timeout && !page.closed()) {
      await page.wait(700);
      const now = await read().catch(() => undefined);
      if (!now) continue;
      if (start.modal && !now.modal) changes.push(`팝업("${start.modalTitle}")이 닫힘`);
      if (!start.modal && now.modal) changes.push(`팝업("${now.modalTitle}")이 열림`);
      if (now.url !== start.url) changes.push(`주소가 바뀜: ${now.url}`);
      if (now.rows !== start.rows) changes.push(`저장된 행 ${start.rows} → ${now.rows}`);
      if (now.files !== start.files) changes.push(`첨부된 파일 ${start.files} → ${now.files}`);
      for (const [k, v] of Object.entries(now.values)) if (!sameValue(v, start.values[k] ?? '')) changes.push(`${k} 값이 바뀜: "${v}"`);
      if (changes.length) break;
    }
    return this.host.agent(async () => {
      const diff = page.closed() ? undefined : await this.diffAfter(page, before, false).catch(() => undefined);
      return {
        changes,
        timedOut: !changes.length,
        waitedSec: Math.round((Date.now() - started) / 1000),
        newFields: diff?.fields ?? [],
        changedFields: diff?.changed ?? [],
        modal: diff?.scan.modal,
        dialogs: await this.host.dialogsSince(started),
      };
    });
  }

  // ---------- 스냅샷 ----------

  async snapshot(dir: string): Promise<string[]> {
    const page = await this.host.page();
    // 폴더 이름은 이 PC 시간 기준 (UTC로 하면 헷갈린다)
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const host = (() => {
      try {
        return new URL(page.url()).host || 'page';
      } catch {
        return 'page';
      }
    })();
    const out = path.join(dir, `${host}-${stamp}`);
    mkdirSync(out, { recursive: true });
    const files: string[] = [];
    let i = 0;
    for (const f of await page.html()) {
      const file = path.join(out, `frame-${i++}.html`);
      writeFileSync(file, `<!-- url: ${f.url} -->\n${f.html}`, 'utf8');
      files.push(file);
    }
    if (this.last?.page === page) {
      const file = path.join(out, 'scan.json');
      writeFileSync(file, JSON.stringify(this.last.scan, null, 2), 'utf8');
      files.push(file);
    }
    return files;
  }
}

/** Playwright 드라이버 (테스트·디버깅용). 실사용은 크롬 확장 드라이버 */
export class PlaywrightDriver extends DomDriver {
  constructor(browser: BrowserManager, domBundlePath: string, adapters?: AdapterStore, files?: FileSource) {
    super(new PlaywrightHost(browser, domBundlePath), adapters, files);
  }
}

const EXTERNAL_BUTTON: [RegExp, string][] = [
  [/YBM|토익\s*성적|TOEIC\s*(성적|점수)?\s*(조회|불러오기|연동|인증)/i, 'YBM(TOEIC·TOEIC Speaking 성적 불러오기)'],
  [/OPIc|오픽/i, 'OPIc(성적 인증)'],
  [/성적\s*(조회|불러오기|연동|인증)|어학\s*성적\s*(조회|연동)/, '어학 성적 연동'],
];
const SCORE_LABEL = /점수|등급|성적|응시일|취득일|수험번호|시험일/;

/** 외부 연동 버튼과 그 결과가 들어올 칸 (같은 섹션의 점수·등급·응시일 칸) */
export function externalHints(scan: PageScan): ExternalHint[] {
  const out: ExternalHint[] = [];
  for (const b of scan.buttons) {
    const hit = EXTERNAL_BUTTON.find(([re]) => re.test(b.text));
    if (!hit || out.some((o) => o.name === hit[1])) continue;
    const watch = scan.fields.filter((f) => (!b.section || f.section === b.section) && SCORE_LABEL.test(f.label)).map((f) => f.key);
    out.push({ name: hit[1], button: b.key, watch: watch.slice(0, 10) });
  }
  return out;
}
