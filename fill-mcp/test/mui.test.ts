// careerlink와 같은 MUI v5 + MUI X DatePicker v6 지원서. 값이 React 상태까지 들어가는지 확인한다.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { ScanResult } from '../src/driver.js';
import { button, field, fixtureUrl, setup } from './helpers.js';

interface FixtureState {
  form: Record<string, unknown>;
  edu: Record<string, unknown>[];
  submitted: boolean;
  saved: number;
}

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('mui/index.html'));
  await page.waitForSelector('text=기본정보');
  scan = await driver.scan();
});
after(() => browser.shutdown());

const state = () => page.evaluate(() => (window as unknown as { __fixtureState: FixtureState }).__fixtureState);

test('MUI 컴포넌트 종류와 라벨, 섹션', () => {
  assert.equal(field(scan, '성명').required, true);
  assert.equal(field(scan, '생년월일').kind, 'date');
  assert.equal(field(scan, '생년월일').placeholder, 'YYYY.MM.DD');
  assert.equal(field(scan, '휴대폰 번호').kind, 'text');
  assert.equal(field(scan, '휴대폰 번호').hint, '숫자만 입력해 주세요.');
  assert.deepEqual(field(scan, '성별').options, ['남', '여']);
  assert.equal(field(scan, '학교명').kind, 'combobox');
  assert.equal(field(scan, '병역구분').section, '병역사항');
  assert.equal(field(scan, '병역구분').hint, undefined, '다음 섹션 제목을 힌트로 잡지 않는다');
});

test('MUI Select는 잠깐 열어서 선택지를 읽는다', () => {
  const mil = field(scan, '병역구분');
  assert.equal(mil.kind, 'listbox');
  assert.equal(mil.required, true);
  assert.deepEqual(mil.options, ['군필', '미필', '면제', '해당없음']);
  assert.deepEqual(field(scan, '졸업구분').options, ['졸업', '졸업예정', '재학', '중퇴']);
});

test('자소서(글자 수 카운터)와 동의 체크박스는 수동', () => {
  assert.equal(scan.fields.find((f) => f.kind === 'textarea')?.manual, 'essay');
  assert.equal(field(scan, '위 내용을 모두 확인하였으며 이에 동의합니다.').manual, 'consent');
  const kinds = Object.fromEntries(scan.buttons.map((b) => [b.text, b.kind]));
  assert.equal(kinds['임시저장'], 'save');
  assert.equal(kinds['미리보기'], 'blocked');
  assert.equal(kinds['최종제출'], 'blocked');
});

test('제어 컴포넌트에 넣은 값이 React 상태에 반영된다', async () => {
  const r = await driver.fill([
    { key: field(scan, '성명').key, value: '홍길동' },
    { key: field(scan, '생년월일').key, value: '1999-03-15' },
    { key: field(scan, '성별').key, value: '남' },
    { key: field(scan, '휴대폰 번호').key, value: '01012345678' },
    { key: field(scan, '이메일').key, value: 'gildong@example.com' },
    { key: field(scan, '병역구분').key, value: '군필' },
    { key: field(scan, '학교명').key, value: '연세대' },
    { key: field(scan, '졸업구분').key, value: '졸업예정' },
    { key: field(scan, '학점').key, value: '3.8' },
  ]);
  const bad = r.outcomes.filter((o) => o.status !== 'ok');
  assert.deepEqual(bad, [], JSON.stringify(bad, null, 1));
  const s = await state();
  assert.equal(s.form.name, '홍길동');
  assert.equal(s.form.birth, '1999-03-15');
  assert.equal(s.form.gender, 'M');
  assert.equal(s.form.phone, '010-1234-5678');
  assert.equal(s.form.military, '01');
  assert.equal(s.edu[0].school, '연세대학교', '자동완성 목록에서 고른다');
  assert.equal(s.edu[0].gradType, '졸업예정');

  // 졸업구분을 고르면 졸업일 칸이 생긴다
  const end = r.newFields.find((f) => f.label === '졸업(예정)일');
  assert.ok(end, '새로 나타난 칸을 알려준다');
  const r2 = await driver.fill([{ key: end.key, value: '2027-02' }]);
  assert.equal(r2.outcomes[0].status, 'ok', JSON.stringify(r2.outcomes[0]));
  assert.equal((await state()).edu[0].end, '2027-02');
});

test('키보드 방식으로도 같은 결과', async () => {
  const r = await driver.fill([
    { key: field(scan, '영문 성').key, value: 'Hong', method: 'keyboard' },
    { key: field(scan, '졸업구분').key, value: '졸업', method: 'keyboard' },
  ]);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['ok', 'ok'],
    JSON.stringify(r.outcomes),
  );
  const s = await state();
  assert.equal(s.form.nameEnLast, 'Hong');
  assert.equal(s.edu[0].gradType, '졸업');
});

test('동의·자소서는 거부, 최종제출/미리보기는 누르지 않는다', async () => {
  const r = await driver.fill([
    { key: field(scan, '위 내용을 모두 확인하였으며 이에 동의합니다.').key, value: 'true' },
    { key: scan.fields.find((f) => f.kind === 'textarea')!.key, value: '지원동기...' },
  ]);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['refused', 'refused'],
  );
  for (const text of ['최종제출', '미리보기']) {
    const c = await driver.click(scan.buttons.find((b) => b.text === text)!.key);
    assert.equal(c.ok, false);
  }
  const s = await state();
  assert.equal(s.form.agree, false);
  assert.equal(s.submitted, false);
  const nav = await driver.nextStep();
  assert.equal(nav.ok, false, '한 페이지짜리 지원서라 다음 버튼이 없다');
});

test('행 추가 후 새 칸을 돌려주고, 임시저장은 누를 수 있다', async () => {
  const r = await driver.click(button(scan, '+ 학력 추가'));
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.newFields.map((f) => `${f.label}#${f.nth}`),
    ['학교명#2', '전공#2', '졸업구분#2', '학점#2'],
  );
  assert.deepEqual(r.newFields[2].options, ['졸업', '졸업예정', '재학', '중퇴']);
  const save = await driver.click(button(scan, '임시저장'));
  assert.equal(save.ok, true);
  assert.equal((await state()).saved, 1);
});
