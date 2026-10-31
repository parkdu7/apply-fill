// 실제 MCP 클라이언트로 서버(dist/index.js)를 띄워서 툴을 호출해 본다
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PACKAGE_ROOT } from '../src/config.js';
import { fixtureUrl } from './helpers.js';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'careerlog-'));
const profilePath = path.join(tmp, 'profile.json');
const client = new Client({ name: 'test', version: '0.0.0' });

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(PACKAGE_ROOT, 'dist', 'index.js')],
    env: {
      ...(process.env as Record<string, string>),
      CAREERLOG_BROWSER: 'launch',
      CAREERLOG_HEADLESS: '1',
      CAREERLOG_PROFILE: profilePath,
      CAREERLOG_DATA_DIR: tmp,
    },
    stderr: 'ignore',
  });
  await client.connect(transport);
});
after(async () => {
  await client.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
}

test('툴 목록과 서버 안내문', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'add_rows',
    'ask_user',
    'attach_files',
    'browser_open',
    'browser_tabs',
    'click_button',
    'extract_fields',
    'fill_fields',
    'get_profile',
    'login',
    'next_step',
    'save_profile',
    'search_address',
    'snapshot_page',
    'wait_for_user',
  ]);
  assert.match(client.getInstructions() ?? '', /제출/);
  const { prompts } = await client.listPrompts();
  assert.equal(prompts[0]?.name, 'fill');
});

test('확장 전용 도구는 Playwright 모드에서 안내만 돌려준다 (계정 보관함 없음, 질문은 대화로)', async () => {
  const login = await call('login');
  assert.equal(login.isError, true);
  assert.match(login.text, /확장에서만/);
  const ask = await call('ask_user', { questions: [{ text: '영문 이름은?' }] });
  assert.match(ask.text, /대화로 사용자에게/);
  const files = await call('attach_files', {});
  assert.match(files.text, /파일 보관함: 비어 있어요/);
});

test('프로필: 처음엔 예시로 만들고, 저장하고, 민감정보는 거부', async () => {
  const first = await call('get_profile');
  assert.match(first.text, /새로 만들었어요/);
  const saved = await call('save_profile', {
    updates: [
      { path: '기본정보.이름', value: '홍길동' },
      { path: '학력.대학교[0].학점', value: '3.8' },
      { path: '기본정보.주민등록번호', value: '990315-1234567' },
      { path: '기타.메모', value: '990315-1234567' },
      { path: '어학[0].수험번호', value: '1234560000000101' },
    ],
  });
  assert.match(saved.text, /저장 3개/);
  assert.match(saved.text, /거부: 기본정보\.주민등록번호/);
  assert.match(saved.text, /거부: 기타\.메모/);
  const data = JSON.parse(readFileSync(profilePath, 'utf8'));
  assert.equal(data.기본정보.이름, '홍길동');
  assert.equal(data.학력.대학교[0].학점, '3.8');
  assert.equal(data.기본정보.주민등록번호, undefined);
  const view = await call('get_profile');
  assert.match(view.text, /"이름": "홍길동"/);
  assert.match(view.text, /비어 있는 항목/);
});

test('열기 → 추출 → 입력 → 버튼', async () => {
  const open = await call('browser_open', { url: fixtureUrl('legacy.html') });
  assert.equal(open.isError, false, open.text);
  const scan = await call('extract_fields');
  const key = /(f\d+) text "성명"/.exec(scan.text)?.[1];
  assert.ok(key, scan.text);
  const filled = await call('fill_fields', { fields: [{ key, value: '홍길동' }] });
  assert.match(filled.text, /성공 1/);
  const submitKey = /(b\d+) \[[^\]]+\] "최종 제출"/.exec(scan.text)?.[1];
  assert.equal(submitKey, undefined, '제출 버튼은 버튼 목록에 키 없이 차단 목록으로만 나온다');
  const next = await call('next_step');
  assert.match(next.text, /다음 단계/);
  const bad = await call('fill_fields', { fields: [{ key: 'f9999', value: 'x' }] });
  assert.match(bad.text, /못 찾음 1/);
});
