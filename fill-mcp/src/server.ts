// MCP 서버: 툴 정의. 판단(어떤 칸에 무슨 값)은 LLM이, 실행(입력·검증·안전장치)은 코드가 한다.
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Driver } from './driver.js';
import type { ExtHost } from './ext-host.js';
import { renderAddress, renderAddRows, renderAttach, renderClick, renderFill, renderNav, renderScan, renderTabs, renderWait } from './format.js';
import type { ProfileStore } from './profile.js';
import type { TabControl } from './transport.js';

export interface ServerDeps {
  driver: Driver;
  browser: TabControl;
  /** 확장 모드일 때만: 사이드패널 질문·파일 보관함·계정 보관함 */
  ext?: ExtHost;
  profile: ProfileStore;
  snapshotDir: string;
}

export const INSTRUCTIONS = `지원서 기본정보 자동 입력 도구 (CareerLog). 목표: 적은 왕복으로 빠르게, 틀리지 않게.

작업 순서
1. get_profile과 extract_fields를 한 번에 같이 호출한다. 브라우저가 없거나 지원서가 안 열려 있으면 browser_open.
   로그인 화면이면 login 도구를 한 번 쓴다 (확장의 계정 보관함에 그 사이트 계정이 있을 때만 된다. 비밀번호는 LLM에게 오지 않는다).
   안 되면 사용자가 직접 로그인한다. 아이디·비밀번호를 fill_fields로 넣지 않는다.
   CAPTCHA·2단계 인증·본인인증 화면이면 멈추고 사용자에게 맡긴다 (wait_for_user).
2. 일반 칸은 fill_fields 한 번에 최대한 많이 보낸다. 프로필 값 그대로면 confidence "high", 추정·변환이면 "low".
3. 반복 섹션(학력·경력·자격·외국어·IT활용·경험 등, extract 결과의 "반복 섹션")은 add_rows로 섹션마다 한 번에 넣는다.
   행 라벨은 지원서 팝업의 라벨을 쓴다 (모르면 프로필 키로 시도해도 된다: 입학일·졸업일·만점·취득일 같은 흔한 이름은 맞춰 준다).
   extract 결과에 "이 사이트에서 배운 것"(어댑터)이 있으면 거기 적힌 팝업 칸 라벨·최대 개수·먼저 넣을 칸을 그대로 따른다.
   자동완성 후보를 고를 단서(소재지·캠퍼스)는 같은 행에 같이 넣는다: {"학교명": "한국대학교", "소재지": "세종"} → "한국대학교(세종)".
   add_rows가 멈추면 돌려준 팝업 칸 목록을 보고 fill_fields(then_click: 저장 버튼 키)로 그 행을 마무리하고, 남은 행은 다시 add_rows.
   팝업 안의 "저장하기"(행저장)는 채우기의 일부라 눌러도 된다. 이미 저장된 행(수정 키가 있는 줄)은 다시 추가하지 않는다.
   "추가하기"가 팝업 없이 페이지 안에 줄을 펼치는 사이트도 add_rows로 넣는다 (새로 생긴 칸을 그 행으로 채운다).
4. 자동완성 칸(검색해서 고르는 칸)은 value에 고를 후보 글자를, 필요하면 query에 검색어를 준다.
   "후보가 여러 개"면 프로필(캠퍼스 등)에 맞는 후보 글자로 다시 보낸다. DB에 없는 이름(회사명 등)은 direct: true
   ("'한국대' 등록하기" 같은 새 항목 등록도 direct: true일 때만 누른다).
   버튼으로 고르는 칸(군필/미필, 졸업/졸업예정 = toggle)과 버튼형 드롭다운(listbox)도 fill_fields로 넣는다. click_button으로 하나씩 누르지 않는다.
5. 불일치(✗)는 실제 값과 placeholder를 보고 형식을 바꾸거나 method "keyboard"로 다시 시도한다. "새로 나타난 칸"은 이어서 채운다.
   "값이 바뀐 칸"(⚠ 에이전트가 넣은 값이 사이트 계산으로 바뀜)은 프로필 값과 다르면 다시 넣는다. 형식만 바뀐 값(하이픈 제거 등)은 정상이다.
   "⏳ 자동 채움"은 잠긴 칸을 사이트가 채운 것이라 다시 넣지 않는다. 같은 뜻의 선택지(만기전역 → 만기제대)는 도구가 골라 준다.
   "부분 저장"으로 보고된 행은 빠진 칸을 사용자에게 알린다. add_rows가 "최대 N개"를 알아내면 넣지 못한 항목을 보고한다.
   같은 페이지를 다시 볼 때는 extract_fields(changed_only: true)로 바뀐 것만 본다.
6. 다단계 지원서: 이 단계에 사용자가 직접 할 칸(파일·동의·자기소개서·외부 팝업)이 남아 있으면 먼저 안내하고 멈춘다.
   사용자가 넘어가라고 하면 next_step. 알림창 메시지(필수 누락, 최대 개수 등)는 사용자에게 그대로 전한다.
   사용자가 지금 바로 할 일(성적 조회 팝업, 본인인증, 보관함에 없는 파일)이면 안내한 뒤 wait_for_user로 기다렸다가 이어서 한다.
   주소 칸(우편번호 찾기 버튼, 읽기 전용 주소 칸)은 search_address로 넣는다 (프로필 주소의 도로명+건물번호로 검색, 상세주소는 fill_fields).
   extract 결과의 "외부 연동"(YBM 토익 성적 불러오기, OPIc 성적 인증 등)은 자동으로 하지 않는다: 사용자에게 버튼을 눌러 달라고 안내하고
   wait_for_user(keys: 결과 칸)로 기다린 뒤, 들어온 점수·응시일이 프로필과 다르면 알린다.
7. 끝나면 짧게: 채운 것, 노란색(확인 필요), 뺀 항목(개수 제한), 프로필과 다른 기존 값, 사용자가 직접 할 일.

개수·글자 수·형식 제한
- 칸(행) 수가 프로필 항목보다 적으면(스킬 5칸, 경험 최대 5개 등) 지원 직무 관련도 → 상의 등급/중요도 → 최근 순으로 골라 넣고, 뺀 항목을 보고한다.
  섹션 제목·안내문에 최대 개수가 보이면 처음부터 그 수만큼만 넣는다. 프로필의 "입력규칙"이 있으면 그걸 먼저 따른다.
- max(글자 수)나 hint의 카운터("0 / 100자", "0/200byte")를 보고 맞춘다. 프로필에 "요약"처럼 짧은 버전이 있으면 그걸 쓰고,
  그래도 길면 사실만 남겨 줄인 뒤 confidence "low". byte 카운터면 한글 1자를 2~3byte로 잡는다. 넘치는 값은 도구가 거부하고 이유를 돌려준다.
- 영문 이름·날짜·전화번호는 placeholder와 안내문 형식(대문자, 성/이름 순서, 하이픈 유무)에 맞춰 바꿔 넣는다. 바꿨으면 confidence "low".
- 수상 "내용"처럼 프로필 사실을 옮기는 칸은 채우되, 프로필에 없는 성과나 문장을 지어내지 않는다.

규칙
- 프로필에 없는 값은 지어내지 말고 모아서 한 번에 사용자에게 묻는다. 답을 받으면 save_profile로 저장할지 물어본 뒤 저장한다.
- 제출·최종제출·지원하기·미리보기·삭제 버튼은 누르지 않는다 (도구도 막는다). 제출은 항상 사용자가 한다.
- 자기소개서(essay), 동의/서약(consent), 민감정보(주민번호·계좌·비밀번호)는 채우지 않는다.
- 파일 첨부는 파일 보관함에 있는 파일만 attach_files로 넣는다 (extract 결과에 "파일 보관함"이 보일 때). 없으면 사용자에게 맡긴다.
  형식(accept)·크기·발급일 안내가 안 맞으면 도구가 거부하고 이유를 돌려준다. 이미 파일이 있는 칸은 덮어쓰지 않는다.
- 이미 값이 있는 칸은 덮어쓰지 않는다. 프로필과 다르면 알리고, 사용자가 원할 때만 overwrite: true.
- 지원서 전체 임시저장(전체저장 버튼)은 사용자가 원할 때만 누른다. 행저장은 눌러도 된다.
- 다른 사이트 탭(성적 조회·본인 인증 등)에서는 아무것도 입력하지 않는다.
- 도구로 안 되는 게 있으면 셸 스크립트나 브라우저 직접 조작으로 우회하지 말고, 멈추고 snapshot_page로 저장한 뒤 사용자에게 알린다
  (우회하면 제출 차단·민감정보 차단이 빠진다).`;

function text(s: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) };
}

function guard<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      return text(`오류: ${msg}`, true);
    }
  };
}

export function createServer({ driver, browser, profile, snapshotDir, ext }: ServerDeps): McpServer {
  const server = new McpServer({ name: 'careerlog-fill', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'browser_open',
    {
      title: '작업 브라우저 열기',
      description:
        '지원서 작업용 브라우저(전용 프로필)를 열거나 연결한다. url을 주면 그 주소로 이동한다. 사이트 로그인은 사용자가 이 창에서 직접 한다. 결과로 탭 목록을 준다.',
      inputSchema: { url: z.string().url().optional().describe('열 주소. 비우면 연결만 하고 탭 목록을 보여준다') },
      annotations: { openWorldHint: true },
    },
    guard(async ({ url }) => {
      await browser.open(url);
      return text(`브라우저 준비됨.\n${renderTabs(await browser.tabs())}`);
    }),
  );

  server.registerTool(
    'browser_tabs',
    {
      title: '탭 목록/선택',
      description: '열린 탭 목록을 보여준다. select로 작업할 탭을 고른다 (지원서가 팝업 창으로 열리는 사이트용).',
      inputSchema: { select: z.number().int().min(0).optional().describe('작업할 탭 번호') },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ select }) => {
      if (select !== undefined) await browser.selectTab(select);
      return text(renderTabs(await browser.tabs()));
    }),
  );

  server.registerTool(
    'get_profile',
    {
      title: '프로필 보기',
      description: '사용자 프로필(인적사항·학력·경력·자격증·어학 등)을 가져온다. 지원서에 넣을 값의 유일한 출처다. 비어 있는 항목 경로 목록도 준다.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const { filled, missing, created } = await profile.view();
      const lines = [
        created ? `프로필 파일이 없어서 예시로 새로 만들었어요: ${profile.path}` : `프로필: ${profile.path}`,
        '',
        JSON.stringify(filled, null, 1),
      ];
      if (missing.length) lines.push('', `비어 있는 항목 ${missing.length}개: ${missing.slice(0, 80).join(', ')}${missing.length > 80 ? ' …' : ''}`);
      return text(lines.join('\n'));
    }),
  );

  server.registerTool(
    'save_profile',
    {
      title: '프로필 저장',
      description:
        '사용자가 알려준 값을 프로필에 저장한다. 사용자가 저장에 동의했을 때만 호출한다. 주민번호·계좌·비밀번호 같은 민감정보는 거부된다.',
      inputSchema: {
        updates: z
          .array(
            z.object({
              path: z.string().describe('예: "기본정보.휴대폰", "학력.대학교[0].학점"'),
              value: z.union([z.string(), z.number(), z.boolean()]),
            }),
          )
          .min(1),
      },
    },
    guard(async ({ updates }) => {
      const { saved, rejected } = await profile.update(updates);
      const lines = [`저장 ${saved.length}개${saved.length ? `: ${saved.join(', ')}` : ''}`];
      for (const r of rejected) lines.push(`거부: ${r.path} — ${r.reason}`);
      return text(lines.join('\n'), saved.length === 0 && rejected.length > 0);
    }),
  );

  server.registerTool(
    'extract_fields',
    {
      title: '지원서 칸 추출',
      description:
        '지금 탭의 지원서 입력 칸과 버튼을 섹션별로 뽑는다 (라벨, 종류, 선택지, placeholder, 현재 값). 키(f12, 2:f3, b4)는 fill_fields/click_button에 쓴다. 페이지가 바뀌거나 행을 추가한 뒤에는 다시 호출한다. 드롭다운 선택지를 읽으려고 목록을 잠깐 열었다 닫는다 (aria 표시 없는 버튼형 드롭다운도 눌러 봐서 목록이 생기면 드롭다운으로 읽는다). 에이전트가 넣은 칸은 키만 한 줄로 접힌다.',
      inputSchema: {
        changed_only: z.boolean().optional().describe('true면 지난 extract 뒤로 새로 생기거나 값이 바뀐 칸·버튼만 보여준다 (같은 페이지에서 다시 볼 때 사용량 절약)'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ changed_only }) => text(renderScan(await driver.scan({ changedOnly: changed_only })))),
  );

  server.registerTool(
    'fill_fields',
    {
      title: '칸 채우기',
      description:
        '여러 칸을 한 번에 채우고, 다시 읽은 실제 값으로 칸마다 성공/불일치를 돌려준다. 채운 칸은 초록(확실)/노랑(low)/빨강(불일치)으로 표시된다. 순서대로 입력하므로 앞 칸 선택에 따라 열리는 칸은 뒤에 둔다. 편집 팝업이 입력 중에 닫히면 멈춘다. then_click을 주면 모든 칸이 성공했을 때 그 버튼(보통 팝업의 저장하기)까지 누른다.',
      inputSchema: {
        fields: z
          .array(
            z.object({
              key: z.string().describe('extract_fields의 키'),
              value: z.string().describe('넣을 값. 선택형·자동완성은 고를 선택지(후보) 글자, 체크박스는 "true"/"false"'),
              query: z.string().optional().describe('자동완성 칸에 칠 검색어 (예: value "한국대학교(세종)", query "한국대학교")'),
              direct: z.boolean().optional().describe('자동완성 후보에 없으면 "직접입력"으로 넣기 (회사명 등 DB에 없는 이름)'),
              confidence: z.enum(['high', 'low']).optional().describe('프로필 값 그대로면 high, 추정·변환이면 low'),
              prefer: z.array(z.string()).max(6).optional().describe('후보가 여러 개일 때 고를 단서 (예: ["세종"] → "한국대학교(세종)")'),
              method: z
                .enum(['auto', 'dom', 'keyboard'])
                .optional()
                .describe('기본 auto: DOM 이벤트로 넣고 안 먹으면 실제 키보드/마우스로 다시 시도'),
              overwrite: z.boolean().optional().describe('이미 값이 있는 칸을 덮어쓸지. 사용자가 원할 때만 true'),
            }),
          )
          .min(1)
          .max(200),
        then_click: z.string().optional().describe('모든 칸이 성공하면 이어서 누를 버튼 키 (팝업의 [행저장] 등). 제출 계열은 거부'),
      },
    },
    guard(async ({ fields, then_click }) => text(renderFill(await driver.fill(fields, then_click)))),
  );

  server.registerTool(
    'add_rows',
    {
      title: '반복 섹션에 행 추가',
      description:
        '학력·경력·자격·외국어·IT활용·경험처럼 "추가 → 편집 팝업 → 저장하기"로 쌓는 섹션에 여러 행을 한 번에 넣는다. 행마다 추가 버튼을 누르고, 팝업의 칸을 라벨로 찾아 채우고, 저장하기를 눌러 팝업이 닫혔는지까지 확인한다. 칸을 못 찾거나 불일치·필수 누락·"최대 N개" 알림이 있으면 그 행에서 멈추고 팝업을 열어 둔 채 칸 목록을 돌려준다.',
      inputSchema: {
        add: z.string().describe('그 섹션의 추가 버튼 키 (extract_fields "반복 섹션"의 추가 키)'),
        rows: z
          .array(
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.object({
                  value: z.string(),
                  query: z.string().optional(),
                  direct: z.boolean().optional(),
                  confidence: z.enum(['high', 'low']).optional(),
                }),
              ]),
            ),
          )
          .min(1)
          .max(20)
          .describe('행마다 {팝업 칸 라벨: 값}. 자동완성은 {value, query, direct}. 예: [{"학교명": {"value": "한국대학교(세종)", "query": "한국대학교"}, "졸업 구분": "졸업", "재학기간(시작일)": "2019-03-01"}]'),
      },
    },
    guard(async ({ add, rows }) => text(renderAddRows(await driver.addRows(add, rows)))),
  );

  server.registerTool(
    'click_button',
    {
      title: '버튼 누르기',
      description:
        '검색·탭·수정(연필) 같은 버튼을 누른다. 반복 섹션에 행을 넣을 때는 add_rows가 더 빠르다. times로 여러 번 누를 수 있다. 누른 뒤 새로 생긴 칸과 열린 팝업을 돌려준다. 제출·최종제출·지원하기·미리보기·삭제 계열은 코드에서 거부된다. 전체 임시저장은 사용자가 원할 때만.',
      inputSchema: {
        key: z.string().describe('extract_fields의 버튼 키 (b로 시작)'),
        times: z.number().int().min(1).max(10).optional().describe('누를 횟수 (기본 1)'),
      },
    },
    guard(async ({ key, times }) => text(renderClick(await driver.click(key, times)))),
  );

  server.registerTool(
    'next_step',
    {
      title: '다음 단계',
      description:
        '다단계 지원서에서 "다음"(또는 key로 지정한 "저장 후 다음") 버튼을 눌러 다음 단계로 넘어간다. 제출 계열은 거부된다. 넘어간 뒤 extract_fields로 새 칸을 확인한다.',
      inputSchema: { key: z.string().optional().describe('누를 버튼 키. 비우면 "다음" 버튼을 찾아서 누른다') },
    },
    guard(async ({ key }) => text(renderNav(await driver.nextStep(key)))),
  );

  server.registerTool(
    'wait_for_user',
    {
      title: '사용자 작업 기다리기',
      description:
        '사용자가 직접 할 일(파일 첨부, YBM 성적 조회, 주소 검색 팝업, 본인인증 등)을 안내한 뒤 끝날 때까지 기다린다. 팝업이 닫히거나, 주소가 바뀌거나, 저장된 행·첨부 파일 수가 바뀌거나, keys로 준 칸의 값이 바뀌면 바로 돌아오고, 바뀐 칸을 돌려준다.',
      inputSchema: {
        reason: z.string().describe('사용자에게 보여 줄 할 일 (예: "YBM에서 TOEIC 성적을 불러와 주세요")'),
        keys: z.array(z.string()).max(20).optional().describe('값이 바뀌는지 지켜볼 칸 키 (예: 점수 칸)'),
        timeout_sec: z.number().int().min(5).max(600).optional().describe('최대 대기 시간 (기본 180초)'),
      },
    },
    guard(async ({ reason, keys, timeout_sec }) => text(renderWait(await driver.waitForUser({ reason, keys, timeoutSec: timeout_sec }), reason))),
  );

  server.registerTool(
    'login',
    {
      title: '저장된 계정으로 로그인',
      description:
        '지금 탭이 로그인 화면이면, 크롬 확장의 계정 보관함에 이 사이트(정확히 같은 주소) 계정이 있을 때 그 계정으로 로그인한다. 비밀번호는 확장 안에서만 쓰이고 결과에는 상태만 온다. 보관함이 잠겨 있거나 계정이 없거나 CAPTCHA·2단계 인증·본인인증이 나오면 멈추고 이유를 돌려준다. 실패해도 다시 시도하지 않는다 (계정 잠김 방지).',
      inputSchema: {},
    },
    guard(async () => {
      if (!ext) return text('계정 보관함은 크롬 확장에서만 써요. 사용자에게 이 브라우저 창에서 직접 로그인해 달라고 하세요.', true);
      const r = await ext.login();
      const mark = r.status === 'logged_in' ? '✓' : r.status === 'challenge' ? '⛔' : '✗';
      const next =
        r.status === 'logged_in'
          ? ' extract_fields로 이어서 진행하세요.'
          : r.status === 'challenge'
            ? ' 사용자에게 직접 해 달라고 안내하고 wait_for_user로 기다리세요.'
            : ' 사용자에게 직접 로그인해 달라고 하세요 (다시 시도하지 않아요).';
      return text(`${mark} ${r.message}${next}`, r.status !== 'logged_in');
    }),
  );

  server.registerTool(
    'search_address',
    {
      title: '주소 검색 (우편번호)',
      description:
        '다음(카카오) 우편번호 검색 팝업으로 주소를 넣는다. open에 "우편번호 찾기" 버튼 키를 주면 팝업을 열고, query로 검색해서 결과가 하나면(또는 pick 글자와 맞는 줄이 하나면) 누른다. 결과가 여러 개면 목록을 돌려주고 팝업을 열어 둔다 — pick을 주고 다시 부른다. 사이트가 채운 우편번호·주소 칸을 돌려준다.',
      inputSchema: {
        query: z.string().describe('검색어: 프로필 주소의 도로명+건물번호 (예: "판교역로 166") 또는 동 이름'),
        pick: z.string().optional().describe('결과가 여러 개일 때 고를 줄에 들어 있는 글자 (우편번호, 건물명 등)'),
        open: z.string().optional().describe('검색 팝업을 여는 버튼 키 (이미 열려 있으면 생략)'),
      },
    },
    guard(async ({ query, pick, open }) => text(renderAddress(await driver.searchAddress({ query, pick, open })))),
  );

  server.registerTool(
    'attach_files',
    {
      title: '보관함 파일 첨부',
      description:
        '파일 보관함(졸업증명서·성적증명서·자격증 사본·포트폴리오 등)의 파일을 업로드 칸에 첨부한다. 칸의 형식(accept)·크기 제한·발급일 안내를 확인하고, 넣은 뒤 페이지에 보이는 파일 이름을 다시 읽어 확인한다. items 없이 부르면 보관함 목록만 돌려준다. 파일 내용은 LLM에게 오지 않는다.',
      inputSchema: {
        items: z
          .array(z.object({ key: z.string().describe('업로드 칸 키 (extract_fields에서 file 칸)'), file: z.string().describe('보관함 파일 id(앞 8자도 됨)·종류·이름') }))
          .max(20)
          .optional(),
      },
    },
    guard(async ({ items }) => text(renderAttach(await driver.attach(items ?? [])))),
  );

  server.registerTool(
    'ask_user',
    {
      title: '사용자에게 묻기',
      description:
        '프로필에 없는 값·고를 것을 모아서 한 번에 묻는다. 확장(사이드패널)에서는 질문을 패널에 올리고, 호출 뒤에는 도구를 더 부르지 말고 턴을 끝낸다 (답은 다음 메시지로 온다). 대화창이 있는 환경에서는 대화로 물어보라는 안내를 돌려준다.',
      inputSchema: {
        questions: z
          .array(
            z.object({
              text: z.string().describe('질문 (예: "영문 이름을 알려 주세요")'),
              options: z.array(z.string()).max(12).optional().describe('고를 답이 정해져 있으면 그 목록'),
              path: z.string().optional().describe('답을 저장할 프로필 경로 (예: "기본정보.영문이름")'),
            }),
          )
          .min(1)
          .max(10),
      },
    },
    guard(async ({ questions }) => {
      if (!ext) {
        const list = questions.map((q, i) => `${i + 1}. ${q.text}${q.options ? ` (${q.options.join('/')})` : ''}`);
        return text(['대화로 사용자에게 한 번에 물어보세요:', ...list].join('\n'));
      }
      await ext.rpc({ op: 'ask', questions: questions.map((q, i) => ({ id: `q${i + 1}`, ...q })) });
      return text(`사이드패널에 질문 ${questions.length}개를 올렸어요. 이제 도구를 더 부르지 말고, 답을 기다린다고 짧게 말하고 턴을 끝내세요. 답은 다음 메시지로 와요.`);
    }),
  );

  server.registerTool(
    'snapshot_page',
    {
      title: '페이지 저장',
      description:
        '지금 탭의 HTML(모든 프레임)을 로컬 파일로 저장한다. 칸 인식이 이상할 때 디버깅·오프라인 테스트용. 입력한 개인정보가 들어 있을 수 있어 로컬에만 저장된다.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const files = await driver.snapshot(snapshotDir);
      return text(`저장했어요 (${files.length}개):\n${files.map((f) => path.relative(process.cwd(), f) || f).join('\n')}`);
    }),
  );

  server.registerPrompt(
    'fill',
    {
      title: '지원서 채우기',
      description: '지금 열린 지원서(또는 주어진 주소)의 기본정보를 프로필로 채운다',
      argsSchema: { url: z.string().optional().describe('지원서 주소 (비우면 지금 탭)') },
    },
    ({ url }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${url ? `${url} 을(를) browser_open으로 열고, ` : ''}지금 지원서의 기본정보를 내 프로필로 채워 줘. 자기소개서·동의·제출은 건드리지 말고, 끝나면 확인할 칸과 내가 직접 할 일을 정리해 줘.`,
          },
        },
      ],
    }),
  );

  return server;
}
