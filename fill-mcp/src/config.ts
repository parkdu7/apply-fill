import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** dist/index.js 에서도, tsx로 돌리는 src/*.ts 에서도 패키지 루트 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface BrowserOptions {
  /** cdp: 전용 브라우저를 따로 띄워 디버깅 포트로 연결(기본). launch: Playwright가 직접 띄움(테스트용) */
  mode: 'cdp' | 'launch';
  headless: boolean;
  port: number;
  userDataDir: string;
  executablePath?: string;
}

export interface Config {
  profilePath: string;
  examplePath: string;
  snapshotDir: string;
  domBundlePath: string;
  /** 배운 사이트 어댑터 (개인 데이터) */
  adaptersDir: string;
  /** 기본 사이트 어댑터 (패키지에 포함) */
  adapterSeedDir: string;
  /** 파일 보관함 (Playwright 모드용. 확장 모드는 확장의 IndexedDB) */
  filesDir: string;
  browser: BrowserOptions;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.CAREERLOG_DATA_DIR ?? path.join(PACKAGE_ROOT, 'data');
  return {
    profilePath: env.CAREERLOG_PROFILE ?? path.join(dataDir, 'profile.json'),
    examplePath: path.join(PACKAGE_ROOT, 'profile.example.json'),
    snapshotDir: path.join(dataDir, 'snapshots'),
    domBundlePath: path.join(PACKAGE_ROOT, 'dist', 'dom.js'),
    adaptersDir: path.join(dataDir, 'adapters'),
    adapterSeedDir: path.join(PACKAGE_ROOT, 'adapters'),
    filesDir: env.CAREERLOG_FILES_DIR ?? path.join(dataDir, 'files'),
    browser: {
      mode: env.CAREERLOG_BROWSER === 'launch' ? 'launch' : 'cdp',
      headless: env.CAREERLOG_HEADLESS === '1',
      port: Number(env.CAREERLOG_CDP_PORT ?? 9333),
      userDataDir: env.CAREERLOG_BROWSER_PROFILE ?? path.join(os.homedir(), '.careerlog', 'browser-profile'),
      executablePath: env.CAREERLOG_BROWSER_PATH,
    },
  };
}
