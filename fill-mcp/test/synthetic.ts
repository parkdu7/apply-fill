// 확장 모드 흉내: Playwright로 페이지를 띄우되 click/fill/press/type은 실제 입력 대신
// 확장 content script와 같은 흉내 입력(dom/input.ts)으로 보낸다. CLF_SYNTHETIC=1이면 helpers가 이걸 쓴다.
import type { AdapterStore } from '../src/adapters.js';
import type { BrowserManager } from '../src/browser.js';
import { DomDriver } from '../src/driver.js';
import { PlaywrightHost } from '../src/pw-host.js';
import type { ApiName, BrowserHost, FrameRef, KeyAction, PageRef } from '../src/transport.js';

/** withTrusted 안에서는 진짜 입력(Playwright)을 쓴다: 확장의 chrome.debugger 경로 흉내 */
const mode = { trusted: false };

class SynthFrame implements FrameRef {
  constructor(private readonly inner: FrameRef) {}
  get id(): number {
    return this.inner.id;
  }
  detached(): boolean {
    return this.inner.detached();
  }
  call<T>(fn: ApiName, ...args: unknown[]): Promise<T> {
    return this.inner.call<T>(fn, ...args);
  }
  async click(selector: string): Promise<void> {
    if (mode.trusted) return this.inner.click(selector);
    await this.inner.call('clickSelector', selector);
  }
  async fill(selector: string, value: string): Promise<void> {
    await this.inner.call('setValueSelector', selector, value);
  }
  async press(selector: string, key: KeyAction): Promise<void> {
    if (mode.trusted) return this.inner.press(selector, key);
    await this.inner.call('pressKey', selector, key);
  }
  async type(selector: string, text: string, delayMs: number): Promise<void> {
    if (mode.trusted) return this.inner.type(selector, text, delayMs);
    await this.inner.call('typeText', selector, text, delayMs);
  }
  attr(selector: string, name: string): Promise<string | null> {
    return this.inner.call<string | null>('attrOf', selector, name).catch(() => null);
  }
}

const frames = new WeakMap<FrameRef, SynthFrame>();
const wrapFrame = (f: FrameRef): SynthFrame => {
  let s = frames.get(f);
  if (!s) frames.set(f, (s = new SynthFrame(f)));
  return s;
};

const pages = new WeakMap<PageRef, PageRef>();
function wrapPage(p: PageRef): PageRef {
  let w = pages.get(p);
  if (!w) {
    w = {
      url: () => p.url(),
      title: () => p.title(),
      closed: () => p.closed(),
      main: () => wrapFrame(p.main()),
      frames: async () => (await p.frames()).map(wrapFrame),
      frameById: (id) => {
        const f = p.frameById(id);
        return f && wrapFrame(f);
      },
      wait: (ms) => p.wait(ms),
      settle: (u) => p.settle(u),
      html: () => p.html(),
    };
    pages.set(p, w);
  }
  return w;
}

export class SyntheticHost implements BrowserHost {
  private readonly pw: PlaywrightHost;
  constructor(browser: BrowserManager, domBundlePath: string) {
    this.pw = new PlaywrightHost(browser, domBundlePath);
  }
  async page(): Promise<PageRef> {
    return wrapPage(await this.pw.page());
  }
  agent<T>(fn: () => Promise<T>): Promise<T> {
    return this.pw.agent(fn);
  }
  dialogsSince(t: number) {
    return this.pw.dialogsSince(t);
  }
  takeExternalTabs() {
    return this.pw.takeExternalTabs();
  }
  async popups(): Promise<PageRef[]> {
    return (await this.pw.popups()).map(wrapPage);
  }
  /** 확장의 chrome.debugger 경로 흉내 (CLF_SYNTHETIC_TRUSTED=0이면 없는 것으로: 흉내 입력만) */
  withTrusted?: <T>(fn: () => Promise<T>) => Promise<T> =
    process.env.CLF_SYNTHETIC_TRUSTED === '0'
      ? undefined
      : async (fn) => {
          mode.trusted = true;
          try {
            return await fn();
          } finally {
            mode.trusted = false;
          }
        };
}

export function syntheticDriver(browser: BrowserManager, domBundlePath: string, adapters?: AdapterStore): DomDriver {
  return new DomDriver(new SyntheticHost(browser, domBundlePath), adapters);
}
