// ninehire 실제 구조(2026-10-27 AK아이에스 스냅샷): li·role 없는 학교 검색 메뉴, antd DatePicker(readonly), "입력사항 저장"
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { ScanResult } from '../src/driver.js';
import { classifyButtonText } from '../src/dom/safety.js';
import { button, field, fixtureUrl, setup } from './helpers.js';

interface FixtureState {
  f: Record<string, string>;
  rows: number;
  saved: number;
  submitted: boolean;
}

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('ninehire.html'));
  scan = await driver.scan();
});
after(() => browser.shutdown());

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: FixtureState }).__fixtureState);

test('"입력사항 저장"은 줄 확정(rowsave), "임시 저장"은 전체저장으로 분류한다', () => {
  assert.equal(classifyButtonText('입력사항 저장'), 'rowsave');
  assert.equal(classifyButtonText('입력 저장'), 'rowsave');
  assert.equal(classifyButtonText('임시 저장'), 'save');
  assert.equal(scan.buttons.find((b) => b.text === '입력사항 저장')?.kind, 'rowsave');
});

test('li·role 없는 div 줄 메뉴에서 학교 후보를 고르고, 직접 입력 줄은 후보로 치지 않는다', async () => {
  const r = await driver.fill([{ key: field(scan, '고등학교').key, value: '한빛고등학교', query: '한' }]);
  assert.equal(r.outcomes[0].status, 'ok', JSON.stringify(r.outcomes[0]));
  assert.equal((await state()).f.school, '한빛고등학교');
  const amb = await driver.fill([{ key: field(scan, '고등학교').key, value: '고등학교', query: '고', overwrite: true }]);
  // 검색어 강조 span 때문에 글자 사이에 공백이 낄 수 있다 (고르기는 공백을 무시하고 비교)
  assert.match((amb.outcomes[0].message ?? '').replace(/\s/g, ''), /후보가여러개:한빛고등학교,한별고등학교,수원고등학교—/);
});

test('DB에 없는 학교는 direct: true일 때 "(으)로 직접 입력하기"를 누른다', async () => {
  const r = await driver.fill([{ key: field(scan, '고등학교').key, value: '없는고등학교', query: '없는고', direct: true, overwrite: true }]);
  assert.equal(r.outcomes[0].status, 'ok', JSON.stringify(r.outcomes[0]));
  assert.equal((await state()).f.school, '없는고');
});

test('antd DatePicker(readonly 여부 무관)는 달력에서 연·월·일을 눌러 넣고, 그 뒤 입력사항 저장이 풀린다', async () => {
  await driver.fill([{ key: field(scan, '고등학교').key, value: '한빛고등학교', query: '한빛', overwrite: true }]);
  const r = await driver.fill(
    [
      { key: field(scan, '생년월일').key, value: '1998-03-14' },
      { key: field(scan, '입학년월').key, value: '2015-03-01' },
      { key: field(scan, '졸업년월').key, value: '2018-02-28' },
    ],
    button(scan, '입력사항 저장'),
  );
  assert.deepEqual(r.outcomes.map((o) => o.status), ['ok', 'ok', 'ok'], JSON.stringify(r.outcomes, null, 1));
  const s = await state();
  assert.deepEqual([s.f.birth, s.f.start, s.f.end], ['1998-03-14', '2015-03', '2018-02']);
  assert.equal(r.clicked?.error, undefined, JSON.stringify(r.clicked));
  assert.equal(s.rows, 1, '줄 저장 버튼까지 눌렀다');
  assert.equal(s.saved + Number(s.submitted), 0, '임시 저장·제출은 누르지 않는다');
  assert.equal(await page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)').count(), 0, '달력은 닫혀 있다');
});
