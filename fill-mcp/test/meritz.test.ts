// 기획서 3장(메리츠 실사용)에서 드러난 문제 1~5, 8~10, 13번 재현 테스트 (P1 정확도)
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
import { renderAddRows, renderScan } from '../src/format.js';
import { field, fixtureUrl, makeDriver } from './helpers.js';

type Row = Record<string, string>;
interface FixtureState {
  apply: Record<string, string>;
  rows: Record<'HISC' | 'UNIV' | 'LCNS' | 'LANG' | 'ACT' | 'CARR', Row[]>;
  editing: string | null;
  discarded: number;
  resets: number;
  ccInput: string;
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'careerlog-meritz-'));
const cfg = loadConfig({ ...process.env, CAREERLOG_BROWSER: 'launch', CAREERLOG_HEADLESS: '1' });
const browser = new BrowserManager(cfg.browser);
const adapters = new AdapterStore(tmp);
const driver = makeDriver(browser, cfg.domBundlePath, adapters);
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('meritz/index.html'));
  await page.waitForSelector('text=고등학교');
  scan = await driver.scan();
});
after(async () => {
  await browser.shutdown();
  rmSync(tmp, { recursive: true, force: true });
});

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: FixtureState }).__fixtureState);
const addKey = (title: string) => {
  const c = scan.cards?.find((x) => x.title === title);
  if (!c?.addKey) throw new Error(`반복 섹션 없음: ${title} (${scan.cards?.map((x) => x.title).join(', ')})`);
  return c.addKey;
};

test('3: 같은 라벨의 [자동완성][글자] 두 칸은 국가번호+번호 한 항목으로 읽고, 관계 값("모")은 넣기 전에 막는다', async () => {
  const cc = scan.fields.filter((f) => f.label === '긴급 연락처');
  assert.equal(cc.length, 2);
  assert.deepEqual(
    cc.map((f) => [f.part, f.nth]),
    [
      ['1/2', undefined],
      ['2/2', undefined],
    ],
  );
  assert.match(cc[0].hint ?? '', /국가번호/);
  assert.match(renderScan(scan), /긴급 연락처" \(칸 1\/2\).*국가번호/);
  const bad = await driver.fill([{ key: cc[0].key, value: '모' }]);
  assert.equal(bad.outcomes[0].status, 'mismatch');
  assert.match(bad.outcomes[0].message ?? '', /국가번호 칸이에요/);
  assert.equal((await state()).ccInput, '', '글자를 치지 않아 모나코·모로코 후보가 뜨지 않는다');
  const good = await driver.fill([
    { key: cc[0].key, value: '+82' },
    { key: field(scan, '긴급 연락처 관계').key, value: '모' },
  ]);
  assert.deepEqual(
    good.outcomes.map((o) => o.status),
    ['ok', 'ok'],
    JSON.stringify(good.outcomes),
  );
  const s = await state();
  assert.equal(s.apply.emCc, '대한민국(+82)');
  assert.equal(s.apply.emRel, '모');
});

test('13: 사이트가 하이픈을 지운 전화번호는 성공으로 보고, 뒤 호출에서 "값이 바뀐 칸"으로 올리지 않는다', async () => {
  const phone = scan.fields.filter((f) => f.label === '긴급 연락처')[1];
  const r = await driver.fill([{ key: phone.key, value: '010-1234-5678' }]);
  assert.equal(r.outcomes[0].status, 'ok', JSON.stringify(r.outcomes));
  await page.waitForTimeout(700);
  assert.equal((await state()).apply.emPhone, '01012345678');
  const next = await driver.fill([{ key: field(scan, '이름').key, value: '홍길동' }]);
  assert.deepEqual(
    next.changedFields.map((c) => c.field.label),
    [],
    '형식만 바뀐 값은 바뀐 칸이 아니다',
  );
});

test('2: 값 동의어 — 프로필 "만기전역"을 선택지 "만기제대"로 고르고 알린다', async () => {
  const r = await driver.fill([
    { key: field(scan, '병역 구분').key, value: '군필' },
    { key: field(scan, '전역 구분').key, value: '만기전역' },
  ]);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['ok', 'ok'],
    JSON.stringify(r.outcomes),
  );
  assert.match(r.outcomes[1].message ?? '', /같은 뜻의 "만기제대"/);
  assert.equal((await state()).apply.discharge, '만기제대');
});

test('4: 자동완성 후보 접미사 — "한빛고등학교"를 같은 행의 소재지로 "(경기)" 후보에 맞춘다', async () => {
  const r = await driver.addRows(addKey('고등학교'), [{ 학교명: '한빛고등학교', 소재지: '경기', 졸업일: '2018-02-09', '졸업 구분': '졸업' }]);
  assert.equal(r.rows[0].saved, true, renderAddRows(r));
  const s = await state();
  assert.equal(s.rows.HISC[0].school, '한빛고등학교(경기) 일반고');
  assert.equal(s.rows.HISC[0].region, '경기');
});

test('1·5: 프로필 키 라벨(입학일·학점 만점)을 팝업 라벨로 맞추고, 국내/국외 토글을 먼저 넣어 다른 칸이 비지 않는다', async () => {
  const r = await driver.addRows(addKey('대학교'), [
    {
      학교명: '한국대학교',
      주전공: '정보융합소프트웨어학과',
      소재지: '세종',
      '학점 만점': '4.5',
      학점: '3.15',
      입학일: '2019-03-04',
      졸업일: '2025-02-21',
      '졸업 구분': '졸업',
      '대학교(국내/국외)': '국내',
    },
  ]);
  assert.equal(r.rows[0].saved, true, renderAddRows(r));
  assert.equal(r.rows[0].resets, undefined, '토글을 먼저 넣어서 초기화가 없다');
  const s = await state();
  assert.deepEqual(
    { ...s.rows.UNIV[0] },
    {
      abroad: '국내',
      school: '한국대학교(세종)',
      major: '정보융합소프트웨어학과',
      region: '세종',
      gpaMax: '4.5',
      gpa: '3.15',
      start: '2019.03.04',
      end: '2025.02.21',
      grad: '졸업',
    },
  );
  assert.equal(s.resets, 1);
});

test('5: fill_fields에서 토글을 뒤에 보내 다른 칸이 비면, 알아채고 다시 넣은 뒤 저장한다 (어댑터에 기록)', async () => {
  const c = await driver.click(addKey('대학교'));
  assert.ok(c.modal?.editing);
  const pop = await driver.scan();
  const r = await driver.fill(
    [
      { key: field(pop, '학교명').key, value: '한국대학교 / 본교', query: '한국대학교' },
      { key: field(pop, '기준 학점').key, value: '4.5' },
      { key: field(pop, '학점').key, value: '3.8' },
      { key: field(pop, '대학교(국내/국외)').key, value: '국내' },
      { key: field(pop, '졸업 구분').key, value: '졸업예정' },
    ],
    pop.buttons.find((b) => b.kind === 'rowsave')!.key,
  );
  assert.equal(r.resets?.[0]?.by, '대학교(국내/국외)', JSON.stringify(r, null, 1));
  assert.deepEqual([...(r.resets?.[0]?.cleared ?? [])].sort(), ['기준 학점', '학교명', '학점'].sort());
  assert.equal(r.clicked?.closedModal, true, JSON.stringify(r, null, 1));
  const s = await state();
  assert.equal(s.rows.UNIV[1].school, '한국대학교');
  assert.equal(s.rows.UNIV[1].gpa, '3.8');
  assert.equal(s.rows.UNIV[1].gpaMax, '4.5');
  assert.equal(s.discarded, 0);
});

test('1·8: 취득일 → 취득시기, 잠긴 발행처는 사이트가 채운 값으로 "자동 채움" (오류 아님)', async () => {
  const r = await driver.addRows(addKey('자격증'), [
    { 자격증명: { value: 'SQL개발자(SQLD자격)', query: 'SQL' }, 발행처: '한국데이터산업진흥원', 취득일: '2021-12-17' },
  ]);
  assert.equal(r.rows[0].saved, true, renderAddRows(r));
  const issuer = r.rows[0].outcomes.find((o) => o.label === '발행처');
  assert.equal(issuer?.status, 'auto', JSON.stringify(r.rows[0].outcomes));
  assert.equal(issuer?.message, '사이트가 자동으로 채움');
  assert.equal(r.rows[0].partial, undefined);
  const s = await state();
  assert.deepEqual({ ...s.rows.LCNS[0] }, { name: 'SQL개발자(SQLD자격)', issuer: '한국데이터산업진흥원', date: '2021.12.17' });
});

test('2·8: 시험명 "토익" → "TOEIC", 앞에 있는 잠긴 취득시기는 응시일을 넣은 뒤 사이트가 채운 걸 다시 확인한다', async () => {
  const r = await driver.addRows(addKey('어학'), [{ 외국어: '영어', 시험명: '토익', 취득시기: '2025-05', 점수: '900', 응시일: '2025-05-11' }]);
  assert.equal(r.rows[0].saved, true, renderAddRows(r));
  const month = r.rows[0].outcomes.find((o) => o.label === '취득시기');
  assert.equal(month?.status, 'auto', JSON.stringify(r.rows[0].outcomes));
  assert.equal(month?.actual, '2025.05');
  const s = await state();
  assert.equal(s.rows.LANG[0].test, 'TOEIC');
  assert.equal(s.rows.LANG[0].month, '2025.05');
});

test('10: 뒤 칸을 골라 풀린 퇴직사유는 다시 넣고, 끝내 잠긴 연봉은 "부분 저장"으로 보고한다', async () => {
  const r = await driver.addRows(addKey('경력사항'), [
    {
      회사명: '가나소프트',
      고용형태: '인턴',
      퇴직사유: '계약만료',
      '재직 상태': '퇴직',
      입사일: '2024-07-01',
      퇴사일: '2024-12-31',
      담당업무: '품질 데이터 분석',
      연봉: '3000',
    },
  ]);
  assert.equal(r.rows[0].saved, true, renderAddRows(r));
  const s = await state();
  assert.equal(s.rows.CARR[0].reason, '계약만료');
  assert.equal(s.rows.CARR[0].desc, '품질 데이터 분석');
  assert.equal(s.rows.CARR[0].empType, '인턴');
  assert.deepEqual(r.rows[0].partial?.map((p) => p.split(' ')[0]), ['연봉']);
  assert.match(renderAddRows(r), /부분 저장 — 보낸 값이 안 들어간 칸: 연봉/);
});

test('9: 추가 버튼이 아무 반응이 없으면 최대 개수로 판단하고, 넣지 못한 행을 돌려준다 (어댑터에 학습)', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ 활동명: `활동 ${i + 1}`, '활동기간(시작일)': `2024-0${i + 1}-01` }));
  const r = await driver.addRows(addKey('학내외활동사항'), rows);
  assert.equal(r.rows.filter((x) => x.saved).length, 5, renderAddRows(r));
  assert.equal(r.maxRows, 5);
  assert.deepEqual(r.skippedRows, [6]);
  assert.match(r.stopped ?? '', /최대 5개/);
  assert.equal((await state()).rows.ACT.length, 5);
});

test('P2: 배운 것(라벨 매핑·팝업 칸·최대 개수·초기화 칸)이 어댑터에 남고, 다음 스캔에 보인다', async () => {
  const a = adapters.lookup(page.url());
  assert.equal(a?.sections?.['학내외활동사항']?.maxRows, 5);
  assert.equal(a?.sections?.['자격증']?.labels?.['취득일'], '취득시기');
  assert.equal(a?.sections?.['대학교']?.labels?.['학점 만점'], '기준 학점');
  assert.ok(a?.sections?.['대학교']?.fields?.includes('재학기간(시작일)'));
  assert.deepEqual(a?.sections?.['대학교']?.order, ['대학교(국내/국외)']);
  // 새 드라이버(다음 채우기)도 같은 파일에서 읽는다
  const fresh = new AdapterStore(tmp);
  const text = renderScan({ ...(await driver.scan()), adapter: fresh.lookup(page.url()) });
  assert.match(text, /이 사이트에서 배운 것/);
  assert.match(text, /학내외활동사항: .*최대 5개/);
  assert.match(text, /"대학교\(국내\/국외\)"을\(를\) 넣으면 .*학교명/);
  // 최대 개수를 알고 있으면 추가 버튼을 눌러 보지 않고 바로 멈춘다
  const again = makeDriver(browser, cfg.domBundlePath, fresh);
  const s2 = await again.scan();
  const r = await again.addRows(s2.cards!.find((c) => c.title === '학내외활동사항')!.addKey!, [{ 활동명: '더' }]);
  assert.equal(r.rows.length, 0);
  assert.match(r.stopped ?? '', /어댑터에 배운 최대 개수/);
});

test('wait_for_user: 사용자가 칸을 바꾸면 기다림을 끝내고 바뀐 칸을 돌려준다', async () => {
  const name = field(await driver.scan(), '이름');
  const waiting = driver.waitForUser({ reason: '이름을 고쳐 주세요', keys: [name.key], timeoutSec: 20 });
  await page.waitForTimeout(800);
  await page.getByLabel('이름').fill('홍길동2');
  const r = await waiting;
  assert.equal(r.timedOut, false);
  assert.match(r.changes.join(' '), /값이 바뀜: "홍길동2"/);
});
