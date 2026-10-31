// ninehire 계열(antd + 폼 빌더) 구조: aria 없는 div 드롭다운(portal 메뉴), antd Select, contenteditable 라벨,
// 고르면 나타나는 상세 칸, 같은 라벨의 반복 줄, div로 그린 주소 칸 (docs/2026-10-27-ninehire-antd-지원서-문제정리.md)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { ScanResult } from '../src/driver.js';
import { renderScan } from '../src/format.js';
import { field, fixtureUrl, setup } from './helpers.js';

interface FixtureState {
  f: Record<string, string | boolean>;
  submitted: boolean;
  saved: number;
  postcodeOpened: number;
}

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('antd.html'));
  scan = await driver.scan();
});
after(() => browser.shutdown());

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: FixtureState }).__fixtureState);
const ok = (r: { outcomes: { status: string }[] }) => assert.deepEqual(r.outcomes.map((o) => o.status), r.outcomes.map(() => 'ok'), JSON.stringify(r.outcomes, null, 1));
const DROPDOWNS = ['지원분야', '지원경로', '성별', '보훈 대상 여부', '병역 사항', '장애 여부', '학력 구분', '어학 구분', '자격증 구분', '활용능력 구분'];

test('aria 없는 div 드롭다운(ant-dropdown-trigger)을 listbox로 읽고 portal 메뉴의 선택지를 보여 준다', async () => {
  for (const l of DROPDOWNS) assert.equal(field(scan, l).kind, 'listbox', l);
  const g = field(scan, '성별');
  assert.deepEqual(g.options, ['남', '여']);
  assert.equal(g.placeholder, '선택해주세요.');
  assert.equal(g.value, undefined, '안내문은 값이 아니다');
  assert.deepEqual(field(scan, '병역 사항').options, ['군필', '미필', '면제', '해당없음']);
  assert.equal(field(scan, '지원분야').required, true);
  // 선택지를 읽으려고 열었던 메뉴는 닫혀 있다
  assert.equal(await page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').count(), 0);
  const s = await state();
  assert.equal(s.saved + Number(s.submitted) + s.postcodeOpened, 0, '스캔이 다른 것을 누르지 않는다');
});

test('contenteditable 라벨(EditableLabel)은 칸이 아니라 라벨로 읽는다', () => {
  assert.equal(scan.fields.filter((f) => f.kind === 'editable').length, 0, scan.fields.map((f) => `${f.kind} ${f.label}`).join('\n'));
  const labels = scan.fields.map((f) => f.label);
  for (const l of ['이름', '영문이름', '휴대폰 번호', '이메일']) assert.ok(labels.includes(l), `${l}: ${labels.join(', ')}`);
  assert.ok(!labels.some((l) => /^내용$|선택해주세요/.test(l)), labels.join(', '));
  assert.equal(field(scan, '영문이름').nth, undefined, '각 칸은 자기 라벨');
  assert.equal(field(scan, '영문이름').placeholder, '예) HONG GILDONG');
  assert.equal(field(scan, '이름').required, true);
  assert.equal(field(scan, '지원 동기').manual, 'essay');
  assert.equal(scan.fields.find((f) => f.kind === 'checkbox')?.manual, 'consent');
});

test('div로 그린 주소 칸은 "직접 입력: 주소 검색 팝업"으로 표시하고 넣지 않는다', async () => {
  const zip = field(scan, '주소 › 우편번호');
  const road = field(scan, '주소 › 도로명주소');
  assert.equal(zip.manual, 'address');
  assert.equal(road.manual, 'address', '클래스 단서 없이 주소 라벨 + 입력 칸 모양으로도 안다');
  const detail = field(scan, '주소');
  assert.equal(detail.placeholder, '상세주소');
  assert.equal(detail.manual, undefined, '상세주소는 진짜 input이라 채울 수 있다');
  const text = renderScan(scan);
  assert.match(text, /주소 › 우편번호.*직접 입력: 주소 검색 팝업/);
  const r = await driver.fill([{ key: zip.key, value: '06236' }]);
  assert.equal(r.outcomes[0].status, 'refused');
  assert.match(r.outcomes[0].message ?? '', /주소 검색/);
  assert.equal((await state()).postcodeOpened, 0, '팝업을 띄우지 않는다');
});

test('div 드롭다운을 고르고, 고르면 나타나는 학력 상세 칸을 새 칸으로 돌려준다 (antd Select 포함)', async () => {
  const r = await driver.fill([
    { key: field(scan, '지원분야').key, value: '백엔드 개발' },
    { key: field(scan, '성별').key, value: '남' },
    { key: field(scan, '병역 사항').key, value: '군필' },
    { key: field(scan, '보훈 대상 여부').key, value: '비대상' },
    { key: field(scan, '학력 구분').key, value: '대학교(4년)' },
  ]);
  ok(r);
  const s = await state();
  assert.deepEqual([s.f.field, s.f.gender, s.f.military, s.f.veteran, s.f.eduLevel], ['백엔드 개발', '남', '군필', '비대상', '대학교(4년)']);
  const added = r.newFields.map((f) => f.label);
  for (const l of ['학교명', '전공', '학위', '입학년월', '졸업년월']) assert.ok(added.includes(l), `${l}: ${added.join(', ')}`);
  const degree = r.newFields.find((f) => f.label === '학위')!;
  assert.equal(degree.kind, 'listbox', 'antd Select의 readonly combobox input이 아니라 선택 상자로 읽는다');
  assert.deepEqual(degree.options, ['학사', '석사', '박사'], '접근성용 0px 목록이 아니라 보이는 선택지');
  const r2 = await driver.fill([
    { key: r.newFields.find((f) => f.label === '학교명')!.key, value: '한국대학교' },
    { key: degree.key, value: '학사' },
    { key: r.newFields.find((f) => f.label === '입학년월')!.key, value: '2019-03' },
  ]);
  ok(r2);
  assert.deepEqual([(await state()).f.school, (await state()).f.degree, (await state()).f.eduStart], ['한국대학교', '학사', '2019.03']);
  scan = await driver.scan();
  assert.equal(field(scan, '성별').value, '남', '고른 값은 칸 값으로, 안내문은 placeholder로 남는다');
  assert.equal(field(scan, '성별').placeholder, '선택해주세요.');
  assert.equal(field(scan, '학위').value, '학사');
  assert.equal(await page.locator('.ant-dropdown:not(.ant-dropdown-hidden), .ant-select-dropdown:not(.ant-select-dropdown-hidden)').count(), 0);
});

test('같은 라벨이 반복되는 줄은 #1, #2로, 표 모양 라벨 줄은 칸마다 제 라벨로 읽는다', async () => {
  const r = await driver.fill([
    { key: field(scan, '자격증 구분').key, value: '있음' },
    { key: field(scan, '활용능력 구분').key, value: '있음' },
    { key: field(scan, '어학 구분').key, value: '있음' },
  ]);
  ok(r);
  scan = await driver.scan();
  const certs = scan.fields.filter((f) => f.label === '자격증명');
  assert.deepEqual(certs.map((f) => f.nth), [1, 2]);
  assert.deepEqual(scan.fields.filter((f) => f.label === '취득일' && f.section === '자격증').map((f) => f.nth), [1, 2]);
  const labels = scan.fields.map((f) => f.label);
  for (const l of ['프로그램', '활용 수준', '사용 기간', '시험명', '점수']) assert.ok(labels.includes(l), `${l}: ${labels.join(', ')}`);
  assert.ok(!labels.some((l) => /활용 수준 사용 기간|프로그램 활용/.test(l)), labels.join(', '));
  assert.equal(field(scan, '활용 수준').kind, 'listbox');
  assert.equal(field(scan, '시험명').kind, 'listbox');
  const r2 = await driver.fill([
    { key: certs[1].key, value: '정보처리기사' },
    { key: field(scan, '활용 수준').key, value: '상' },
    { key: field(scan, '사용 기간').key, value: '2년' },
    { key: field(scan, '시험명').key, value: 'OPIc' },
  ]);
  ok(r2);
  const s = await state();
  assert.deepEqual([s.f.cert1, s.f.cert2, s.f.skillLevel, s.f.skillPeriod, s.f.langTest], [undefined, '정보처리기사', '상', '2년', 'OPIc']);
  assert.equal(s.submitted, false);
});
