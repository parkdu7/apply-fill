// 크롬 확장 매니페스트 (MV3). key는 scripts/keygen.mjs가 만든 공개키: 확장 ID를 고정해서 native host가 이 확장만 허용한다.
import { existsSync, readFileSync } from 'node:fs';
import { defineManifest } from '@crxjs/vite-plugin';

const keyFile = new URL('./.keys/public.b64', import.meta.url);
const key = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : undefined;
const pages = ['http://*/*', 'https://*/*'];

export default defineManifest({
  manifest_version: 3,
  name: 'CareerLog — 지원서 자동 입력',
  description: '프로필로 지원서 기본정보를 채웁니다. 제출·자기소개서·동의는 건드리지 않습니다.',
  version: '0.2.0',
  ...(key ? { key } : {}),
  minimum_chrome_version: '116',
  action: { default_title: 'CareerLog 사이드패널 열기' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['nativeMessaging', 'sidePanel', 'webNavigation', 'scripting', 'storage', 'tabs', 'alarms', 'unlimitedStorage', 'debugger'],
  host_permissions: pages,
  content_scripts: [
    // 확인창(alert/confirm) 대신 처리: 페이지 스크립트보다 먼저, 페이지 world에서
    { matches: pages, js: ['src/content/dialog-shim.iife.ts'], world: 'MAIN', run_at: 'document_start', all_frames: true, match_about_blank: true },
    // dom 번들(fill-mcp/src/dom): 칸 추출·입력·검증. 격리된 world라 페이지가 건드릴 수 없다
    { matches: pages, js: ['src/content/index.iife.ts'], run_at: 'document_idle', all_frames: true, match_about_blank: true },
  ],
});
