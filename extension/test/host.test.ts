// native host 왕복 테스트: 크롬(가짜) ⇄ host ⇄ claude(가짜, 진짜 fill-mcp를 MCP로 띄움) ⇄ 브리지 WS ⇄ 확장(가짜) ⇄ 페이지
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import WebSocket from 'ws';
import { BridgeServer } from '../host/src/bridge-server';
import { buildArgs } from '../host/src/claude';
import type { FromHost, RunDone, RunEvent } from '../src/shared/protocol';
import { FakeChrome, FILL_MCP, fixture, handle, launchBrowser, prepare, ROOT } from './harness';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'careerlog-host-'));
const browser = launchBrowser();
let page: Page;
let chrome: FakeChrome;

const env = {
  CAREERLOG_CLAUDE: path.join(ROOT, 'test', 'fake-claude.mjs'),
  CAREERLOG_FILL_MCP: FILL_MCP,
  CAREERLOG_DATA_DIR: tmp,
  LOCALAPPDATA: tmp,
};

before(async () => {
  assert.ok(existsSync(path.join(ROOT, 'host', 'dist', 'host.mjs')), 'npm run build:host 먼저');
  assert.ok(existsSync(FILL_MCP), 'fill-mcp에서 npm run build 먼저');
  page = await browser.open(fixture('simple.html'));
  await prepare(page);
  chrome = new FakeChrome(env, page);
});
after(async () => {
  chrome?.kill();
  await browser.shutdown();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const isDone = (m: FromHost): m is { type: 'done'; done: RunDone } => m.type === 'done';
const events = () => chrome.messages.filter((m): m is { type: 'event'; event: RunEvent } => m.type === 'event').map((m) => m.event);
const after_ = (n: number) => (m: FromHost) => isDone(m) && chrome.messages.indexOf(m) >= n;

test('상태: claude 버전·구독 로그인·fill-mcp 경로를 알려 준다', async () => {
  chrome.send({ type: 'status' });
  const m = await chrome.waitFor((x) => x.type === 'status');
  assert.ok(m.type === 'status');
  assert.equal(m.status.claude.version, '9.9.9');
  assert.equal(m.status.claude.loggedIn, true);
  assert.equal(m.status.claude.subscriptionType, 'pro');
  assert.equal(m.status.fillMcp.found, true);
});

test('[채우기]: claude가 fill-mcp 도구를 부르면 브리지로 확장(페이지)에 닿고, 진행 상황이 사이드패널로 온다', async () => {
  chrome.send({ type: 'run', run: { prompt: '채워 줘 ASK', tabUrl: page.url() } });
  const done = (await chrome.waitFor(isDone, 90000)) as { type: 'done'; done: RunDone };
  assert.equal(done.done.isError, false, done.done.result);
  assert.equal(done.done.sessionId, 'sess-1');
  assert.match(done.done.result ?? '', /채움: 2칸/);
  // 내장 도구는 끄고 careerlog-fill만 허용
  assert.match(done.done.result ?? '', /"tools":""/);
  assert.match(done.done.result ?? '', /"allowed":"mcp__careerlog-fill"/);
  assert.match(done.done.result ?? '', /"strict":true/);
  assert.equal(await page.inputValue('#name'), '홍길동');
  assert.equal(await page.inputValue('#phone'), '010-1234-5678');
  const ev = events();
  assert.ok(ev.some((e) => e.kind === 'init' && e.sessionId === 'sess-1' && e.mcp === 'connected'));
  assert.ok(ev.some((e) => e.kind === 'tool' && e.name === 'extract_fields'));
  assert.ok(ev.some((e) => e.kind === 'tool' && e.name === 'fill_fields' && e.summary.startsWith('2칸')));
  assert.ok(ev.some((e) => e.kind === 'tool_result' && e.name === 'fill_fields' && /성공 2/.test(e.text)));
  // ask_user → 사이드패널 질문
  assert.deepEqual(chrome.asks, [[{ id: 'q1', text: '영문 이름을 알려 주세요', path: '기본정보.영문이름' }]]);
});

test('답하기는 --resume으로 같은 세션을 잇는다', async () => {
  const n = chrome.messages.length;
  chrome.send({ type: 'run', run: { prompt: '질문에 대한 답:\n- 영문 이름: HONG GILDONG', resume: 'sess-1', tabUrl: page.url() } });
  const done = (await chrome.waitFor(after_(n), 30000)) as { type: 'done'; done: RunDone };
  assert.equal(done.done.sessionId, 'sess-1');
  assert.match(done.done.result ?? '', /resume=sess-1/);
  assert.match(done.done.result ?? '', /HONG GILDONG/);
});

test('[멈춤]: 실행 중인 claude를 끝낸다', async () => {
  const n = chrome.messages.length;
  chrome.send({ type: 'run', run: { prompt: 'SLOW', tabUrl: page.url() } });
  await chrome.waitFor((m) => m.type === 'event' && m.event.kind === 'init' && chrome.messages.indexOf(m) >= n, 20000);
  chrome.send({ type: 'cancel' });
  const done = (await chrome.waitFor(after_(n), 20000)) as { type: 'done'; done: RunDone };
  assert.equal(done.done.cancelled, true);
});

test('프로필 저장: 민감정보는 거부하고, 나머지는 fill-mcp 데이터 폴더에 저장한다', async () => {
  chrome.send({ type: 'profile-save', profile: { 기본정보: { 이름: '홍길동', 주민등록번호: '900101-1234567' } } });
  const bad = await chrome.waitFor((m) => m.type === 'profile-saved');
  assert.ok(bad.type === 'profile-saved' && !bad.ok && /주민등록번호/.test(bad.error ?? ''));
  chrome.messages.length = 0;
  chrome.send({ type: 'profile-save', profile: { 기본정보: { 이름: '홍길동' } } });
  const ok = await chrome.waitFor((m) => m.type === 'profile-saved');
  assert.ok(ok.type === 'profile-saved' && ok.ok);
  assert.equal(JSON.parse(readFileSync(path.join(tmp, 'profile.json'), 'utf8')).기본정보.이름, '홍길동');
  chrome.send({ type: 'profile-get' });
  const got = await chrome.waitFor((m) => m.type === 'profile');
  assert.ok(got.type === 'profile' && (got.profile as { 기본정보: { 이름: string } }).기본정보.이름 === '홍길동');
});

test('호스트 로그에는 상태만 남고 입력값은 없다', () => {
  const log = readFileSync(path.join(tmp, 'CareerLog', 'host.log'), 'utf8');
  assert.match(log, /run start/);
  assert.doesNotMatch(log, /홍길동|010-1234|HONG/);
});

test('브리지: 토큰이 맞아야 하고, 한 번 쓰면 끝이며, 브라우저 페이지(Origin 헤더)에서는 붙을 수 없다', async () => {
  const relayed: unknown[] = [];
  const server = new BridgeServer((id, req) => {
    relayed.push(req);
    server.deliver(id, { ok: true, result: 'pong' });
  });
  const url = await server.start();
  const token = server.issueToken();
  const hello = (t: string, headers?: Record<string, string>) =>
    new Promise<{ ok: boolean; ws: WebSocket }>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on('open', () => ws.send(JSON.stringify({ id: 0, op: 'hello', token: t })));
      ws.on('message', (d) => resolve({ ok: JSON.parse(String(d)).ok, ws }));
      ws.on('error', () => resolve({ ok: false, ws }));
      ws.on('unexpected-response', () => resolve({ ok: false, ws }));
    });
  assert.equal((await hello(token, { Origin: 'https://evil.example' })).ok, false);
  assert.equal((await hello('wrong')).ok, false);
  const good = await hello(token);
  assert.equal(good.ok, true);
  const reply = await new Promise<unknown>((resolve) => {
    good.ws.once('message', (d) => resolve(JSON.parse(String(d))));
    good.ws.send(JSON.stringify({ id: 7, op: 'page' }));
  });
  assert.deepEqual(reply, { id: 7, ok: true, result: 'pong' });
  assert.deepEqual(relayed, [{ op: 'page' }]);
  // 같은 토큰으로 다시는 못 붙는다
  assert.equal((await hello(token)).ok, false);
  good.ws.close();
  server.close();
});

test('claude 인자: 내장 도구 없음, MCP는 careerlog-fill만, 권한 질문 없이 거부, 답하기는 --resume', () => {
  const a = buildArgs({ prompt: 'x', resume: 's1', model: 'sonnet', mcpConfig: { mcpServers: {} }, cwd: '.' });
  const at = (k: string) => a[a.indexOf(k) + 1];
  assert.equal(at('--tools'), '');
  assert.equal(at('--allowedTools'), 'mcp__careerlog-fill');
  assert.equal(at('--permission-mode'), 'dontAsk');
  assert.equal(at('--output-format'), 'stream-json');
  assert.equal(at('--resume'), 's1');
  assert.equal(at('--model'), 'sonnet');
  assert.ok(a.includes('--strict-mcp-config') && a.includes('--verbose'));
});

test('확인창 shim: 에이전트 동작 중에는 확인창을 대신 처리하되 제출 확인은 취소한다', async () => {
  await handle(page, { t: 'agent', on: true });
  const t0 = Date.now();
  await page.click('#tmp');
  await page.click('#submit');
  assert.equal(await page.evaluate(() => (window as unknown as { __saved: boolean }).__saved), true);
  assert.equal(await page.evaluate(() => (window as unknown as { __submitted: boolean }).__submitted), false);
  const recs = (await handle(page, { t: 'dialogs', since: t0 })) as { message: string; handled: string }[];
  assert.deepEqual(
    recs.map((r) => r.handled),
    ['accepted', 'dismissed'],
  );
  await handle(page, { t: 'agent', on: false });
});
