// Claude Code CLI 찾기·상태·실행. 구독(Pro/Max) 로그인 그대로 쓴다 (API 키 없음).
// PATH의 claude와 데스크톱 앱에 들어 있는 CLI 중 가장 새 버전을 고른다.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { ClaudeStatus, RunDone, RunEvent } from '../../src/shared/protocol';

export interface Cli {
  /** 실제 실행 파일 (claude.exe 또는 node) */
  command: string;
  /** command 앞에 붙일 인자 (node cli.js 형태일 때) */
  prefix: string[];
  path: string;
  version?: string;
}

function run(command: string, args: string[], timeoutMs = 10000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** claude.cmd(npm 설치)는 셸 없이 못 띄우니 안의 cli.js를 node로 띄운다 (프롬프트를 셸에 넘기지 않으려고) */
function toCli(p: string): Cli | undefined {
  if (/\.(m?js)$/i.test(p)) return { command: process.execPath, prefix: [p], path: p };
  if (/\.(cmd|bat)$/i.test(p)) {
    const js = path.join(path.dirname(p), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    return existsSync(js) ? { command: process.execPath, prefix: [js], path: p } : undefined;
  }
  return { command: p, prefix: [], path: p };
}

async function onPath(): Promise<string[]> {
  const r = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['-a', 'claude'].slice(process.platform === 'win32' ? 1 : 0), 5000);
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 데스크톱 앱에 들어 있는 CLI: %APPDATA%\Claude\claude-code\<버전>\<해시>\claude.exe */
function bundled(): string[] {
  const base = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code');
  const out: string[] = [];
  if (!existsSync(base)) return out;
  for (const v of readdirSync(base)) {
    const vdir = path.join(base, v);
    let subs: string[] = [];
    try {
      subs = readdirSync(vdir);
    } catch {
      continue;
    }
    for (const h of subs) {
      const exe = path.join(vdir, h, process.platform === 'win32' ? 'claude.exe' : 'claude');
      if (existsSync(exe)) out.push(exe);
    }
  }
  return out;
}

function cmpVersion(a = '0', b = '0'): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export async function version(cli: Cli): Promise<string | undefined> {
  const r = await run(cli.command, [...cli.prefix, '--version'], 15000);
  return r.stdout.match(/\d+\.\d+\.\d+/)?.[0];
}

/** 쓸 CLI: CAREERLOG_CLAUDE(또는 설정의 claude)가 있으면 그것, 아니면 찾은 것 중 가장 새 버전 */
export async function findClaude(override?: string): Promise<Cli | undefined> {
  const forced = process.env.CAREERLOG_CLAUDE ?? override;
  if (forced) {
    const cli = toCli(forced);
    if (cli) cli.version = await version(cli);
    return cli;
  }
  const paths = [...new Set([...(await onPath()), ...bundled(), path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')])].filter(
    (p) => existsSync(p),
  );
  const clis = paths.map(toCli).filter((c): c is Cli => !!c);
  await Promise.all(clis.map(async (c) => (c.version = await version(c))));
  return clis.filter((c) => c.version).sort((a, b) => cmpVersion(b.version, a.version))[0];
}

export async function status(cli: Cli | undefined): Promise<ClaudeStatus> {
  if (!cli) return { found: false, error: 'Claude Code를 찾지 못했어요. Claude 데스크톱 앱이나 Claude Code를 설치해 주세요.' };
  const r = await run(cli.command, [...cli.prefix, 'auth', 'status', '--json'], 15000);
  try {
    const j = JSON.parse(r.stdout) as { loggedIn?: boolean; subscriptionType?: string; email?: string; account?: { email?: string } };
    return { found: true, path: cli.path, version: cli.version, loggedIn: !!j.loggedIn, subscriptionType: j.subscriptionType, email: j.email ?? j.account?.email };
  } catch {
    return { found: true, path: cli.path, version: cli.version, loggedIn: false, error: (r.stderr || r.stdout).trim().slice(0, 300) || '로그인 상태를 읽지 못했어요' };
  }
}

/** claude auth login: 브라우저가 열리고 claude.ai에서 로그인한다 */
export function login(cli: Cli, onOutput: (s: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cli.command, [...cli.prefix, 'auth', 'login'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => onOutput(String(d)));
    child.stderr.on('data', (d) => onOutput(String(d)));
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export const SYSTEM_PROMPT = `너는 CareerLog 크롬 확장의 지원서 자동 입력 에이전트다. 사용자는 크롬 사이드패널에서 진행 상황을 본다.
- 도구는 careerlog-fill MCP만 쓴다. 작업 탭은 사용자가 [채우기]를 누른 탭이다 (browser_open은 필요할 때만).
- 사용자에게 물을 것(프로필에 없는 값, 고를 것)은 모아서 ask_user 한 번으로 올리고, 그 뒤 도구를 더 부르지 말고 턴을 끝낸다. 답은 다음 메시지로 온다.
- 진행 중에 대화로 묻지 않는다 (사용자는 답할 창이 없다). 끝나면 짧게 정리한다: 채운 것, 확인할 칸, 뺀 항목, 사용자가 직접 할 일.
- 로그인 화면이면 login 도구를 한 번 쓴다 (계정 보관함에 있을 때만 된다). CAPTCHA·2단계 인증·본인인증이 나오면 멈추고 사용자에게 맡긴다.`;

export interface RunArgs {
  prompt: string;
  resume?: string;
  model?: string;
  mcpConfig: object;
  cwd: string;
}

export function buildArgs(a: RunArgs): string[] {
  return [
    '-p',
    a.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    JSON.stringify(a.mcpConfig),
    '--strict-mcp-config',
    '--allowedTools',
    'mcp__careerlog-fill',
    // 내장 도구(Bash·파일 편집·웹 등)는 하나도 주지 않는다: 우회하면 안전장치가 빠진다
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--append-system-prompt',
    SYSTEM_PROMPT,
    ...(a.resume ? ['--resume', a.resume] : []),
    ...(a.model ? ['--model', a.model] : []),
  ];
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function toolSummary(name: string, input: Record<string, unknown>): string {
  const arr = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).length : 0);
  switch (name) {
    case 'fill_fields':
      return `${arr('fields')}칸${input.then_click ? ` + ${String(input.then_click)} 누름` : ''}`;
    case 'add_rows':
      return `${arr('rows')}행 (${String(input.add ?? '')})`;
    case 'ask_user':
      return `질문 ${arr('questions')}개`;
    case 'wait_for_user':
      return short(String(input.reason ?? ''), 80);
    default:
      return short(JSON.stringify(input), 100);
  }
}

interface StreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  mcp_servers?: { name: string; status: string }[];
  message?: { content?: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean })[] };
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('\n');
  return '';
}

export class Runner {
  private child?: ChildProcess;
  private cancelled = false;

  get running(): boolean {
    return !!this.child;
  }

  start(cli: Cli, args: RunArgs, onEvent: (e: RunEvent) => void): Promise<RunDone> {
    this.cancelled = false;
    const child = spawn(cli.command, [...cli.prefix, ...buildArgs(args)], { cwd: args.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    const names = new Map<string, string>();
    let done: RunDone | undefined;
    let sessionId: string | undefined;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      let j: StreamLine;
      try {
        j = JSON.parse(line) as StreamLine;
      } catch {
        return;
      }
      if (j.session_id) sessionId = j.session_id;
      if (j.type === 'system' && j.subtype === 'init') {
        const mcp = j.mcp_servers?.find((s) => s.name === 'careerlog-fill')?.status;
        onEvent({ kind: 'init', sessionId: j.session_id ?? '', model: j.model, mcp });
      } else if (j.type === 'assistant') {
        for (const c of j.message?.content ?? []) {
          if (c.type === 'text' && c.text.trim()) onEvent({ kind: 'text', text: short(c.text, 4000) });
          else if (c.type === 'tool_use') {
            const name = c.name.replace(/^mcp__careerlog-fill__/, '');
            names.set(c.id, name);
            onEvent({ kind: 'tool', name, summary: toolSummary(name, c.input ?? {}) });
          }
        }
      } else if (j.type === 'user') {
        for (const c of j.message?.content ?? []) {
          if (c.type === 'tool_result') onEvent({ kind: 'tool_result', name: names.get(c.tool_use_id), text: short(resultText(c.content), 1500), isError: !!c.is_error });
        }
      } else if (j.type === 'result') {
        done = { sessionId: j.session_id ?? sessionId, isError: !!j.is_error, result: j.result, costUsd: j.total_cost_usd, turns: j.num_turns, durationMs: j.duration_ms };
      }
    });
    let stderr = '';
    child.stderr!.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-4000);
    });
    return new Promise((resolve) => {
      const finish = (code: number | null, err?: Error) => {
        this.child = undefined;
        if (this.cancelled) resolve({ sessionId, isError: true, cancelled: true, result: '사용자가 멈췄어요.' });
        else if (done) resolve(done);
        else {
          if (stderr.trim()) onEvent({ kind: 'stderr', text: short(stderr.trim(), 1500) });
          resolve({ sessionId, isError: true, result: err ? `Claude Code를 실행하지 못했어요: ${err.message}` : `Claude Code가 결과 없이 끝났어요 (종료 코드 ${code}).` });
        }
      };
      child.on('close', (code) => finish(code));
      child.on('error', (e) => finish(null, e));
    });
  }

  cancel(): void {
    const c = this.child;
    if (!c?.pid) return;
    this.cancelled = true;
    // 자식(MCP 서버)까지 같이 끝낸다
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}
