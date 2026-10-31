// 작업용 브라우저 관리.
// 기본(cdp)은 전용 프로필로 크롬/엣지를 따로 띄우고 디버깅 포트로 붙는다.
// 그래서 MCP 서버가 재시작돼도 브라우저와 로그인 상태가 유지된다.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Dialog, type Page } from 'playwright-core';
import type { BrowserOptions } from './config.js';
import { BLOCKED_DIALOG } from './dom/safety.js';
import type { DialogRecord, TabInfo } from './transport.js';

export type { DialogRecord, TabInfo };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function findBrowserExecutable(override?: string): string | undefined {
  if (override) return existsSync(override) ? override : undefined;
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [
          `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((p) => !p.includes('undefined') && existsSync(p));
}

async function endpointUp(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export class BrowserManager {
  private browser?: Browser;
  private ctx?: BrowserContext;
  private current?: Page;
  private connecting?: Promise<BrowserContext>;
  private readonly tracked = new WeakSet<Page>();
  private readonly dialogs: DialogRecord[] = [];
  private agentDepth = 0;
  private agentUntil = 0;
  /** 작업 탭과 다른 사이트로 열린 탭 (성적 조회·본인 인증 등). 자동으로 옮겨 가지 않고 알리기만 한다 */
  private externalTabs: string[] = [];

  constructor(readonly opts: BrowserOptions) {}

  get endpoint(): string {
    return `http://127.0.0.1:${this.opts.port}`;
  }

  async context(): Promise<BrowserContext> {
    if (this.ctx && this.browser?.isConnected()) return this.ctx;
    this.connecting ??= this.connect().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async connect(): Promise<BrowserContext> {
    const exe = findBrowserExecutable(this.opts.executablePath);
    if (this.opts.mode === 'launch') {
      if (!exe) throw new Error('크롬이나 엣지를 찾지 못했어요. CAREERLOG_BROWSER_PATH로 실행 파일 경로를 알려 주세요.');
      this.browser = await chromium.launch({ executablePath: exe, headless: this.opts.headless });
      this.ctx = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    } else {
      if (!(await endpointUp(this.endpoint))) {
        if (!exe) throw new Error('크롬이나 엣지를 찾지 못했어요. CAREERLOG_BROWSER_PATH로 실행 파일 경로를 알려 주세요.');
        await this.spawnDetached(exe);
      }
      this.browser = await chromium.connectOverCDP(this.endpoint);
      this.ctx = this.browser.contexts()[0] ?? (await this.browser.newContext());
    }
    const ctx = this.ctx;
    this.browser.on('disconnected', () => {
      this.browser = undefined;
      this.ctx = undefined;
      this.current = undefined;
    });
    ctx.on('page', (p) => void this.onNewPage(p));
    for (const p of ctx.pages()) this.track(p, false);
    return ctx;
  }

  /** 새 탭: 같은 사이트면 작업 탭으로 옮기고(지원서가 새 창으로 열리는 사이트), 다른 사이트면 알리기만 한다 */
  private async onNewPage(p: Page): Promise<void> {
    this.track(p, false);
    const cur = this.current && !this.current.isClosed() ? this.current : undefined;
    await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    const h = hostOf(p.url());
    if (!cur || !h || h === hostOf(cur.url())) this.current = p;
    else this.externalTabs.push(h);
  }

  /** 다른 사이트 탭이 열렸다는 안내 (한 번 읽으면 비운다) */
  takeExternalTabs(): string | undefined {
    if (!this.externalTabs.length) return undefined;
    const hosts = [...new Set(this.externalTabs)].join(', ');
    this.externalTabs = [];
    return `다른 사이트 탭이 열렸어요(${hosts}). 작업 탭은 그대로 두었어요 — 그 탭에서 할 일(성적 조회·인증 등)은 직접 해 주세요.`;
  }

  /** 서버 프로세스와 분리해서 띄운다: 서버가 꺼져도 브라우저(로그인)는 남는다 */
  private async spawnDetached(exe: string): Promise<void> {
    mkdirSync(this.opts.userDataDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${this.opts.port}`,
      `--user-data-dir=${this.opts.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(this.opts.headless ? ['--headless=new'] : []),
      'about:blank',
    ];
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 80; i++) {
      if (await endpointUp(this.endpoint)) return;
      await sleep(250);
    }
    throw new Error(`브라우저를 띄웠지만 디버깅 포트(${this.opts.port})에 연결하지 못했어요.`);
  }

  private track(p: Page, makeCurrent: boolean): void {
    if (this.tracked.has(p)) return;
    this.tracked.add(p);
    p.on('dialog', (d) => void this.onDialog(d));
    p.on('close', () => {
      if (this.current === p) this.current = undefined;
    });
    if (makeCurrent) this.current = p;
  }

  /** 에이전트가 동작하는 동안(+여유 1.5초)에만 confirm/beforeunload를 대신 처리한다 */
  async agent<T>(fn: () => Promise<T>): Promise<T> {
    this.agentDepth++;
    try {
      return await fn();
    } finally {
      this.agentDepth--;
      this.agentUntil = Date.now() + 1500;
    }
  }

  private agentActive(): boolean {
    return this.agentDepth > 0 || Date.now() < this.agentUntil;
  }

  private async onDialog(d: Dialog): Promise<void> {
    const rec: DialogRecord = { type: d.type(), message: d.message().slice(0, 300), handled: 'user', at: Date.now() };
    this.dialogs.push(rec);
    if (this.dialogs.length > 50) this.dialogs.shift();
    // 사람이 직접 누른 버튼에서 뜬 창은 건드리지 않는다 (제출 확인창 등)
    if (!this.agentActive()) return;
    try {
      if (d.type() === 'alert') {
        await d.accept();
        rec.handled = 'accepted';
      } else if (d.type() === 'confirm' && !BLOCKED_DIALOG.test(d.message())) {
        await d.accept();
        rec.handled = 'accepted';
      } else {
        // 제출 확인, prompt, 페이지 이탈(beforeunload)은 취소
        await d.dismiss();
        rec.handled = 'dismissed';
      }
    } catch {
      // 사용자가 먼저 닫은 경우
    }
  }

  dialogsSince(t: number): DialogRecord[] {
    return this.dialogs.filter((d) => d.at >= t);
  }

  /** 열린 탭 전부 (주소 검색 팝업 창 찾기 등) */
  allPages(): Promise<Page[]> {
    return this.livePages();
  }

  private async livePages(): Promise<Page[]> {
    const ctx = await this.context();
    return ctx.pages().filter((p) => !p.isClosed());
  }

  /**
   * 작업할 탭. 한 번 정한 탭을 계속 쓴다.
   * 사용자가 같은 사이트의 다른 탭으로 옮겨 보고 있으면 그쪽으로 따라가고, 다른 사이트 탭으로는 옮기지 않는다.
   */
  async page(): Promise<Page> {
    const pages = await this.livePages();
    if (!pages.length) {
      const p = await (await this.context()).newPage();
      this.track(p, true);
      return p;
    }
    const isShown = (p: Page) =>
      Promise.race([p.evaluate(() => document.visibilityState === 'visible').catch(() => false), sleep(1500).then(() => false)]);
    if (this.current && pages.includes(this.current)) {
      if (!(await isShown(this.current))) {
        const host = hostOf(this.current.url());
        for (const p of [...pages].reverse()) {
          if (p !== this.current && hostOf(p.url()) === host && (await isShown(p))) {
            this.current = p;
            break;
          }
        }
      }
      return this.current;
    }
    for (const p of [...pages].reverse()) {
      if (await isShown(p)) return (this.current = p);
    }
    return (this.current = pages[pages.length - 1]);
  }

  async tabs(): Promise<TabInfo[]> {
    const active = await this.page();
    const pages = await this.livePages();
    return Promise.all(
      pages.map(async (p, index) => ({
        index,
        title: await p.title().catch(() => ''),
        url: p.url(),
        active: p === active,
      })),
    );
  }

  async selectTab(index: number): Promise<Page> {
    const pages = await this.livePages();
    const p = pages[index];
    if (!p) throw new Error(`${index}번 탭이 없어요 (0~${pages.length - 1}).`);
    this.current = p;
    await p.bringToFront().catch(() => {});
    return p;
  }

  /** 브라우저를 열거나 붙고, url이 있으면 이동 (빈 탭은 재사용, 아니면 새 탭) */
  async open(url?: string): Promise<Page> {
    const ctx = await this.context();
    if (!url) return this.page();
    const pages = await this.livePages();
    if (pages.some((p) => p.url() === url)) return this.selectTab(pages.findIndex((p) => p.url() === url));
    const blank = pages.find((p) => /^(about:blank|chrome:\/\/newtab|edge:\/\/newtab|chrome-search:)/.test(p.url()));
    const page = blank ?? (await ctx.newPage());
    this.track(page, true);
    this.current = page;
    await this.agent(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
    await page.bringToFront().catch(() => {});
    return page;
  }

  /** launch 모드는 브라우저를 닫고, cdp 모드는 연결만 끊는다 (브라우저는 사용자 것) */
  async shutdown(): Promise<void> {
    if (!this.browser) return;
    if (this.opts.mode === 'launch') await this.browser.close().catch(() => {});
  }
}
