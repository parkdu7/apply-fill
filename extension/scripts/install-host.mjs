// native messaging 호스트 등록 (현재 사용자만, 관리자 권한 필요 없음).
// - host/config.json: node 경로, fill-mcp 경로
// - host/careerlog-host.bat: 크롬이 띄우는 실행 파일 (node host/dist/host.mjs)
// - host/careerlog-host.json: 호스트 매니페스트. allowed_origins는 이 확장 ID 하나뿐
// - 레지스트리 HKCU\Software\Google\Chrome\NativeMessagingHosts\com.careerlog.host = 매니페스트 경로
// 옵션: --uninstall (등록 해제), --dry-run (아무것도 바꾸지 않고 할 일만 출력), --fill-mcp <경로>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.careerlog.host';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostDir = path.join(root, 'host');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const uninstall = argv.includes('--uninstall');
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const REG_KEY = ['HKCU', 'Software', 'Google', 'Chrome', 'NativeMessagingHosts', HOST_NAME].join('\\');
const manifestPath = path.join(hostDir, 'careerlog-host.json');

function unixManifestDir() {
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
    : path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
}

function step(what, fn) {
  console.log(`${dry ? '[dry-run] ' : ''}${what}`);
  if (!dry) fn();
}

if (uninstall) {
  if (process.platform === 'win32') {
    step(`레지스트리 삭제: ${REG_KEY}`, () => {
      try {
        execFileSync('reg', ['delete', REG_KEY, '/f'], { stdio: 'ignore' });
      } catch {
        /* 이미 없음 */
      }
    });
  } else {
    step(`삭제: ${path.join(unixManifestDir(), `${HOST_NAME}.json`)}`, () => rmSync(path.join(unixManifestDir(), `${HOST_NAME}.json`), { force: true }));
  }
  console.log('등록을 해제했어요.');
  process.exit(0);
}

const idFile = path.join(root, '.keys', 'extension-id.txt');
if (!existsSync(idFile)) {
  console.error('확장 ID가 없어요. 먼저 npm run build (또는 npm run keygen)를 실행해 주세요.');
  process.exit(1);
}
const extensionId = readFileSync(idFile, 'utf8').trim();
if (!/^[a-p]{32}$/.test(extensionId)) {
  console.error(`확장 ID 형식이 이상해요: ${extensionId}`);
  process.exit(1);
}
const hostJs = path.join(hostDir, 'dist', 'host.mjs');
if (!existsSync(hostJs) && !dry) {
  console.error('host/dist/host.mjs가 없어요. npm run build:host를 먼저 실행해 주세요.');
  process.exit(1);
}
const fillMcp = path.resolve(argOf('--fill-mcp') ?? path.join(root, '..', 'fill-mcp', 'dist', 'index.js'));
if (!existsSync(fillMcp)) console.warn(`주의: fill-mcp를 찾지 못했어요 (${fillMcp}). fill-mcp 폴더에서 npm run build 해 주세요.`);

const config = { node: process.execPath, fillMcp };
step(`설정 저장: ${path.join(hostDir, 'config.json')}`, () => writeFileSync(path.join(hostDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`));

let launcher;
if (process.platform === 'win32') {
  launcher = path.join(hostDir, 'careerlog-host.bat');
  step(`실행 파일: ${launcher}`, () => writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "%~dp0dist\\host.mjs" %*\r\n`));
} else {
  launcher = path.join(hostDir, 'careerlog-host.sh');
  step(`실행 파일: ${launcher}`, () => writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/dist/host.mjs" "$@"\n`, { mode: 0o755 }));
}

const manifest = {
  name: HOST_NAME,
  description: 'CareerLog 지원서 자동 입력 호스트',
  path: launcher,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
step(`호스트 매니페스트: ${manifestPath} (허용 확장: ${extensionId})`, () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`));

if (process.platform === 'win32') {
  step(`레지스트리 등록: ${REG_KEY}`, () => execFileSync('reg', ['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' }));
} else {
  const dir = unixManifestDir();
  step(`복사: ${path.join(dir, `${HOST_NAME}.json`)}`, () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${HOST_NAME}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  });
}
console.log(`\n완료. 확장 ID ${extensionId} 만 이 호스트를 쓸 수 있어요. 크롬에서 확장을 다시 불러오면 바로 연결돼요.`);
