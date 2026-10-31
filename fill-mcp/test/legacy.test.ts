// 표·dl·label 위주의 옛날식(금융권 자체 채용 사이트) 지원서
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { ScanResult } from '../src/driver.js';
import { button, field, fixtureUrl, setup } from './helpers.js';

const { browser, driver } = setup();
let page: Page;
let scan: ScanResult;

before(async () => {
  page = await browser.open(fixtureUrl('legacy.html'));
  scan = await driver.scan();
});
after(() => browser.shutdown());

const state = () => page.evaluate(() => (window as unknown as { state: Record<string, unknown> }).state);

test('표의 th, dl/dt, label, placeholder로 라벨을 찾는다', () => {
  assert.equal(field(scan, '성명').required, true);
  assert.equal(field(scan, '영문성명').placeholder, 'Hong Gildong');
  assert.equal(field(scan, '병역구분').kind, 'select');
  assert.deepEqual(field(scan, '병역구분').options, ['군필', '미필', '면제', '해당없음']);
  assert.equal(field(scan, '입대일').kind, 'date');
  assert.equal(field(scan, '자격증명').kind, 'text');
  assert.equal(field(scan, '추천인 성명').key.includes(':'), true, 'iframe 안 칸은 프레임 번호가 붙는다');
  assert.match(field(scan, '병역구분').section ?? '', /병역사항/);
});

test('읽기 전용 달력 칸은 날짜로, 주소 검색 칸은 수동으로', () => {
  const birth = field(scan, '생년월일');
  assert.equal(birth.kind, 'date');
  assert.equal(birth.manual, undefined);
  assert.equal(field(scan, '취득일').kind, 'date');
  const address = scan.fields.filter((f) => f.label === '주소');
  assert.deepEqual(
    address.map((f) => f.manual),
    ['readonly', 'readonly', undefined],
  );
});

test('한 항목이 여러 칸이면 part, 라디오는 선택지로 묶는다', () => {
  const tel = scan.fields.filter((f) => f.label === '휴대폰');
  assert.deepEqual(
    tel.map((f) => [f.kind, f.part]),
    [
      ['select', '1/3'],
      ['text', '2/3'],
      ['text', '3/3'],
    ],
  );
  assert.deepEqual(field(scan, '성별').options, ['남', '여']);
  assert.equal(field(scan, '학점').part, '1/2');
});

test('select의 기본 선택(직접입력, 4.5)은 값으로 보지 않는다', () => {
  const email = scan.fields.filter((f) => f.label === '이메일');
  assert.equal(email[1].value, undefined);
  assert.equal(scan.fields.filter((f) => f.label === '학점')[1].value, undefined);
});

test('민감정보·파일·자소서·동의·비밀번호는 수동 처리로 분류한다', () => {
  assert.equal(field(scan, '주민등록번호').manual, 'sensitive');
  assert.equal(field(scan, '사진').manual, 'file');
  assert.equal(field(scan, '지원서 비밀번호').manual, 'password');
  assert.equal(field(scan, '개인정보 수집·이용에 동의합니다').manual, 'consent');
  assert.equal(scan.fields.find((f) => f.kind === 'textarea')?.manual, 'essay');
  assert.equal(field(scan, '채용 소식 메일 받기').manual, undefined);
});

test('버튼을 다음/추가/검색/차단으로 분류한다', () => {
  const kinds = Object.fromEntries(scan.buttons.map((b) => [b.text, b.kind]));
  assert.equal(kinds['다음 단계'], 'next');
  assert.equal(kinds['+ 학력 추가'], 'add');
  assert.equal(kinds['우편번호 검색'], 'search');
  assert.equal(kinds['최종 제출'], 'blocked');
});

test('값을 넣고 이벤트까지 발생시켜 페이지 상태에 반영된다', async () => {
  const tel = scan.fields.filter((f) => f.label === '휴대폰');
  const email = scan.fields.filter((f) => f.label === '이메일');
  const r = await driver.fill([
    { key: field(scan, '성명').key, value: '홍길동' },
    { key: field(scan, '생년월일').key, value: '1999-03-15' },
    { key: field(scan, '성별').key, value: '여' },
    { key: tel[0].key, value: '010' },
    { key: tel[1].key, value: '1234' },
    { key: tel[2].key, value: '5678' },
    { key: email[0].key, value: 'gildong' },
    { key: email[1].key, value: 'gmail.com' },
    { key: field(scan, '병역구분').key, value: '해당 없음' },
    { key: field(scan, '입대일').key, value: '2019.03.04' },
    { key: field(scan, '입학년월').key, value: '2019-03' },
    { key: field(scan, '졸업구분').key, value: '졸업예정' },
    { key: scan.fields.filter((f) => f.label === '학점')[1].key, value: '4.5' },
    { key: field(scan, '취득일').key, value: '2024-05-01', confidence: 'low' },
    { key: field(scan, '채용 소식 메일 받기').key, value: 'true' },
    { key: field(scan, '추천인 성명').key, value: '김추천' },
  ]);
  const bad = r.outcomes.filter((o) => o.status !== 'ok');
  assert.deepEqual(bad, [], JSON.stringify(bad, null, 1));
  assert.equal(r.outcomes.find((o) => o.key === field(scan, '생년월일').key)?.actual, '1999.03.15', 'placeholder 형식으로 바꿔 넣는다');
  const s = await state();
  assert.equal(s.nameKo, '홍길동');
  assert.equal(s.birth, '1999.03.15');
  assert.equal(s.gender, 'F');
  assert.equal(s.tel3, '5678');
  assert.equal(s.emailDomain, 'gmail.com');
  assert.equal(s.military, '해당없음');
  assert.equal(s.milStart, '2019-03-04');
  assert.equal(s.eduStart, '2019-03');
  assert.equal(s.certDate, '2024.05.01');
  assert.equal(s.newsletter, true);
  const frame = page.frames().find((f) => f.url().includes('legacy-frame'))!;
  assert.equal(await frame.evaluate(() => (window as unknown as { state: Record<string, string> }).state.referrer), '김추천');
});

test('수동 칸과 민감정보 값은 거부한다', async () => {
  const r = await driver.fill([
    { key: field(scan, '주민등록번호').key, value: '990315-1234567' },
    { key: field(scan, '개인정보 수집·이용에 동의합니다').key, value: 'true' },
    { key: field(scan, '전공').key, value: '990315-1234567' },
  ]);
  assert.deepEqual(
    r.outcomes.map((o) => o.status),
    ['refused', 'refused', 'refused'],
  );
  assert.equal(await page.locator('[name=rrn]').inputValue(), '');
  assert.equal(await page.locator('[name=agree]').isChecked(), false);
});

test('이미 값이 있는 칸은 덮어쓰지 않고, overwrite면 덮어쓴다', async () => {
  await page.fill('[name=addr2]', '사용자가 쓴 주소');
  const key = scan.fields.filter((f) => f.label === '주소')[2].key;
  const r1 = await driver.fill([{ key, value: '프로필 주소' }]);
  assert.equal(r1.outcomes[0].status, 'skipped');
  assert.equal(await page.locator('[name=addr2]').inputValue(), '사용자가 쓴 주소');
  const r2 = await driver.fill([{ key, value: '프로필 주소', overwrite: true }]);
  assert.equal(r2.outcomes[0].status, 'ok');
  // 에이전트가 넣은 칸은 다시 고쳐 넣을 수 있다
  const r3 = await driver.fill([{ key: field(scan, '성명').key, value: '홍길순' }]);
  assert.equal(r3.outcomes[0].status, 'ok');
});

test('선택지에 없는 값은 불일치로 가능한 값을 알려준다', async () => {
  const r = await driver.fill([{ key: field(scan, '졸업구분').key, value: '수료' }]);
  assert.equal(r.outcomes[0].status, 'mismatch');
  assert.match(r.outcomes[0].message ?? '', /졸업예정/);
});

test('행 추가: 복제된 행은 새 키를 받고 행 번호가 붙는다', async () => {
  const r = await driver.click(button(scan, '+ 학력 추가'));
  assert.equal(r.ok, true);
  const labels = r.newFields.map((f) => `${f.label}#${f.nth}`);
  assert.ok(labels.includes('학교명#2'), labels.join(','));
  assert.deepEqual(
    r.newFields.filter((f) => f.filledByAgent).map((f) => f.label),
    [],
    '복제된 행이 원본의 "에이전트 입력" 표시를 물려받지 않는다',
  );
  const again = await driver.scan();
  const keys = again.fields.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, '키가 겹치지 않는다');
  assert.equal(field(again, '졸업구분', 2).filledByAgent, undefined, '복제된 행은 에이전트 입력 표시가 없다');
});

test('제출 버튼은 누르지 않고, 다음 단계는 확인창을 수락하고 넘어간다', async () => {
  const blocked = scan.buttons.find((b) => b.text === '최종 제출')!;
  const r = await driver.click(blocked.key);
  assert.equal(r.ok, false);
  assert.equal(await page.evaluate(() => (window as unknown as { submitted?: boolean }).submitted), undefined);

  const nav = await driver.nextStep();
  assert.equal(nav.ok, true, nav.message);
  assert.equal(nav.dialogs[0]?.type, 'confirm');
  assert.equal(nav.dialogs[0]?.handled, 'accepted');
  const step2 = await driver.scan();
  assert.ok(step2.fields.some((f) => f.label === '취미'));
});
