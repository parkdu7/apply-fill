// CareerLog native messaging 호스트. 크롬 확장이 chrome.runtime.connectNative로 띄운다.
// - 사이드패널 요청: Claude 상태/로그인, [채우기] 실행(claude -p … stream-json), 멈춤, 프로필 보기/저장
// - 브리지: fill-mcp(claude가 띄운 MCP 서버)의 요청을 확장으로 넘기고 결과를 돌려준다
// stdout은 native messaging 전용이다. 로그는 %LOCALAPPDATA%\CareerLog\host.log 에 상태만 적는다 (값·비밀번호 없음).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FromHost, HostStatus, RunOptions, ToHost } from '../../src/shared/protocol';
import { BridgeServer } from './bridge-server';
import { findClaude, login, Runner, status, type Cli } from './claude';
import { NativePort } from './native';
import { sensitivePaths } from './profile';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.careerlog'), 'CareerLog');

interface HostConfig {
  node?: string;
  fillMcp?: string;
  dataDir?: string;
  claude?: string;
}

function loadConfig(): HostConfig {
  for (const f of [path.join(HERE, '..', 'config.json'), path.join(HERE, 'config.json')]) {
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, 'utf8')) as HostConfig;
      } catch {
        /* 다음 후보 */
      }
    }
  }
  return {};
}

const config = loadConfig();
const fillMcp = process.env.CAREERLOG_FILL_MCP ?? config.fillMcp ?? path.resolve(HERE, '..', '..', '..', 'fill-mcp', 'dist', 'index.js');
const dataDir = process.env.CAREERLOG_DATA_DIR ?? config.dataDir ?? path.join(path.dirname(path.dirname(fillMcp)), 'data');
const profilePath = path.join(dataDir, 'profile.json');

function log(line: string): void {
  try {
    mkdirSync(APP_DIR, { recursive: true });
    appendFileSync(path.join(APP_DIR, 'host.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* 로그 실패는 무시 */
  }
}

const port = new NativePort(process.stdin, process.stdout);
const send = (m: FromHost) => port.send(m);
const bridge = new BridgeServer((id, req) => send({ type: 'rpc', id, req }));
const runner = new Runner();
let cli: Cli | undefined;
let cliLookup: Promise<Cli | undefined> | undefined;

function getCli(refresh = false): Promise<Cli | undefined> {
  if (refresh || !cliLookup) cliLookup = findClaude(config.claude).then((c) => (cli = c));
  return cliLookup;
}

async function hostStatus(): Promise<HostStatus> {
  const c = await getCli(true);
  return {
    host: '0.2.0',
    node: process.version,
    fillMcp: { path: fillMcp, found: existsSync(fillMcp) },
    claude: await status(c),
  };
}

async function startRun(run: RunOptions): Promise<void> {
  if (runner.running) {
    send({ type: 'error', message: '이미 실행 중이에요. 멈춘 뒤 다시 눌러 주세요.' });
    return;
  }
  const c = cli ?? (await getCli());
  if (!c) {
    send({ type: 'done', done: { isError: true, result: 'Claude Code를 찾지 못했어요.' } });
    return;
  }
  if (!existsSync(fillMcp)) {
    send({ type: 'done', done: { isError: true, result: `fill-mcp를 찾지 못했어요: ${fillMcp} (fill-mcp에서 npm run build)` } });
    return;
  }
  const url = await bridge.start();
  const token = bridge.issueToken();
  const cwd = path.join(APP_DIR, 'run');
  mkdirSync(cwd, { recursive: true });
  const mcpConfig = {
    mcpServers: {
      'careerlog-fill': {
        command: config.node ?? process.execPath,
        args: [fillMcp],
        env: { CAREERLOG_BRIDGE: url, CAREERLOG_BRIDGE_TOKEN: token, CAREERLOG_DATA_DIR: dataDir },
      },
    },
  };
  log(`run start resume=${run.resume ? 'yes' : 'no'} cli=${c.version ?? '?'}`);
  const done = await runner.start(c, { prompt: run.prompt, resume: run.resume, model: run.model, mcpConfig, cwd }, (event) => send({ type: 'event', event }));
  log(`run done error=${done.isError} cancelled=${!!done.cancelled} turns=${done.turns ?? '?'}`);
  send({ type: 'done', done });
}

function readProfile(): void {
  try {
    const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : {};
    send({ type: 'profile', profile, path: profilePath });
  } catch (e) {
    send({ type: 'profile', profile: {}, path: profilePath, error: e instanceof Error ? e.message : String(e) });
  }
}

function saveProfile(profile: unknown): void {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    send({ type: 'profile-saved', ok: false, error: '프로필은 JSON 객체여야 해요' });
    return;
  }
  const bad = sensitivePaths(profile);
  if (bad.length) {
    send({ type: 'profile-saved', ok: false, error: `민감정보는 저장하지 않아요: ${bad.join(', ')}` });
    return;
  }
  mkdirSync(path.dirname(profilePath), { recursive: true });
  writeFileSync(`${profilePath}.tmp`, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  renameSync(`${profilePath}.tmp`, profilePath);
  send({ type: 'profile-saved', ok: true });
}

port.onMessage((raw) => {
  const m = raw as ToHost;
  switch (m.type) {
    case 'status':
      void hostStatus().then((s) => send({ type: 'status', status: s }));
      break;
    case 'login':
      void getCli().then(async (c) => {
        if (!c) return send({ type: 'login-done', ok: false });
        const ok = await login(c, (text) => send({ type: 'login-output', text }));
        send({ type: 'login-done', ok });
        send({ type: 'status', status: await hostStatus() });
      });
      break;
    case 'run':
      void startRun(m.run).catch((e) => send({ type: 'done', done: { isError: true, result: String(e) } }));
      break;
    case 'cancel':
      runner.cancel();
      break;
    case 'profile-get':
      readProfile();
      break;
    case 'profile-save':
      saveProfile(m.profile);
      break;
    case 'rpc-result':
      bridge.deliver(m.id, m);
      break;
  }
});

port.onClose(() => {
  runner.cancel();
  bridge.close();
  log('host exit');
  setTimeout(() => process.exit(0), 300);
});

log(`host start pid=${process.pid}`);
