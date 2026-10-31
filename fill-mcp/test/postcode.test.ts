// P5 외부 연동: 다음 우편번호 검색(레이어 iframe·팝업 창), YBM·OPIc 감지와 결과 재확인
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { AdapterStore } from '../src/adapters.js';
import { BrowserManager } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import type { ScanResult } from '../src/driver.js';
import { renderAddress, renderScan } from '../src/format.js';
import { button, field, fixtureUrl, makeDriver } from './helpers.js';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'careerlog-postcode-'));
const cfg = loadConfig({ ...process.env, CAREERLOG_BROWSER: 'launch', CAREERLOG_HEADLESS: '1' });
const browser = new BrowserManager(cfg.browser);
const adapters = new AdapterStore(tmp);
const driver = makeDriver(browser, cfg.domBundlePath, adapters);
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('postcode.html'));
  scan = await driver.scan();
});
after(async () => {
  await browser.shutdown();
  rmSync(tmp, { recursive: true, force: true });
});

test('외부 연동 버튼(YBM·OPIc)을 찾아 결과가 들어올 칸과 함께 알려 주고, 어댑터에 적어 둔다', () => {
  const names = scan.external?.map((e) => e.name) ?? [];
  assert.ok(names.some((n) => n.startsWith('YBM')), names.join(', '));
  assert.ok(names.some((n) => n.startsWith('OPIc')), names.join(', '));
  const ybm = scan.external!.find((e) => e.name.startsWith('YBM'))!;
  assert.equal(ybm.button, button(scan, 'YBM 성적 불러오기'));
  assert.deepEqual(ybm.watch, [field(scan, 'TOEIC 점수').key, field(scan, '응시일').key]);
  assert.match(renderScan(scan), /외부 연동 \(자동으로 하지 않음/);
  assert.ok(Object.keys(adapters.lookup(page.url())?.sections?.['어학']?.external ?? {}).length >= 2);
});

test('주소: [우편번호 찾기] → 레이어 안 검색 화면에서 검색 → 결과가 하나면 눌러서 사이트가 칸을 채운다', async () => {
  const r = await driver.searchAddress({ query: '판교역로 166', open: button(scan, '우편번호 찾기') });
  assert.equal(r.ok, true, renderAddress(r));
  assert.match(r.picked ?? '', /13529/);
  assert.equal(await page.inputValue('#zip'), '13529');
  assert.match(await page.inputValue('#addr'), /판교역로 166/);
  assert.equal(await page.locator('#layer').count(), 0, '고르면 레이어가 닫힌다');
  assert.match(renderAddress(r), /상세주소/);
});

test('주소: 결과가 여러 개면 목록을 돌려주고 팝업을 열어 두며, pick으로 다시 부르면 그 줄을 고른다', async () => {
  const r = await driver.searchAddress({ query: '테헤란로', open: button(scan, '우편번호 찾기') });
  assert.equal(r.ok, false);
  assert.equal(r.results?.length, 2);
  assert.match(r.message ?? '', /pick/);
  assert.equal(await page.locator('#layer').count(), 1);
  const again = await driver.searchAddress({ query: '테헤란로', pick: '파르나스' });
  assert.equal(again.ok, true, renderAddress(again));
  assert.equal(await page.inputValue('#zip'), '06164');
});

test('주소: 새 창으로 열리는 검색 화면도 찾아서 고르고, 창이 닫힌다', async () => {
  const r = await driver.searchAddress({ query: '테헤란로 152', open: button(scan, '팝업으로 찾기') });
  assert.equal(r.ok, true, renderAddress(r));
  assert.equal(await page.inputValue('#zip'), '06236');
  assert.equal((await browser.allPages()).length, 1);
});

test('주소: 검색 결과가 없으면 다시 검색하라고 돌려준다', async () => {
  const r = await driver.searchAddress({ query: '없는로 999', open: button(scan, '우편번호 찾기') });
  assert.equal(r.ok, false);
  assert.match(r.message ?? '', /검색 결과가 없어요/);
  await page.evaluate(() => document.getElementById('layer')?.remove());
});

test('YBM: 사용자가 성적을 불러오면 wait_for_user가 결과 칸 값을 돌려준다 (프로필과 비교는 LLM)', async () => {
  const ybm = scan.external!.find((e) => e.name.startsWith('YBM'))!;
  await page.click('#ybm');
  const w = await driver.waitForUser({ reason: 'YBM에서 TOEIC 성적을 불러와 주세요', keys: ybm.watch, timeoutSec: 10 });
  assert.equal(w.timedOut, false);
  assert.ok(w.changes.some((c) => /905/.test(c)), w.changes.join(' / '));
});
