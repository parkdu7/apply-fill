// Playwright로 BrowserHost 구현 (테스트·디버깅·오프라인 회귀 테스트용).
// dist/dom.js 번들을 각 프레임에 evaluate로 주입하고 호출한다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Frame, Page } from 'playwright-core';
import type { BrowserManager } from './browser.js';
import { withTimeout, type ApiName, type BrowserHost, type DialogRecord, type FrameRef, type KeyAction, type PageRef } from './transport.js';

const IGNORED_FRAME = /channel\.io|googletagmanager|doubleclick|recaptcha|facebook\.com|youtube\.com|kakao\.com|wcs\.naver/i;
const CALL_TIMEOUT = 45000;
const KEYS: Record<KeyAction, string> = { selectAll: 'ControlOrMeta+A', backspace: 'Backspace', tab: 'Tab' };

class Bundle {
  private dom?: { code: string; build: string };
  constructor(private readonly path: string) {}
  get(): { code: string; build: string } {
    if (!this.dom) {
      const src = readFileSync(this.path, 'utf8');
      const build = createHash('sha1').update(src).digest('hex').slice(0, 10);
      // 식 하나로 감싸서 evaluate 해석 방식에 상관없이 실행되게
      this.dom = { code: `(() => {\n${src}\nwindow.__clf.build = ${JSON.stringify(build)};\nreturn true;\n})()`, build };
    }
    return this.dom;
  }
}

class PwFrame implements FrameRef {
  constructor(
    readonly id: number,
    private readonly frame: Frame,
    private readonly bundle: Bundle,
  ) {}

  detached(): boolean {
    return this.frame.isDetached();
  }

  async call<T>(fn: ApiName, ...args: unknown[]): Promise<T> {
    const { code, build } = this.bundle.get();
    const f = this.frame;
    const ready = await withTimeout(
      f.evaluate((b) => (window as unknown as { __clf?: { build: string } }).__clf?.build === b, build),
      CALL_TIMEOUT,
      '주입 확인',
    );
    if (!ready) await withTimeout(f.evaluate(code), CALL_TIMEOUT, '스크립트 주입');
    return withTimeout(
      f.evaluate(
        ([name, a]) => {
          const api = (window as unknown as { __clf: Record<string, (...x: unknown[]) => unknown> }).__clf;
          return api[name as string](...(a as unknown[]));
        },
        [fn, args] as const,
      ) as Promise<T>,
      CALL_TIMEOUT,
      fn,
    );
  }

  async click(selector: string, timeoutMs = 5000): Promise<void> {
    await this.frame.locator(selector).first().click({ timeout: timeoutMs });
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.frame.locator(selector).first().fill(value, { timeout: 5000 });
  }

  async press(selector: string, key: KeyAction): Promise<void> {
    await this.frame.locator(selector).first().press(KEYS[key]);
  }

  async type(selector: string, text: string, delayMs: number): Promise<void> {
    await this.frame.locator(selector).first().pressSequentially(text, { delay: delayMs });
  }

  attr(selector: string, name: string): Promise<string | null> {
    return this.frame
      .locator(selector)
      .first()
      .getAttribute(name, { timeout: 2000 })
      .catch(() => null);
  }
}

class PwPage implements PageRef {
  constructor(
    readonly page: Page,
    private readonly host: PlaywrightHost,
  ) {}

  url(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title().catch(() => '');
  }

  closed(): boolean {
    return this.page.isClosed();
  }

  main(): FrameRef {
    return this.host.frameRef(this.page.mainFrame(), true);
  }

  async frames(): Promise<FrameRef[]> {
    const out: FrameRef[] = [this.main()];
    for (const f of this.page.frames()) {
      if (f === this.page.mainFrame() || f.isDetached() || IGNORED_FRAME.test(f.url())) continue;
      const box = await f
        .frameElement()
        .then((h) => h.boundingBox())
        .catch(() => null);
      if (box && box.width >= 50 && box.height >= 30) out.push(this.host.frameRef(f, false));
    }
    return out;
  }

  frameById(id: number): FrameRef | undefined {
    if (id === 0) return this.main();
    const f = this.host.frameOf(id);
    if (!f || f.isDetached() || f.page() !== this.page) return undefined;
    return this.host.frameRef(f, false);
  }

  wait(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms).catch(() => {});
  }

  async settle(urlBefore: string): Promise<void> {
    await this.page.waitForTimeout(400).catch(() => {});
    if (this.page.isClosed()) return;
    if (this.page.url() !== urlBefore) await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  async html(): Promise<{ url: string; html: string }[]> {
    const out: { url: string; html: string }[] = [];
    for (const f of this.page.frames()) {
      if (f.isDetached()) continue;
      const html = await f.content().catch(() => '');
      if (html) out.push({ url: f.url(), html });
    }
    return out;
  }
}

export class PlaywrightHost implements BrowserHost {
  private readonly bundle: Bundle;
  private readonly pages = new WeakMap<Page, PwPage>();
  private readonly frameIds = new WeakMap<Frame, number>();
  private readonly frameById = new Map<number, Frame>();
  private readonly frameRefs = new WeakMap<Frame, PwFrame>();
  private nextFrameId = 1;

  constructor(
    readonly browser: BrowserManager,
    domBundlePath: string,
  ) {
    this.bundle = new Bundle(domBundlePath);
  }

  wrap(page: Page): PwPage {
    let p = this.pages.get(page);
    if (!p) {
      p = new PwPage(page, this);
      this.pages.set(page, p);
    }
    return p;
  }

  frameRef(f: Frame, main: boolean): FrameRef {
    let r = this.frameRefs.get(f);
    if (!r) {
      let id = 0;
      if (!main) {
        id = this.frameIds.get(f) ?? this.nextFrameId++;
        this.frameIds.set(f, id);
        this.frameById.set(id, f);
      }
      r = new PwFrame(id, f, this.bundle);
      this.frameRefs.set(f, r);
    }
    return r;
  }

  frameOf(id: number): Frame | undefined {
    return this.frameById.get(id);
  }

  async page(): Promise<PageRef> {
    return this.wrap(await this.browser.page());
  }

  agent<T>(fn: () => Promise<T>): Promise<T> {
    return this.browser.agent(fn);
  }

  async dialogsSince(t: number): Promise<DialogRecord[]> {
    return this.browser.dialogsSince(t);
  }

  async takeExternalTabs(): Promise<string | undefined> {
    return this.browser.takeExternalTabs();
  }

  async popups(): Promise<PageRef[]> {
    const current = await this.browser.page();
    return (await this.browser.allPages()).filter((p) => p !== current).map((p) => this.wrap(p));
  }
}
