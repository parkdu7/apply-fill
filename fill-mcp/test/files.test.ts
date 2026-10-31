// P3 파일 보관함: 형식·크기·발급일 확인, 숨긴 업로드 칸, 드롭 영역, 덮어쓰기 금지, add_rows 자동 첨부
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { BrowserManager } from '../src/browser.js';
import type { VaultFile } from '../src/bridge.js';
import { loadConfig } from '../src/config.js';
import type { ScanResult } from '../src/driver.js';
import { DiskFiles, fileForLabel, pickFile } from '../src/files.js';
import { renderAttach, renderScan } from '../src/format.js';
import { field, fixtureUrl, makeDriver } from './helpers.js';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'careerlog-files-'));
const vault = new DiskFiles(path.join(tmp, 'vault'));
const cfg = loadConfig({ ...process.env, CAREERLOG_BROWSER: 'launch', CAREERLOG_HEADLESS: '1' });
const browser = new BrowserManager(cfg.browser);
let driver: ReturnType<typeof makeDriver>;
let page: Page;
let scan: ScanResult;
const ids: Record<string, VaultFile> = {};

function src(name: string, bytes: number): string {
  const p = path.join(tmp, name);
  writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

const recent = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);

before(async () => {
  ids.grad = vault.add(src('졸업증명서_2026.pdf', 2000), '졸업증명서', recent);
  ids.gradOld = vault.add(src('졸업증명서_옛날.pdf', 2000), '졸업증명서(구)', old);
  ids.big = vault.add(src('큰파일.pdf', 2 * 1024 * 1024), '성적표 스캔', recent);
  ids.png = vault.add(src('사진.png', 3000), '증명사진');
  ids.port = vault.add(src('portfolio.pdf', 5000), '포트폴리오');
  ids.lcns = vault.add(src('정보처리기사.pdf', 4000), '자격증 사본');
  driver = (await import('./helpers.js')).makeDriver(browser, cfg.domBundlePath, undefined);
  // 보관함이 있는 드라이버
  const { DomDriver } = await import('../src/driver.js');
  const { PlaywrightHost } = await import('../src/pw-host.js');
  const { SyntheticHost } = await import('./synthetic.js');
  const host = process.env.CLF_SYNTHETIC === '1' ? new SyntheticHost(browser, cfg.domBundlePath) : new PlaywrightHost(browser, cfg.domBundlePath);
  driver = new DomDriver(host, undefined, vault);
  page = await browser.open(fixtureUrl('files.html'));
  scan = await driver.scan();
});
after(async () => {
  await browser.shutdown();
  rmSync(tmp, { recursive: true, force: true });
});

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: { saved: { name: string; copy: string }[]; alerts: string[]; photo: string | null } }).__fixtureState);

test('업로드 칸: 숨긴 input도 칸으로 읽고, 형식·크기·발급일 안내를 hint로, 이미 있는 파일은 값으로 보여 준다', () => {
  const files = scan.fields.filter((f) => f.manual === 'file');
  assert.deepEqual(
    files.map((f) => f.label),
    ['졸업증명서', '포트폴리오', '성적증명서', '증명사진'],
  );
  const grad = field(scan, '졸업증명서');
  assert.equal(grad.required, true);
  assert.match(grad.hint ?? '', /형식 \.pdf/);
  assert.match(grad.hint ?? '', /크기 최대 1MB/);
  assert.match(grad.hint ?? '', /발급 3개월 이내/);
  assert.equal(field(scan, '성적증명서').value, '기존_성적증명서.pdf');
  // 보관함 목록이 같이 나온다 (왕복 절약)
  assert.equal(scan.files?.length, 6);
  assert.match(renderScan(scan), /파일 보관함 \(6개/);
});

test('형식(accept)·크기·발급일이 안 맞으면 넣지 않고 이유를 돌려준다', async () => {
  const key = field(scan, '졸업증명서').key;
  const r = await driver.attach([
    { key, file: ids.png.id },
    { key, file: ids.big.id },
    { key, file: ids.gradOld.id },
  ]);
  assert.deepEqual(
    r.results.map((x) => x.ok),
    [false, false, false],
  );
  assert.match(r.results[0].message ?? '', /\.pdf 형식만/);
  assert.match(r.results[1].message ?? '', /크기 제한/);
  assert.match(r.results[2].message ?? '', /발급일.*오래/);
  assert.equal(await page.evaluate(() => (document.getElementById('f-grad') as HTMLInputElement).files?.length), 0);
});

test('맞는 파일은 DataTransfer로 넣고 페이지에 보이는 이름까지 확인한다 (종류 이름으로도 고른다)', async () => {
  const r = await driver.attach([{ key: field(scan, '졸업증명서').key, file: '졸업증명서' }]);
  assert.equal(r.results[0].ok, true, r.results[0].message);
  assert.equal(r.results[0].shown, '졸업증명서_2026.pdf');
  assert.equal(await page.textContent('#grad .name'), '졸업증명서_2026.pdf');
  assert.match(renderAttach(r), /성공 1/);
});

test('숨긴 input + 라벨 버튼(커스텀 업로드)도 넣는다', async () => {
  const r = await driver.attach([{ key: field(scan, '포트폴리오').key, file: ids.port.id.slice(0, 8) }]);
  assert.equal(r.results[0].ok, true, r.results[0].message);
  assert.equal(await page.textContent('#port .name'), 'portfolio.pdf');
});

test('이미 파일이 있는 칸은 덮어쓰지 않는다', async () => {
  const r = await driver.attach([{ key: field(scan, '성적증명서').key, file: ids.grad.id }]);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].message ?? '', /덮어쓰지 않아요/);
  assert.equal(await page.evaluate(() => (document.getElementById('f-trans') as HTMLInputElement).files?.[0]?.name), '기존_성적증명서.pdf');
});

test('change를 안 듣는 드롭 영역은 드롭 이벤트로 넣는다', async () => {
  const r = await driver.attach([{ key: field(scan, '증명사진').key, file: '증명사진' }]);
  assert.equal(r.results[0].ok, true, r.results[0].message);
  assert.equal((await state()).photo, '사진.png');
});

test('add_rows: 팝업의 필수 업로드 칸은 라벨과 보관함 종류가 하나만 맞으면 자동으로 붙이고 저장한다', async () => {
  const add = scan.buttons.find((b) => b.text === '추가하기')!.key;
  const r = await driver.addRows(add, [{ 자격증명: '정보처리기사' }]);
  assert.equal(r.stopped, undefined, JSON.stringify(r));
  assert.equal(r.rows[0].saved, true);
  assert.deepEqual(r.rows[0].attached, ['자격증 사본 ← 정보처리기사.pdf']);
  assert.deepEqual((await state()).saved, [{ name: '정보처리기사', copy: '정보처리기사.pdf' }]);
});

test('보관함 파일 고르기: id·앞 8자·종류·이름, 여러 개면 되묻기, 자동 첨부는 하나만 맞을 때만', () => {
  const list = Object.values(ids);
  assert.equal(pickFile(list, ids.port.id.slice(0, 8)).file?.name, 'portfolio.pdf');
  assert.equal(pickFile(list, '증명사진').file?.name, '사진.png');
  assert.match(pickFile(list, '졸업').error ?? '', /여러 개/);
  assert.equal(fileForLabel(list, '자격증 사본 첨부')?.name, '정보처리기사.pdf');
  assert.equal(fileForLabel(list, '졸업증명서'), undefined, '졸업증명서·졸업증명서(구) 둘 다 맞으면 자동으로 안 붙인다');
});
