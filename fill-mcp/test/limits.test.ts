// 개수·글자 수·바이트 제한과 번호 칸(수험번호) 처리
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { looksSensitiveValue } from '../src/dom/safety.js';
import type { ScanResult } from '../src/driver.js';
import { button, field, fixtureUrl, setup } from './helpers.js';

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('limits.html'));
  scan = await driver.scan();
});
after(() => browser.shutdown());

const value = (name: string, i = 0) =>
  page.evaluate(([n, idx]) => (document.querySelectorAll(`[name="${n}"]`)[idx as number] as HTMLInputElement).value, [name, i] as const);

const CAMPUNG =
  '위치기반 캠퍼스 커뮤니티 앱 개발. 5인 팀에서 GeoHash 기반 실시간 위치 알림 백엔드와 QuadTree 지도 마커 클러스터링(500개 마커 60fps 유지)을 담당했습니다.';

test('활동내용처럼 큰 칸은 자소서가 아니고, 자기소개서 문항만 수동', () => {
  const act = field(scan, '활동내용');
  assert.equal(act.kind, 'textarea');
  assert.equal(act.manual, undefined);
  assert.equal(act.maxLength, 300);
  assert.match(act.hint ?? '', /300자/);
  assert.equal(scan.fields.filter((f) => f.manual === 'essay').length, 1);
});

test('고정 칸 수는 행 번호로, 제한은 섹션 이름으로 보인다', () => {
  assert.deepEqual(
    scan.fields.filter((f) => f.label === '기술명').map((f) => f.nth),
    [1, 2, 3, 4, 5],
  );
  assert.match(field(scan, '기술명', 1).section ?? '', /최대 5개/);
  assert.deepEqual(field(scan, '수준', 1).options, ['상', '중', '하']);
});

test('maxlength를 넘는 값은 넣지 않고 줄여 달라고 돌려준다', async () => {
  const key = field(scan, '내용 (100자 이내)').key;
  const r1 = await driver.fill([{ key, value: `${CAMPUNG}!` }]);
  assert.equal(r1.outcomes[0].status, 'mismatch');
  assert.match(r1.outcomes[0].message ?? '', /글자 수 초과: 최대 100자인데 101자/);
  assert.equal(await value('awardDesc'), '', '넘치는 값은 들어가지 않는다');
  const r2 = await driver.fill([{ key, value: CAMPUNG }]); // 정확히 100자
  assert.equal(r2.outcomes[0].status, 'ok', JSON.stringify(r2.outcomes[0]));
});

test('바이트 카운터는 사이트가 센 값으로 확인한다', async () => {
  const key = field(scan, '한 줄 요약').key;
  const long = await driver.fill([{ key, value: CAMPUNG }]);
  assert.equal(long.outcomes[0].status, 'mismatch');
  assert.match(long.outcomes[0].message ?? '', /카운터 초과 \(\d+\/100byte\)/);
  // 에이전트가 넣은 칸이라 줄인 값으로 다시 넣을 수 있다
  const short = await driver.fill([{ key, value: 'GeoHash 실시간 위치 알림, QuadTree 마커 클러스터링 담당' }]);
  assert.equal(short.outcomes[0].status, 'ok', JSON.stringify(short.outcomes[0]));
  assert.ok(Number(await page.textContent('#projBytes')) <= 100);
});

test('수험번호 칸의 16자리 숫자는 카드번호로 오인하지 않는다', async () => {
  const r = await driver.fill([{ key: field(scan, '수험번호').key, value: '1234560000000101' }]);
  assert.equal(r.outcomes[0].status, 'ok', JSON.stringify(r.outcomes[0]));
  assert.equal(looksSensitiveValue('1234560000000101', '수험번호'), false);
  assert.equal(looksSensitiveValue('123456-0000000101'), false);
  assert.equal(looksSensitiveValue('4111 1111 1111 1111', '한 줄 요약'), true, 'Luhn을 통과하는 카드번호');
  assert.equal(looksSensitiveValue('980314-1234567', '수험번호'), true, '주민번호는 어느 칸이든 거부');
  assert.equal(looksSensitiveValue('010-9876-5432'), false);
  assert.equal(looksSensitiveValue('12345678901G'), false);
});

test('날짜는 칸 형식(YYYYMMDD / YYYY.MM.DD)에 맞춰 넣는다', async () => {
  const r = await driver.fill([
    { key: field(scan, '생년월일').key, value: '1998-03-14' },
    { key: scan.fields.filter((f) => f.label === '복무기간')[0].key, value: '2021-04-05' },
  ]);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['ok', 'ok'],
  );
  assert.equal(await value('birth'), '19980314');
  assert.equal(await value('milStart'), '2021.04.05');
});

test('행 추가는 사이트 최대치에서 멈추고 알림 문구를 돌려준다', async () => {
  const r = await driver.click(button(scan, '+ 수상 추가'), 3);
  assert.equal(r.ok, true);
  assert.equal(await page.locator('#awards tbody tr').count(), 3);
  assert.equal(r.newFields.filter((f) => f.label === '수상명').length, 2);
  assert.ok(
    r.dialogs.some((d) => d.type === 'alert' && /최대 3개/.test(d.message)),
    JSON.stringify(r.dialogs),
  );
});
