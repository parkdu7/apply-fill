import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserManager } from '../src/browser.js';
import { loadConfig, PACKAGE_ROOT } from '../src/config.js';
import type { Field } from '../src/dom/types.js';
import type { AdapterStore } from '../src/adapters.js';
import { PlaywrightDriver, type DomDriver, type ScanResult } from '../src/driver.js';
import { syntheticDriver } from './synthetic.js';

export const fixtureUrl = (name: string) => pathToFileURL(path.join(PACKAGE_ROOT, 'test', 'fixtures', name)).href;

/** 헤드리스 브라우저 + 드라이버. 설치된 크롬/엣지를 쓴다. */
export function setup() {
  const cfg = loadConfig({ ...process.env, CAREERLOG_BROWSER: 'launch', CAREERLOG_HEADLESS: '1' });
  const browser = new BrowserManager(cfg.browser);
  const driver = makeDriver(browser, cfg.domBundlePath);
  return { browser, driver };
}

/** CLF_SYNTHETIC=1: 확장처럼 흉내 입력만 쓰는 드라이버 (실제 마우스·키보드 없이도 되는지) */
export function makeDriver(browser: BrowserManager, domBundlePath: string, adapters?: AdapterStore): DomDriver {
  return process.env.CLF_SYNTHETIC === '1' ? syntheticDriver(browser, domBundlePath, adapters) : new PlaywrightDriver(browser, domBundlePath, adapters);
}

export function field(scan: ScanResult, label: string, nth?: number): Field {
  const f = scan.fields.find((x) => x.label === label && (nth === undefined || x.nth === nth));
  if (!f) throw new Error(`필드 없음: ${label}${nth ? ` #${nth}` : ''}\n${scan.fields.map((x) => `${x.key} ${x.label}`).join('\n')}`);
  return f;
}

export function button(scan: ScanResult, text: string): string {
  const b = scan.buttons.find((x) => x.text === text);
  if (!b) throw new Error(`버튼 없음: ${text}`);
  return b.key;
}
