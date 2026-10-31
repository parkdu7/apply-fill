// 확장 없이 확장을 흉내 내는 테스트 도구:
// - FakeChrome: native host를 크롬처럼 띄우고(4바이트 길이 + JSON) 브리지 요청을 Playwright 페이지로 실행한다
// - 페이지에는 content script와 같은 코드(dom 번들 + handlers, 확인창 shim)를 넣는다
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Page } from 'playwright-core';
import { BrowserManager } from '../../fill-mcp/src/browser';
import { loadConfig } from '../../fill-mcp/src/config';
import { decoder, encode } from '../host/src/native';
import type { BridgeRequest, FromHost, ToHost } from '../src/shared/protocol';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILL_MCP = path.resolve(ROOT, '..', 'fill-mcp', 'dist', 'index.js');
export const fixture = (name: string) => pathToFileURL(path.join(ROOT, 'test', 'fixtures', name)).href;

let bundles: Promise<{ content: string; shim: string }> | undefined;
export function pageBundles(): Promise<{ content: string; shim: string }> {
  bundles ??= (async () => {
    const one = async (entry: string) =>
      (await build({ entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome116', logLevel: 'warning' })).outputFiles[0].text;
    return { content: await one('test/page-entry.ts'), shim: await one('src/content/dialog-shim.iife.ts') };
  })();
  return bundles;
}

export function launchBrowser(): BrowserManager {
  const cfg = loadConfig({ ...process.env, CAREERLOG_BROWSER: 'launch', CAREERLOG_HEADLESS: '1' });
  return new BrowserManager(cfg.browser);
}

/** 페이지에 확인창 shim(페이지 world, 맨 먼저)과 content script를 넣는다 */
export async function prepare(page: Page): Promise<void> {
  const { content, shim } = await pageBundles();
  await page.addInitScript({ content: shim });
  await page.reload();
  await page.evaluate(content);
}

type Handler = (msg: { t: string; [k: string]: unknown }) => unknown;
export const handle = (page: Page, msg: Record<string, unknown>) => page.evaluate((m: Record<string, unknown>) => (window as unknown as { __clfHandle: Handler }).__clfHandle(m as never), msg);

export class FakeChrome {
  readonly child: ChildProcess;
  readonly messages: FromHost[] = [];
  readonly asks: unknown[] = [];
  private waiters: { pred: (m: FromHost) => boolean; resolve: (m: FromHost) => void }[] = [];

  constructor(
    env: Record<string, string>,
    private readonly page?: Page,
  ) {
    this.child = spawn(process.execPath, [path.join(ROOT, 'host', 'dist', 'host.mjs'), `chrome-extension://test/`], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout!.on('data', decoder((m) => this.onMessage(m as FromHost)));
  }

  send(m: ToHost): void {
    this.child.stdin!.write(encode(m));
  }

  waitFor(pred: (m: FromHost) => boolean, timeoutMs = 60000): Promise<FromHost> {
    const hit = this.messages.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`기다린 메시지가 오지 않음. 받은 것: ${this.messages.map((x) => x.type).join(', ')}`));
      }, timeoutMs);
    });
  }

  private onMessage(m: FromHost): void {
    if (m.type === 'rpc') {
      void this.rpc(m.req).then(
        (result) => this.send({ type: 'rpc-result', id: m.id, ok: true, result }),
        (e: Error) => this.send({ type: 'rpc-result', id: m.id, ok: false, error: e.message }),
      );
      return;
    }
    this.messages.push(m);
    for (const w of [...this.waiters]) {
      if (w.pred(m)) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(m);
      }
    }
  }

  /** background의 브리지 처리를 Playwright로 흉내 (프레임은 메인 하나) */
  private async rpc(req: BridgeRequest): Promise<unknown> {
    const page = this.page;
    if (!page) throw new Error('페이지 없음');
    const tab = async () => ({ tabId: 1, url: page.url(), title: await page.title(), active: true });
    switch (req.op) {
      case 'page':
      case 'open':
      case 'select':
        return tab();
      case 'tabs':
        return [await tab()];
      case 'frames':
        return [{ frameId: 0, url: page.url() }];
      case 'call':
        if (req.fn === 'fillLogin' || req.fn === 'attachFile') throw new Error('직접 부를 수 없어요');
        return handle(page, { t: 'clf', fn: req.fn, args: req.args });
      case 'settle':
        await page.waitForTimeout(200);
        return page.url();
      case 'html':
        return [{ url: page.url(), html: await page.content() }];
      case 'agent':
        return handle(page, { t: 'agent', on: req.on });
      case 'dialogs':
        return handle(page, { t: 'dialogs', since: req.since });
      case 'external':
      case 'popups':
      case 'files':
        return [];
      case 'ask':
        this.asks.push(req.questions);
        return true;
      case 'progress':
        return true;
      default:
        throw new Error(`테스트에서 안 하는 요청: ${req.op}`);
    }
  }

  kill(): void {
    this.child.kill();
  }
}
