// careerlink 실제 지원서 구조(편집 팝업 + 저장하기, DB 자동완성, 토글, 아이콘 체크)를 흉내 낸 페이지
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { ScanResult } from '../src/driver.js';
import { field, fixtureUrl, setup } from './helpers.js';

interface FixtureState {
  apply: Record<string, unknown>;
  rows: Record<'HISC' | 'UNIV' | 'LCNS' | 'EXPC', Record<string, string>[]>;
  editing: string | null;
  discarded: number;
  saved: number;
  submitted: boolean;
}

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('careerlink/index.html'));
  await page.waitForSelector('text=고등학교');
  scan = await driver.scan();
});
after(() => browser.shutdown());

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: FixtureState }).__fixtureState);
const addKey = (title: string) => {
  const c = scan.cards?.find((x) => x.title === title);
  if (!c?.addKey) throw new Error(`반복 섹션 없음: ${title} (${scan.cards?.map((x) => x.title).join(', ')})`);
  return c.addKey;
};

test('섹션은 카드 머리글에서, 추가 버튼은 반복 섹션으로 묶어서 보여준다', () => {
  assert.equal(field(scan, '지원 직무').section, '지원정보');
  assert.equal(field(scan, '휴대폰 번호').section, '인적정보');
  assert.deepEqual(
    scan.cards?.map((c) => [c.title, c.rows.length]),
    [
      ['고등학교', 0],
      ['대학교', 0],
      ['자격사항', 0],
      ['경험사항', 0],
    ],
  );
  const adds = scan.buttons.filter((b) => b.kind === 'add');
  assert.deepEqual(
    adds.map((b) => [b.text, b.section]),
    [
      ['추가', '고등학교'],
      ['추가', '대학교'],
      ['추가', '자격사항'],
      ['추가', '경험사항'],
    ],
  );
});

test('아이콘으로 그린 체크(가산점)도 칸으로 읽고 넣는다', async () => {
  const d = field(scan, '장애 여부');
  assert.equal(d.kind, 'checkbox');
  assert.equal(d.value, 'false');
  const r = await driver.fill([{ key: field(scan, '보훈 대상 여부').key, value: 'true' }]);
  assert.equal(r.outcomes[0].status, 'ok', JSON.stringify(r.outcomes[0]));
  assert.equal((await state()).apply.veteran, true);
  await driver.fill([{ key: field(scan, '보훈 대상 여부').key, value: 'false' }]);
  assert.equal((await state()).apply.veteran, false);
});

test('add_rows: 팝업 열고 → 라벨로 채우고 → 저장하기까지 한 번에 (동의어 라벨, 토글, 자동완성 검색어)', async () => {
  const r = await driver.addRows(addKey('대학교'), [
    {
      학교명: { value: '한국대학교(세종)', query: '한국대학교' },
      주전공: '정보융합소프트웨어학과',
      '부전공 구분': '해당없음',
      '졸업 구분': '졸업',
      입학일: '2019-03-01',
      졸업일: '2025-02-28',
      만점: '4.5',
      학점: '3.15',
      '주/야간': '주간',
      '편입 여부': '신규입학',
    },
  ]);
  assert.equal(r.rows[0]?.saved, true, JSON.stringify(r, null, 1));
  const s = await state();
  assert.equal(s.discarded, 0, '팝업이 저장 없이 닫힌 적이 없다 (Escape 사용 안 함)');
  assert.deepEqual(
    { ...s.rows.UNIV[0] },
    {
      abroad: '국내',
      school: '한국대학교(세종)',
      major: '정보융합소프트웨어학과',
      minorType: '해당없음',
      region: '세종',
      gpaMax: '4.5',
      gpa: '3.15',
      grad: '졸업',
      start: '2019.03.01',
      end: '2025.02.28',
      dayNight: '주간',
      campus: '분교',
      entry: '신규입학',
    },
  );
  assert.equal(r.savedRows?.rows.length, 1, '저장된 행 목록을 다시 읽어 돌려준다');
});

test('자동완성 후보가 여러 개면 고르지 않고 후보를 돌려준다 → 고쳐서 then_click으로 저장', async () => {
  const r = await driver.addRows(addKey('대학교'), [{ 학교명: '한국대학교', 주전공: '컴퓨터학과', '졸업 구분': '졸업', 입학일: '2015-03-02', 졸업일: '2019-02-28' }]);
  assert.equal(r.rows[0].saved, false);
  const school = r.rows[0].outcomes.find((o) => o.label === '학교명');
  assert.equal(school?.status, 'mismatch');
  assert.match(school?.message ?? '', /후보가 여러 개: 한국대학교 \/ 본교, 한국대학교\(세종\) \/ 분교/);
  assert.ok(r.openFields?.length && r.saveKey, '팝업을 열어 둔 채 칸 목록과 저장 키를 준다');
  assert.equal((await state()).editing, 'UNIV');

  const key = r.openFields!.find((f) => f.label === '학교명')!.key;
  const fixed = await driver.fill([{ key, value: '한국대학교 / 본교', query: '한국대학교' }], r.saveKey);
  assert.equal(fixed.clicked?.closedModal, true, JSON.stringify(fixed, null, 1));
  const s = await state();
  assert.equal(s.rows.UNIV[1].campus, '본교');
  assert.equal(s.discarded, 0);
});

test('DB에 없는 이름은 direct로 "직접입력", 잠긴 칸(자동 입력된 발행기관)은 건드리지 않는다', async () => {
  const r = await driver.addRows(addKey('자격사항'), [
    { 자격증명: 'SQLD', 취득일: '2021-12-17', 자격번호: 'SQLD-012345678', 발행처: '아무거나' },
    { 자격증명: { value: '가나소프트 사내 품질자격', direct: true }, 발행처: '주식회사 가나소프트', 취득일: '2024-11-22' },
  ]);
  assert.deepEqual(
    r.rows.map((x) => x.saved),
    [true, true],
    JSON.stringify(r, null, 1),
  );
  const s = await state();
  assert.equal(s.rows.LCNS[0].name, 'SQL개발자(SQLD자격)');
  assert.equal(s.rows.LCNS[0].issuer, '한국데이터산업진흥원', '자동으로 채워지고 잠긴 칸은 그대로');
  assert.equal(s.rows.LCNS[1].name, '가나소프트 사내 품질자격');
  assert.equal(s.rows.LCNS[1].issuer, '주식회사 가나소프트');
});

test('필수 칸이 비면 저장하지 않고 멈춘다', async () => {
  const r = await driver.addRows(addKey('고등학교'), [{ 학교명: '한빛고등학교' }]);
  assert.equal(r.rows[0].saved, false);
  assert.match(r.stopped ?? '', /필수인데 빈 칸: .*졸업 구분/);
  const fix = r.openFields!;
  const done = await driver.fill(
    [
      { key: fix.find((f) => f.label === '졸업 구분')!.key, value: '졸업' },
      { key: fix.find((f) => f.label === '졸업일')!.key, value: '2018-02-28' },
    ],
    r.saveKey,
  );
  assert.equal(done.clicked?.closedModal, true, JSON.stringify(done, null, 1));
  assert.equal((await state()).rows.HISC[0].end, '2018.02.28');
});

test('최대 개수 안내창이 뜨면 그 행에서 멈추고 안내문을 돌려준다', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ 경험구분: '수상내역', 경험단체명: `수상 ${i + 1}`, '경험기간(시작일)': `2025-0${i + 1}-01` }));
  const r = await driver.addRows(addKey('경험사항'), rows);
  assert.equal(r.rows.filter((x) => x.saved).length, 5);
  assert.match(r.notices.join(' '), /최대 등록 가능한 개수는 5개/);
  const s = await state();
  assert.equal(s.rows.EXPC.length, 5);
  assert.equal(s.editing, null, '안내창은 확인을 눌러 닫았다');
});

test('저장된 행은 반복 섹션 요약에 수정 키와 함께 보이고, 제출은 막힌다', async () => {
  const again = await driver.scan();
  const univ = again.cards?.find((c) => c.title === '대학교');
  assert.equal(univ?.rows.length, 2);
  assert.ok(univ?.rows.every((r) => r.editKey));
  assert.match(univ?.rows[0].text ?? '', /한국대학교\(세종\)/);
  const submit = again.buttons.find((b) => b.text === '최종제출');
  assert.equal(submit?.kind, 'blocked');
  const c = await driver.click(submit!.key);
  assert.equal(c.ok, false);
  assert.equal((await state()).submitted, false);
});
