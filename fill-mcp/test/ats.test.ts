// kt.recruiter.co.kr(ats- 디자인 시스템) 구조: aria 없는 버튼 드롭다운, 실제 키 입력에만 반응하는 검색 칸,
// 색으로만 고른 표시를 하는 버튼 묶음, 팝업 없이 펼쳐지는 "추가하기" (docs/2026-10-22-KT-IS-지원서-문제정리.md)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { ScanResult } from '../src/driver.js';
import { renderScan } from '../src/format.js';
import { field, fixtureUrl, setup } from './helpers.js';

interface FixtureState {
  f: Record<string, string>;
  registered: string[];
  majors: { name: string; field: string; gpa: string }[];
  extraRows: Record<string, number>;
  saved: number;
  submitted: boolean;
  tab: string;
}

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('ats.html'));
  scan = await driver.scan();
});
after(() => browser.shutdown());

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: FixtureState }).__fixtureState);
const ok = (r: { outcomes: { status: string }[] }) => assert.deepEqual(r.outcomes.map((o) => o.status), r.outcomes.map(() => 'ok'), JSON.stringify(r.outcomes, null, 1));

test('aria 없는 버튼 드롭다운을 listbox로 읽고, 선택지를 칸에 보여 준다 (1-1, 1-3)', async () => {
  const rel = field(scan, '긴급연락처 › 관계');
  assert.equal(rel.kind, 'listbox');
  assert.deepEqual(rel.options, ['부', '모', '형제자매', '배우자', '기타']);
  assert.equal(rel.placeholder, '관계');
  assert.equal(rel.value, undefined, '안내문은 값이 아니다');
  assert.equal(field(scan, '지원경로').kind, 'listbox');
  assert.equal(field(scan, '학업성적 › 만점기준').kind, 'listbox');
  // 앞 칸을 골라야 풀리는 드롭다운도 같은 모양이라 드롭다운으로 안다
  assert.equal(field(scan, '지원분야 › 희망직무').manual, 'disabled');
  assert.equal(field(scan, '학교정보 › 학교소재지').kind, 'listbox');
  // 드롭다운 버튼과 선택지 버튼은 버튼 목록에 나오지 않는다
  const texts = scan.buttons.map((b) => b.text);
  for (const t of ['관계', '분야', '지원경로를 선택해주세요.', '부', '모', '군필', '졸업예정']) assert.ok(!texts.includes(t), `버튼으로 나오면 안 됨: ${t}`);
  // 선택지를 읽으려고 열었던 목록은 닫혀 있다
  assert.equal(await page.locator('#dropdown-body').count(), 0);
  const s = await state();
  assert.equal(s.saved + Number(s.submitted) + s.extraRows.경력기술서 + s.extraRows.포트폴리오, 0, '스캔이 다른 버튼을 누르지 않는다');
});

test('라벨은 버튼 글자가 아니라 줄 라벨 + placeholder 이름 (1-8)', () => {
  const labels = scan.fields.map((f) => f.label);
  assert.ok(labels.includes('장애여부 › 장애등록번호'), labels.join(', '));
  assert.ok(labels.includes('보훈여부 › 보훈번호'));
  assert.ok(labels.includes('재학기간 › 입학일') && labels.includes('재학기간 › 졸업일'));
  assert.ok(!labels.some((l) => /비대상|선택해주세요/.test(l)), labels.join(', '));
  assert.equal(field(scan, '학교명').kind, 'combobox');
  assert.deepEqual(field(scan, '성별').options, ['남', '여'], '선택지마다 name이 달라도 같은 fieldset이면 한 묶음');
});

test('버튼 묶음은 toggle로 읽고 fill_fields로 넣는다. 고른 값은 색으로 읽는다 (1-9)', async () => {
  const mil = field(scan, '병역');
  assert.equal(mil.kind, 'toggle');
  assert.deepEqual(mil.options, ['비대상', '군필', '미필', '면제', '복무중']);
  assert.equal(field(scan, '학교정보 › 본교/분교').manual, 'disabled');
  const r = await driver.fill([
    { key: field(scan, '장애여부').key, value: '비대상' },
    { key: field(scan, '보훈여부').key, value: '비대상' },
    { key: field(scan, '학위구분').key, value: '학사' },
    { key: field(scan, '졸업구분').key, value: '졸업예정' },
    { key: field(scan, '학교정보 › 주간/야간').key, value: '주간' },
  ]);
  ok(r);
  const s = await state();
  assert.deepEqual([s.f.disability, s.f.veteran, s.f.degree, s.f.grad, s.f.dayNight], ['비대상', '비대상', '학사', '졸업예정', '주간']);
  scan = await driver.scan();
  assert.equal(field(scan, '졸업구분').value, '졸업예정', '클래스·aria 없이 생김새로 고른 버튼을 읽는다');
  assert.equal(field(scan, '장애여부').value, '비대상');
  // 비활성 버튼(본교/분교)은 누르지 않고 이유를 알려 준다
  const campus = await driver.fill([{ key: field(scan, '학교정보 › 본교/분교').key, value: '분교' }]);
  assert.equal(campus.outcomes[0].status, 'refused');
  assert.equal((await state()).f.campus, undefined);
});

test('fill_fields 한 번에 드롭다운까지: 앞 칸을 골라 풀린 칸도 이어서 넣는다', async () => {
  const r = await driver.fill([
    { key: field(scan, '이름').key, value: '김지원' },
    { key: field(scan, '생년월일').key, value: '2000-07-21' },
    { key: field(scan, '성별').key, value: '여' },
    { key: field(scan, '긴급연락처 › 관계').key, value: '모' },
    { key: field(scan, '지원분야').key, value: 'IT' },
    { key: field(scan, '지원분야 › 희망직무').key, value: '데이터분석' },
    { key: field(scan, '지원경로').key, value: '채용 홈페이지' },
    { key: field(scan, '학업성적').key, value: '4.1' },
    { key: field(scan, '학업성적 › 만점기준').key, value: '4.5' },
  ]);
  ok(r);
  const s = await state();
  assert.deepEqual([s.f.name, s.f.birth, s.f.gender, s.f.relation, s.f.field, s.f.job, s.f.route, s.f.gpa, s.f.gpaMax], [
    '김지원',
    '2000.07.21',
    'F',
    '모',
    'IT',
    '데이터분석',
    '채용 홈페이지',
    '4.1',
    '4.5',
  ]);
  scan = await driver.scan();
  assert.equal(field(scan, '지원분야 › 희망직무').value, '데이터분석');
  assert.equal(field(scan, '긴급연락처 › 관계').value, '모');
});

test('목록 안에 검색 칸이 있는 드롭다운(국적)은 실제 키 입력으로 검색해서 고른다', async () => {
  const nat = field(scan, '국적');
  assert.ok(!nat.options?.includes('대한민국'), '처음 목록에는 앞쪽 몇 개만 있다');
  const r = await driver.fill([{ key: nat.key, value: '대한민국' }]);
  ok(r);
  assert.equal((await state()).f.nationality, '대한민국');
});

test('검색형 칸: DOM으로 넣은 글자만으로는 성공이 아니다 (1-2)', async () => {
  const r = await driver.fill([{ key: field(scan, '학교명').key, value: '한국대학교', method: 'dom' }]);
  assert.notEqual(r.outcomes[0].status, 'ok', JSON.stringify(r.outcomes[0]));
  const s = await state();
  assert.equal(s.f.school ?? '', '');
  assert.deepEqual(s.registered, []);
});

test('검색형 칸: 실제 키 입력 → 결과가 바뀌길 기다려 후보 클릭 → 의존 칸이 풀려야 성공 (1-2)', async () => {
  const r = await driver.fill([{ key: field(scan, '학교명').key, value: '한국대학교' }]);
  ok(r);
  const s = await state();
  assert.equal(s.f.school, '한국대학교', JSON.stringify(r.outcomes));
  assert.equal(s.f.region, '서울', '학교를 고르면 소재지가 채워진다');
  assert.deepEqual(s.registered, [], '"등록하기"는 누르지 않는다');
  // 학교를 골라 풀린 본교/분교를 이어서 넣는다 (스캔 때 비활성이었어도)
  const campus = await driver.fill([{ key: field(scan, '학교정보 › 본교/분교').key, value: '본교' }]);
  ok(campus);
  assert.equal((await state()).f.campus, '본교');
});

test('목록에 없는 이름: "\'검색어\' 등록하기"는 direct: true일 때만 누른다', async () => {
  const key = field(scan, '학교명').key;
  const r = await driver.fill([{ key, value: '한국가상대학교' }]);
  assert.equal(r.outcomes[0].status, 'mismatch');
  assert.match(r.outcomes[0].message ?? '', /검색 결과가 없음|선택지에 없음/);
  assert.deepEqual((await state()).registered, []);
  const d = await driver.fill([{ key, value: '한국가상대학교', direct: true }]);
  ok(d);
  assert.deepEqual((await state()).registered, ['한국가상대학교']);
});

test('버튼을 누른 뒤 다른 칸 값이 바뀌면 알려 준다 (1-5)', async () => {
  const r = await driver.fill([{ key: field(scan, '병역').key, value: '군필' }]);
  ok(r);
  const labels = r.newFields.map((f) => f.label);
  assert.ok(labels.includes('병역 › 입대일') && labels.includes('병역 › 제대일'), labels.join(', '));
  assert.ok(labels.includes('병역 › 병과'), `버튼 글자("군별을 선택해주세요.")가 아니라 placeholder 이름: ${labels.join(', ')}`);
  assert.ok(labels.includes('병역 › 군별') && r.newFields.find((f) => f.label === '병역 › 군별')?.kind === 'listbox');
  scan = await driver.scan();
  ok(
    await driver.fill([
      { key: field(scan, '병역 › 입대일').key, value: '2021.04' },
      { key: field(scan, '병역 › 제대일').key, value: '2022.10' },
    ]),
  );
  const b = scan.buttons.find((x) => x.text === '18 개월');
  assert.ok(b, scan.buttons.map((x) => x.text).join(', '));
  const c = await driver.click(b.key);
  const end = c.changedFields.find((x) => x.field.label === '병역 › 제대일');
  assert.ok(end, JSON.stringify(c.changedFields));
  assert.equal(end.from, '2022.10');
  assert.equal(end.field.value, '2022.09');
  assert.equal(end.field.filledByAgent, true);
});

test('비활성 버튼은 "비활성이라 안 눌림"으로 알려 준다', async () => {
  const b = scan.buttons.find((x) => x.text === '중복확인');
  assert.ok(b);
  const r = await driver.click(b.key);
  assert.equal(r.ok, false);
  assert.match(r.message ?? '', /비활성/);
});

test('추가 버튼에 하위 블록 이름, 탭은 [탭] (1-6)', () => {
  const adds = scan.buttons.filter((b) => b.kind === 'add').map((b) => b.section?.split(' › ').slice(-2).join(' › '));
  assert.deepEqual(adds, ['학력사항 › 전공', '경력사항 › 경력기술서', '경력사항 › 포트폴리오']);
  assert.deepEqual(
    scan.buttons.filter((b) => b.kind === 'tab').map((b) => b.text),
    ['직장경력', '프로젝트'],
  );
  assert.ok(!scan.fields.some((f) => f.section?.startsWith('[테스트]')), '공고 제목은 섹션 앞에 붙이지 않는다');
});

test('add_rows: 팝업 없이 페이지 안에 펼쳐지는 줄을 그 행으로 채운다 (1-7)', async () => {
  const add = scan.buttons.find((b) => b.kind === 'add' && b.section?.endsWith('전공'))!.key;
  const r = await driver.addRows(add, [
    { 전공명: '경영학', 전공계열: '상경계열', '전공 평점': '4.0' },
    { 전공명: { value: '컴퓨터학', query: '컴퓨터' }, 전공계열: '이공계열' },
  ]);
  assert.equal(r.stopped, undefined, JSON.stringify(r, null, 1));
  assert.deepEqual(r.rows.map((x) => [x.saved, x.inline]), [
    [true, true],
    [true, true],
  ]);
  const s = await state();
  assert.deepEqual(s.majors, [
    { name: '경영학', field: '상경계열', gpa: '4.0' },
    { name: '컴퓨터학', field: '이공계열', gpa: '' },
  ]);
});

test('extract 출력 줄이기: 넣은 칸은 접고, changed_only는 바뀐 것만 (4)', async () => {
  const full = await driver.scan();
  const text = renderScan(full);
  assert.match(text, /✓ 에이전트 입력 \d+칸/);
  assert.ok(!/"김지원"/.test(text), '에이전트가 넣은 값은 다시 보여 주지 않는다');
  const same = await driver.scan({ changedOnly: true });
  assert.equal(same.fields.length, 0, same.fields.map((f) => f.label).join(', '));
  assert.ok((same.omitted?.fields ?? 0) > 10);
  await driver.fill([{ key: field(full, '이메일주소').key, value: 'jiwon.kim@naver.com' }]);
  const changed = await driver.scan({ changedOnly: true });
  assert.deepEqual(changed.fields.map((f) => f.label), ['이메일주소'], JSON.stringify(changed.fields));
});

test('제출은 막히고, 지금까지 임시저장·제출은 한 번도 안 눌렸다', async () => {
  const sub = scan.buttons.find((b) => b.text === '제출하기');
  assert.equal(sub?.kind, 'blocked');
  const r = await driver.click(sub!.key);
  assert.equal(r.ok, false);
  const s = await state();
  assert.equal(s.submitted, false);
  assert.equal(s.saved, 0);
});
