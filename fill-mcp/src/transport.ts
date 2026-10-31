// 실행 환경과 드라이버 사이의 얇은 경계.
// DomDriver(driver.ts)는 이 인터페이스만 보고 동작한다. 구현은 Playwright(pw-host.ts, 테스트·디버깅)와
// 크롬 확장(ext-host.ts, 실사용) 두 가지다. 실제 DOM 작업은 둘 다 같은 dom 번들(src/dom → window.__clf)로 한다.
import type { ClfApi } from './dom/index.js';

export type ApiName = Exclude<keyof ClfApi, 'build'>;

/** 확인창 기록 (alert/confirm/prompt). accepted/dismissed: 에이전트가 처리, user: 사용자에게 맡김 */
export interface DialogRecord {
  type: string;
  message: string;
  handled: 'accepted' | 'dismissed' | 'user';
  at: number;
}

/** 실제 키 이름이 아니라 동작 이름: 환경마다 보내는 방법이 다르다 */
export type KeyAction = 'selectAll' | 'backspace' | 'tab';

export interface FrameRef {
  /** 0이면 메인 프레임. 키 접두사("3:f12")로 쓴다 */
  readonly id: number;
  detached(): boolean;
  call<T>(fn: ApiName, ...args: unknown[]): Promise<T>;
  /** 실제 마우스 클릭(가능한 환경에서). 실패하면 던진다 */
  click(selector: string, timeoutMs?: number): Promise<void>;
  /** 칸 값을 통째로 바꾼다 (Playwright locator.fill과 같은 의미) */
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: KeyAction): Promise<void>;
  /** 한 글자씩 친다 (키 입력에만 반응하는 검색 칸) */
  type(selector: string, text: string, delayMs: number): Promise<void>;
  attr(selector: string, name: string): Promise<string | null>;
}

export interface PageRef {
  url(): string;
  title(): Promise<string>;
  closed(): boolean;
  main(): FrameRef;
  /** 스캔할 프레임들 (메인 먼저, 광고·추적 프레임과 작은 프레임은 뺀다) */
  frames(): Promise<FrameRef[]>;
  frameById(id: number): FrameRef | undefined;
  wait(ms: number): Promise<void>;
  /** 클릭 뒤 페이지가 가라앉을 때까지 (이동했으면 로드까지) */
  settle(urlBefore: string): Promise<void>;
  /** 스냅샷용: 프레임마다 HTML */
  html(): Promise<{ url: string; html: string }[]>;
}

export interface TabInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

/** browser_open / browser_tabs 용 탭 조작 (Playwright: BrowserManager, 확장: ExtHost) */
export interface TabControl {
  open(url?: string): Promise<unknown>;
  tabs(): Promise<TabInfo[]>;
  selectTab(index: number): Promise<unknown>;
  shutdown(): Promise<void>;
}

export interface BrowserHost {
  /** 작업할 탭. 같은 탭이면 같은 객체를 돌려준다 (스캔 캐시 비교에 쓴다) */
  page(): Promise<PageRef>;
  /** 에이전트 동작 구간: 이 안에서 뜬 확인창만 대신 처리한다 */
  agent<T>(fn: () => Promise<T>): Promise<T>;
  dialogsSince(t: number): Promise<DialogRecord[]>;
  /** 작업 탭과 다른 사이트로 열린 탭 안내 (한 번 읽으면 비운다) */
  takeExternalTabs(): Promise<string | undefined>;
  /** 다른 탭·팝업 창 (주소 검색 팝업 등). 없으면 빈 배열 */
  popups?(): Promise<PageRef[]>;
  /**
   * 이 안에서는 click/type/press를 진짜 입력(isTrusted)으로 보낸다. 흉내 입력만 쓰는 환경(확장)에만 있다.
   * 확장은 chrome.debugger로 보내서 그동안 크롬 위에 "디버깅 중" 알림줄이 뜬다.
   */
  withTrusted?<T>(fn: () => Promise<T>): Promise<T>;
}

export const sel = {
  key: (k: string) => `[data-clf="${k}"]`,
  opt: '[data-clf-opt="1"]',
  search: '[data-clf-search="1"]',
};

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: 페이지가 응답하지 않아요. 브라우저에 확인창이 떠 있으면 닫아 주세요.`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}
