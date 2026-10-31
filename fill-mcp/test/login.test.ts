// P4 로그인 화면 알아보기·입력 (dom 쪽). 확장 background의 보관함 흐름은 extension/test에서 본다.
// 비밀번호는 테스트용 값이다.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { LoginDetect } from '../src/dom/login.js';
import { renderScan } from '../src/format.js';
import { fixtureUrl, setup } from './helpers.js';

const { browser, driver } = setup();
let page: Page;
const TEST_PW = 'correct-horse';

type Api = { detectLogin: () => LoginDetect; fillLogin: (u: string, p: string) => unknown };
const detect = () => page.evaluate(() => (window as unknown as { __clf: Api }).__clf.detectLogin());
const fill = (u: string, p: string) =>
  page.evaluate(([a, b]) => {
    try {
      return { ok: true, r: (window as unknown as { __clf: Api }).__clf.fillLogin(a, b) };
    } catch (e) {
      return { ok: false, r: (e as Error).message };
    }
  }, [u, p] as const);

async function open(mode = ''): Promise<void> {
  page = await browser.open(`${fixtureUrl('login.html')}${mode ? `?mode=${mode}` : ''}`);
  await driver.scan(); // 번들 주입
}

before(async () => {
  await open();
});
after(async () => {
  await browser.shutdown();
});

test('로그인 폼을 알아보고, "휴대폰 인증으로 아이디 찾기" 링크는 인증 화면으로 보지 않는다', async () => {
  const d = await detect();
  assert.equal(d.form, true);
  assert.equal(d.challenge, undefined);
  const scan = await driver.scan();
  assert.equal(scan.login?.form, true);
  assert.match(renderScan(scan), /로그인 화면이에요\. login 도구/);
});

test('틀리면 폼이 그대로 남고(재시도는 background가 하지 않는다), 맞으면 폼이 사라진다. 비밀번호는 돌려주지 않는다', async () => {
  const bad = await fill('tester', 'wrong-pass');
  assert.equal(bad.ok, true);
  assert.doesNotMatch(JSON.stringify(bad), /wrong-pass/);
  await page.waitForSelector('.err:not([hidden])');
  assert.equal((await detect()).form, true);
  // 넣어 둔 비밀번호가 칸 추출 결과에 나오지 않는다
  assert.doesNotMatch(renderScan(await driver.scan()), /wrong-pass/);
  await page.fill('#upw', '');
  await page.fill('#uid', '');
  const good = await fill('tester', TEST_PW);
  assert.equal(good.ok, true);
  assert.doesNotMatch(JSON.stringify(good), new RegExp(TEST_PW));
  await page.waitForSelector('text=마이페이지');
  assert.equal((await detect()).form, false);
  assert.equal(await page.evaluate(() => (window as unknown as { __fixtureState: { attempts: number } }).__fixtureState.attempts), 2);
});

test('CAPTCHA가 있으면 challenge로 알리고 입력하지 않는다', async () => {
  await open('captcha');
  const d = await detect();
  assert.match(d.challenge ?? '', /CAPTCHA/);
  const r = await fill('tester', TEST_PW);
  assert.equal(r.ok, false);
  assert.equal(await page.inputValue('#upw'), '');
  assert.match(renderScan(await driver.scan()), /⛔ CAPTCHA/);
});

test('reCAPTCHA v3 배지는 로그인을 막지 않는다', async () => {
  await open('badge');
  const d = await detect();
  assert.equal(d.form, true);
  assert.equal(d.challenge, undefined);
});

test('2단계 인증(인증번호)·본인인증 화면은 challenge, 가입 화면(비밀번호 칸 둘)은 로그인 폼이 아니다', async () => {
  await open('otp');
  assert.match((await detect()).challenge ?? '', /2단계 인증/);
  await open('identity');
  assert.match((await detect()).challenge ?? '', /본인인증/);
  await open('signup');
  const d = await detect();
  assert.equal(d.form, false);
  assert.equal(d.challenge, undefined);
});
