// P4 계정 보관함: 암호화(PBKDF2 + AES-GCM), 정확한 origin 묶기, 로그인 흐름(한 번만 시도, 인증 화면에서 멈춤, 값이 결과·기록에 안 남음).
// 로그인 흐름은 진짜 페이지(fill-mcp 로그인 fixture를 127.0.0.1로 띄움) + content script 코드로 확인한다. 비밀번호는 테스트용 값이다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { runLogin, type LoginDeps, type LoginDetect } from '../src/shared/login-flow';
import type { LoginOutcome } from '../src/shared/protocol';
import { accountFor, addAccount, createVault, exportKey, importKey, normalizeOrigin, open, seal, unlockVault, type VaultData } from '../src/shared/vault';
import { handle, launchBrowser, prepare, ROOT } from './harness';

const TEST_PW = 'correct-horse';
const FIXTURE = readFileSync(path.join(ROOT, '..', 'fill-mcp', 'test', 'fixtures', 'login.html'), 'utf8');
const browser = launchBrowser();
let server: Server;
let base: string;
let page: Page;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await browser.shutdown();
  server.close();
});

test('마스터 비밀번호: 8자 미만 거부, 틀리면 안 열리고, 맞으면 열린다. 암호문은 평문을 담지 않는다', async () => {
  await assert.rejects(createVault('short', 1000), /8자/);
  const { data, key } = await createVault('master-pass-1', 1000);
  assert.equal(await unlockVault(data, 'wrong-master'), undefined);
  const k2 = await unlockVault(data, 'master-pass-1');
  assert.ok(k2);
  const s = await seal(key, TEST_PW);
  assert.ok(!JSON.stringify(s).includes(TEST_PW));
  assert.equal(await open(k2!, s), TEST_PW);
  // 세션에 넣는 키(꺼낸 원본)로도 같은 걸 푼다
  assert.equal(await open(await importKey(await exportKey(key)), s), TEST_PW);
  // 같은 평문도 매번 다른 암호문 (IV 무작위)
  assert.notEqual((await seal(key, TEST_PW)).ct, s.ct);
});

test('기본 반복 횟수(60만)로 키를 만든다', async () => {
  const { data } = await createVault('master-pass-1');
  assert.equal(data.iterations, 600_000);
});

test('계정은 정확히 같은 origin에서만 꺼낸다 (http/https·하위 도메인·비슷한 도메인은 다른 사이트)', async () => {
  const { data, key } = await createVault('master-pass-1', 1000);
  await addAccount(data, key, { origin: 'https://Career.Example.com/login?next=/apply', username: 'tester', password: TEST_PW });
  assert.equal(data.accounts[0].origin, 'https://career.example.com');
  assert.equal(accountFor(data, 'https://career.example.com')?.username, 'tester');
  assert.equal(accountFor(data, 'http://career.example.com'), undefined);
  assert.equal(accountFor(data, 'https://sub.career.example.com'), undefined);
  assert.equal(accountFor(data, 'https://career.example.com.evil.io'), undefined);
  assert.equal(accountFor(data, 'null'), undefined);
  assert.throws(() => normalizeOrigin('javascript:alert(1)'));
});

async function vaultFor(origin: string, password: string): Promise<{ data: VaultData; key: CryptoKey }> {
  const { data, key } = await createVault('master-pass-1', 1000);
  await addAccount(data, key, { origin, username: 'tester', password });
  return { data, key };
}

/** background와 같은 연결: 진짜 페이지의 content script 코드로 감지·입력 */
function deps(v: { data?: VaultData; key?: CryptoKey }, logs: unknown[], fills: { origin: string; username: string }[], fakeOrigin?: string): LoginDeps {
  return {
    detect: async () => {
      const r = (await handle(page, { t: 'clf', fn: 'detectLogin', args: [] })) as LoginDetect;
      return [{ frameId: 0, result: fakeOrigin ? { ...r, origin: fakeOrigin } : r }];
    },
    vault: async () => v.data,
    key: async () => v.key,
    fill: async (_frameId, msg) => {
      fills.push({ origin: msg.origin, username: msg.username });
      await handle(page, { t: 'loginFill', ...msg });
    },
    settle: () => page.waitForTimeout(300),
    url: async () => page.url(),
    log: async (origin: string, status: LoginOutcome['status']) => {
      logs.push({ origin, status });
    },
  };
}

async function openLogin(mode = ''): Promise<void> {
  page = await browser.open(`${base}/login${mode ? `?mode=${mode}` : ''}`);
  await prepare(page);
}

const attempts = () => page.evaluate(() => (window as unknown as { __fixtureState: { attempts: number } }).__fixtureState.attempts);

test('로그인: 잠겨 있으면 넣지 않는다', async () => {
  await openLogin();
  const fills: { origin: string; username: string }[] = [];
  const out = await runLogin(deps({ data: (await vaultFor(base, TEST_PW)).data }, [], fills));
  assert.equal(out.status, 'locked');
  assert.equal(fills.length, 0);
});

test('로그인: 이 origin 계정이 없으면 넣지 않는다', async () => {
  const fills: { origin: string; username: string }[] = [];
  const out = await runLogin(deps(await vaultFor('https://other.example.com', TEST_PW), [], fills));
  assert.equal(out.status, 'no_account');
  assert.equal(fills.length, 0);
});

test('로그인: 틀린 비밀번호면 한 번만 시도하고 멈춘다', async () => {
  const logs: unknown[] = [];
  const out = await runLogin(deps(await vaultFor(base, 'wrong-pass'), logs, []));
  assert.equal(out.status, 'failed');
  assert.equal(await attempts(), 1);
  assert.doesNotMatch(JSON.stringify([out, logs]), /wrong-pass/);
});

test('로그인: 맞으면 로그인되고, 결과·기록에는 비밀번호가 없다', async () => {
  await openLogin();
  const logs: unknown[] = [];
  const fills: { origin: string; username: string }[] = [];
  const out = await runLogin(deps(await vaultFor(base, TEST_PW), logs, fills));
  assert.equal(out.status, 'logged_in', out.message);
  assert.deepEqual(fills, [{ origin: base, username: 'tester' }]);
  assert.deepEqual(logs, [{ origin: base, status: 'logged_in' }]);
  assert.doesNotMatch(JSON.stringify([out, logs]), new RegExp(TEST_PW));
  assert.equal(await page.evaluate(() => (window as unknown as { __fixtureState: { loggedIn: boolean } }).__fixtureState.loggedIn), true);
});

test('로그인: CAPTCHA 화면이면 넣지 않고 멈춘다', async () => {
  await openLogin('captcha');
  const fills: { origin: string; username: string }[] = [];
  const out = await runLogin(deps(await vaultFor(base, TEST_PW), [], fills));
  assert.equal(out.status, 'challenge');
  assert.equal(fills.length, 0);
});

test('로그인: 프레임 실제 origin이 계정과 다르면 content script가 거부한다 (도메인 묶기 이중 확인)', async () => {
  await openLogin();
  // background가 받은 감지 결과가 (가정) 다른 origin이라고 해도, 실제 페이지 origin은 127.0.0.1이라 넣지 않는다
  const out = await runLogin(deps(await vaultFor('https://career.example.com', TEST_PW), [], [], 'https://career.example.com'));
  assert.equal(out.status, 'domain_mismatch');
  assert.equal(await page.inputValue('#upw'), '');
});
