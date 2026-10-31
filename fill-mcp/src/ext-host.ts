// 크롬 확장으로 BrowserHost 구현 (실사용). 사용자가 평소 쓰는 크롬·로그인 그대로 쓴다.
// 실제 DOM 작업은 확장의 content script에 들어 있는 같은 dom 번들(src/dom)이 한다.
// 실제 마우스·키보드가 없어서 click/fill/press/type은 dom/input.ts의 흉내 입력으로 보낸다.
import { BridgeClient, type AttachOutcome, type BridgeFrame, type BridgeRequest, type BridgeTab, type LoginOutcome, type VaultFile } from './bridge.js';
import type { FileSource } from './files.js';
import { DomDriver } from './driver.js';
import type { AdapterStore } from './adapters.js';
import type { ApiName, BrowserHost, DialogRecord, FrameRef, KeyAction, PageRef, TabControl, TabInfo } from './transport.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class ExtFrame implements FrameRef {
  private gone = false;
  constructor(
    readonly id: number,
    private readonly page: ExtPage,
  ) {}

  detached(): boolean {
    return this.gone || this.page.closed();
  }

  async call<T>(fn: ApiName, ...args: unknown[]): Promise<T> {
    try {
      return await this.page.host.rpc<T>({ op: 'call', tabId: this.page.tabId, frameId: this.id, fn, args });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'no_frame') this.gone = true;
      if (code === 'no_tab') this.page.markClosed();
      throw e;
    }
  }

  private trusted(req: { action: 'click' | 'type' | 'press'; selector: string; text?: string; key?: KeyAction; delayMs?: number }): Promise<unknown> {
    return this.page.host.rpc({ op: 'trusted', tabId: this.page.tabId, frameId: this.id, ...req }, 30000);
  }

  async click(selector: string): Promise<void> {
    if (this.page.host.trustedMode) await this.trusted({ action: 'click', selector });
    else await this.call('clickSelector', selector);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.call('setValueSelector', selector, value);
  }

  async press(selector: string, key: KeyAction): Promise<void> {
    if (this.page.host.trustedMode) await this.trusted({ action: 'press', selector, key });
    else await this.call('pressKey', selector, key);
  }

  async type(selector: string, text: string, delayMs: number): Promise<void> {
    if (this.page.host.trustedMode) await this.trusted({ action: 'type', selector, text, delayMs });
    else await this.call('typeText', selector, text, delayMs);
  }

  attr(selector: string, name: string): Promise<string | null> {
    return this.call<string | null>('attrOf', selector, name).catch(() => null);
  }
}

class ExtPage implements PageRef {
  private href: string;
  private gone = false;
  private readonly frameRefs = new Map<number, ExtFrame>();

  constructor(
    readonly host: ExtHost,
    readonly tabId: number,
    url: string,
  ) {
    this.href = url;
  }

  update(t: BridgeTab): void {
    this.href = t.url;
  }

  markClosed(): void {
    this.gone = true;
  }

  url(): string {
    return this.href;
  }

  async title(): Promise<string> {
    return (await this.host.rpc<BridgeTab>({ op: 'page' }).catch(() => undefined))?.title ?? '';
  }

  closed(): boolean {
    return this.gone;
  }

  frame(id: number): ExtFrame {
    let f = this.frameRefs.get(id);
    if (!f) {
      f = new ExtFrame(id, this);
      this.frameRefs.set(id, f);
    }
    return f;
  }

  main(): FrameRef {
    return this.frame(0);
  }

  async frames(): Promise<FrameRef[]> {
    const list = await this.host.rpc<BridgeFrame[]>({ op: 'frames', tabId: this.tabId });
    const out: FrameRef[] = [this.main()];
    for (const f of list) if (f.frameId !== 0) out.push(this.frame(f.frameId));
    return out;
  }

  frameById(id: number): FrameRef | undefined {
    return id === 0 ? this.main() : this.frameRefs.get(id);
  }

  wait(ms: number): Promise<void> {
    return sleep(ms);
  }

  async settle(urlBefore: string): Promise<void> {
    const url = await this.host.rpc<string>({ op: 'settle', tabId: this.tabId, urlBefore }, 20000).catch(() => undefined);
    if (url) this.href = url;
  }

  html(): Promise<{ url: string; html: string }[]> {
    return this.host.rpc({ op: 'html', tabId: this.tabId });
  }
}

export class ExtHost implements BrowserHost, TabControl {
  private readonly pages = new Map<number, ExtPage>();
  private current?: ExtPage;
  private agentDepth = 0;
  /** withTrusted 안: click/type/press를 chrome.debugger로 보낸다 */
  trustedMode = false;

  constructor(readonly bridge: BridgeClient) {}

  rpc<T>(req: BridgeRequest, timeoutMs?: number): Promise<T> {
    return this.bridge.request<T>(req, timeoutMs);
  }

  private wrap(t: BridgeTab): ExtPage {
    let p = this.pages.get(t.tabId);
    if (!p) {
      p = new ExtPage(this, t.tabId, t.url);
      this.pages.set(t.tabId, p);
    }
    p.update(t);
    return p;
  }

  async page(): Promise<PageRef> {
    this.current = this.wrap(await this.rpc<BridgeTab>({ op: 'page' }));
    return this.current;
  }

  /** 에이전트가 동작하는 동안 확장이 alert/confirm을 대신 처리한다 (제출 확인은 취소). 끝나고 1.5초 뒤 해제 */
  async agent<T>(fn: () => Promise<T>): Promise<T> {
    const cur = this.current ?? ((await this.page()) as ExtPage);
    const tabId = cur.tabId;
    if (this.agentDepth++ === 0) await this.rpc({ op: 'agent', tabId, on: true }).catch(() => {});
    try {
      return await fn();
    } finally {
      if (--this.agentDepth === 0) void this.rpc({ op: 'agent', tabId, on: false }).catch(() => {});
    }
  }

  async withTrusted<T>(fn: () => Promise<T>): Promise<T> {
    const tabId = (this.current ?? ((await this.page()) as ExtPage)).tabId;
    this.trustedMode = true;
    try {
      return await fn();
    } finally {
      this.trustedMode = false;
      void this.rpc({ op: 'trusted-end', tabId }).catch(() => {});
    }
  }

  async dialogsSince(t: number): Promise<DialogRecord[]> {
    if (!this.current) return [];
    return this.rpc<DialogRecord[]>({ op: 'dialogs', tabId: this.current.tabId, since: t }).catch(() => []);
  }

  async takeExternalTabs(): Promise<string | undefined> {
    const hosts = await this.rpc<string[]>({ op: 'external' }).catch(() => []);
    if (!hosts.length) return undefined;
    return `다른 사이트 탭이 열렸어요(${[...new Set(hosts)].join(', ')}). 작업 탭은 그대로 두었어요 — 그 탭에서 할 일(성적 조회·인증 등)은 직접 해 주세요.`;
  }

  async popups(): Promise<PageRef[]> {
    const cur = this.current ?? ((await this.page()) as ExtPage);
    const list = await this.rpc<BridgeTab[]>({ op: 'popups', tabId: cur.tabId }).catch(() => []);
    return list.map((t) => this.wrap(t));
  }

  /** 계정 보관함으로 로그인. 비밀번호는 확장 안에서만 오가고, 결과 상태만 돌아온다 */
  async login(): Promise<LoginOutcome> {
    const cur = (await this.page()) as ExtPage;
    return this.rpc<LoginOutcome>({ op: 'login', tabId: cur.tabId }, 45000);
  }

  // TabControl (browser_open / browser_tabs)
  async open(url?: string): Promise<unknown> {
    const t = await this.rpc<BridgeTab>({ op: 'open', url }, 40000);
    this.current = this.wrap(t);
    return t;
  }

  async tabs(): Promise<TabInfo[]> {
    const list = await this.rpc<BridgeTab[]>({ op: 'tabs' });
    return list.map((t, index) => ({ index, title: t.title, url: t.url, active: !!t.active }));
  }

  async selectTab(index: number): Promise<unknown> {
    const t = await this.rpc<BridgeTab>({ op: 'select', index });
    this.current = this.wrap(t);
    return t;
  }

  async shutdown(): Promise<void> {
    this.bridge.close();
  }
}

/** 확장의 파일 보관함(IndexedDB): 목록만 받아 오고, 첨부는 확장 안에서 content script로 바로 보낸다 */
export class ExtFiles implements FileSource {
  constructor(private readonly ext: ExtHost) {}

  list(): Promise<VaultFile[]> {
    return this.ext.rpc<VaultFile[]>({ op: 'files' });
  }

  async attach(frame: FrameRef, localKey: string, fileId: string): Promise<AttachOutcome> {
    const page = (await this.ext.page()) as ExtPage;
    return this.ext.rpc<AttachOutcome>({ op: 'attach', tabId: page.tabId, frameId: frame.id, key: localKey, fileId }, 40000);
  }
}

export class ExtensionDriver extends DomDriver {
  constructor(
    readonly ext: ExtHost,
    adapters?: AdapterStore,
  ) {
    super(ext, adapters, new ExtFiles(ext));
  }
}
