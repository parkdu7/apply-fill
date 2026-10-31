// 테스트용 가짜 claude CLI. 진짜처럼 --mcp-config의 MCP 서버(fill-mcp)를 띄워 도구를 부르고 stream-json을 낸다.
// --version, auth status --json 도 흉내 낸다.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sdk = (p) => import(pathToFileURL(path.join(here, '..', '..', 'fill-mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', p)).href);
const argv = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv[0] === '--version') {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}
if (argv[0] === 'auth' && argv[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }));
  process.exit(0);
}

const prompt = arg('-p') ?? '';
const resume = arg('--resume');
const sessionId = resume ?? 'sess-1';
// 내장 도구를 끄고 MCP 도구만 허용했는지 기록 (테스트가 확인)
const flags = { tools: arg('--tools'), allowed: arg('--allowedTools'), strict: argv.includes('--strict-mcp-config'), perm: arg('--permission-mode') };
out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', mcp_servers: [{ name: 'careerlog-fill', status: 'connected' }] });

if (prompt.includes('SLOW')) {
  await new Promise((r) => setTimeout(r, 30000));
  process.exit(0);
}

const config = JSON.parse(arg('--mcp-config'));
const server = config.mcpServers['careerlog-fill'];
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');
const client = new Client({ name: 'fake-claude', version: '0' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env }, stderr: 'ignore' }));

let n = 0;
async function call(name, args) {
  const id = `tu_${++n}`;
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__careerlog-fill__${name}`, input: args }] } });
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text).join('\n');
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: r.content, is_error: !!r.isError }] } });
  return text;
}

let summary = '';
if (resume) {
  summary = `이어서 진행 (resume=${resume}): ${prompt.split('\n')[1] ?? ''}`;
} else {
  const scan = await call('extract_fields', {});
  const key = (label) => scan.match(new RegExp(`(\\S+) \\S+ "${label}"`))?.[1];
  const fill = await call('fill_fields', { fields: [{ key: key('이름'), value: '홍길동' }, { key: key('휴대폰'), value: '010-1234-5678' }] });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '기본정보를 채웠어요.' }] } });
  if (prompt.includes('ASK')) await call('ask_user', { questions: [{ text: '영문 이름을 알려 주세요', path: '기본정보.영문이름' }] });
  summary = `채움: ${/성공 (\d+)/.exec(fill)?.[1] ?? '?'}칸 flags=${JSON.stringify(flags)}`;
}
await client.close();
out({ type: 'result', subtype: 'success', is_error: false, result: summary, session_id: sessionId, total_cost_usd: 0.0123, num_turns: 3, duration_ms: 1000 });
