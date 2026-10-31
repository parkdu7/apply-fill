// 진입점. 기본은 stdio MCP 서버, --open-browser 는 작업 브라우저만 띄우고 끝낸다(로그인해 두기용).
// CAREERLOG_BRIDGE(+ CAREERLOG_BRIDGE_TOKEN)가 있으면 확장 모드: native host가 띄운 것이고, 사용자의 크롬을 확장으로 조작한다.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AdapterStore } from './adapters.js';
import { BrowserManager } from './browser.js';
import { BridgeClient } from './bridge.js';
import { loadConfig } from './config.js';
import { PlaywrightDriver, type Driver } from './driver.js';
import { ExtensionDriver, ExtHost } from './ext-host.js';
import { DiskFiles } from './files.js';
import { ProfileStore } from './profile.js';
import { createServer } from './server.js';
import type { TabControl } from './transport.js';

const config = loadConfig();
const bridgeUrl = process.env.CAREERLOG_BRIDGE;

// 파일 보관함에 넣기 (Playwright 모드용): --add-file <경로> --kind 졸업증명서 [--issued 2025-09-01]
if (process.argv.includes('--add-file')) {
  const arg = (n: string) => process.argv[process.argv.indexOf(n) + 1];
  const added = new DiskFiles(config.filesDir).add(arg('--add-file'), process.argv.includes('--kind') ? arg('--kind') : '기타', process.argv.includes('--issued') ? arg('--issued') : undefined);
  console.log(`보관함에 넣었어요: ${added.kind} ${added.name} (${added.id})`);
  process.exit(0);
}

if (process.argv.includes('--open-browser')) {
  const url = process.argv.find((a) => /^https?:\/\//.test(a));
  const browser = new BrowserManager(config.browser);
  await browser.open(url);
  console.log(`작업 브라우저를 열었어요 (프로필: ${config.browser.userDataDir}, 포트 ${config.browser.port}).`);
  console.log('이 창에서 채용 사이트에 로그인해 두면 Claude가 같은 창을 씁니다.');
  process.exit(0);
}

const adapters = new AdapterStore(config.adaptersDir, config.adapterSeedDir);
let browser: TabControl;
let driver: Driver;
let ext: ExtHost | undefined;
if (bridgeUrl) {
  ext = new ExtHost(new BridgeClient(bridgeUrl, process.env.CAREERLOG_BRIDGE_TOKEN));
  // 토큰은 이 프로세스만 알면 된다 (자식 프로세스에 넘기지 않게)
  delete process.env.CAREERLOG_BRIDGE_TOKEN;
  browser = ext;
  driver = new ExtensionDriver(ext, adapters);
} else {
  const pw = new BrowserManager(config.browser);
  browser = pw;
  driver = new PlaywrightDriver(pw, config.domBundlePath, adapters, new DiskFiles(config.filesDir));
}
const profile = new ProfileStore(config.profilePath, config.examplePath);
const server = createServer({ driver, browser, profile, snapshotDir: config.snapshotDir, ext });

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await browser.shutdown();
  process.exit(0);
}
process.stdin.on('close', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await server.connect(new StdioServerTransport());
console.error(`careerlog-fill MCP 서버 시작 (stdio, ${bridgeUrl ? '확장' : 'Playwright'} 모드)`);
